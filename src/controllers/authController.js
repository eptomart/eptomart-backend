// ============================================
// AUTH CONTROLLER — Register, Login, OTP
// ============================================
const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateOtp, parseUserAgent, getClientIp } = require('../utils/generateOtp');
const { sendTokenResponse } = require('../utils/generateToken');
const { sendOtpEmail } = require('../utils/sendEmail');
// SMS is used only for order confirmations — OTP uses email (or Firebase for phone)

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to email or phone
 * @access  Public
 */
// Auto-detect contact type from value
const detectContactType = (contact) => {
  if (!contact) return null;
  const c = contact.trim();
  if (/^\S+@\S+\.\S+$/.test(c)) return 'email';
  if (/^[6-9]\d{9}$/.test(c))   return 'phone';
  return null;
};

const sendOtp = async (req, res) => {
  const { contact, purpose = 'login' } = req.body;
  // Accept explicit type OR auto-detect
  let type = req.body.type;

  if (!contact) {
    return res.status(400).json({ success: false, message: 'Email or phone is required' });
  }

  if (!type) {
    type = detectContactType(contact.trim());
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact. Enter a valid email or 10-digit phone number.',
      });
    }
  }

  // Validate email format
  if (type === 'email' && !/^\S+@\S+\.\S+$/.test(contact)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  // Validate Indian phone
  if (type === 'phone' && !/^[6-9]\d{9}$/.test(contact)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number' });
  }

  // Check if an account already exists with this contact (in either email or phone field)
  const existingUser = await User.findOne({ $or: [{ email: contact }, { phone: contact }] })
    .select('email phone name').lean();

  // Delete existing OTPs for this contact
  await Otp.deleteMany({ contact, type });

  // Generate new OTP
  const code = generateOtp();

  await Otp.create({
    contact,
    type,
    purpose,
    code,
    expiresAt: new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES || 10)) * 60 * 1000),
  });

  // Send OTP
  if (type === 'email') {
    const result = await sendOtpEmail(contact, code, purpose);
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP email. Try again.' });
    }
  }
  if (type === 'phone') {
    // Phone OTP is handled by Firebase on the frontend (RecaptchaVerifier + signInWithPhoneNumber)
    // This backend path is a fallback only — no SMS sent here to avoid double-charging
    console.log('[Auth] Phone OTP generated (Firebase handles delivery):', contact);
  }

  // In development, return OTP in response for testing
  const devData = process.env.NODE_ENV === 'development' ? { otp: code } : {};

  // Build account-exists hint for frontend (shows "Welcome back" vs "Sign up")
  const accountHint = existingUser ? {
    accountExists: true,
    linkedMethods: [
      ...(existingUser.email ? ['email'] : []),
      ...(existingUser.phone ? ['phone'] : []),
    ],
  } : { accountExists: false };

  res.json({
    success: true,
    message: `OTP sent to ${type === 'email' ? contact : `XXXXX${contact.slice(-5)}`}`,
    detectedType: type,
    expiresIn: `${process.env.OTP_EXPIRY_MINUTES || 10} minutes`,
    ...accountHint,
    ...devData,
  });
};

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and login/register user
 * @access  Public
 */
const verifyOtp = async (req, res) => {
  const { contact, type = 'email', code, name } = req.body;

  if (!contact || !code) {
    return res.status(400).json({ success: false, message: 'Contact and OTP are required' });
  }

  // Find valid OTP
  const otpDoc = await Otp.findOne({
    contact,
    type,
    used: false,
    expiresAt: { $gt: new Date() },
  });

  if (!otpDoc) {
    return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new one.' });
  }

  // Increment attempts
  otpDoc.attempts += 1;

  if (otpDoc.attempts > 5) {
    await otpDoc.deleteOne();
    return res.status(400).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' });
  }

  if (otpDoc.code !== code.toString()) {
    await otpDoc.save();
    const remaining = 5 - otpDoc.attempts;
    return res.status(400).json({ success: false, message: `Incorrect OTP. ${remaining} attempts left.` });
  }

  // OTP is valid — mark as used
  otpDoc.used = true;
  await otpDoc.save();

  // Find user — check BOTH email and phone fields to prevent duplicate accounts
  // e.g. user registered via email, now logging in via phone saved in their profile
  let user = await User.findOne({ $or: [{ email: contact }, { phone: contact }] });
  let isNewUser = false;

  if (!user) {
    // Register new user — name is optional at signup; captured in profile step
    const userData = {
      name: (name || '').trim() || 'New User',
      isVerified: true,
      registrationIp: getClientIp(req),
    };

    if (type === 'email') userData.email = contact;
    else userData.phone = contact;

    user = await User.create(userData);
    isNewUser = true;
  } else {
    // Block deactivated accounts — must contact SuperAdmin
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        blocked: true,
        message: 'Your account has been deactivated. Please contact the SuperAdmin at eptosicare@gmail.com to restore access.',
      });
    }
    // Mark as verified
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }
  }

  // Record login history
  const { browser, os, device } = parseUserAgent(req.headers['user-agent'] || '');
  await User.findByIdAndUpdate(user._id, {
    lastLogin: new Date(),
    $push: {
      loginHistory: {
        $each: [{
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').substring(0, 200),
          browser,
          os,
          device,
          timestamp: new Date(),
        }],
        $slice: -20, // Keep last 20
      }
    }
  });

  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!', { isNewUser });
};

/**
 * @route   POST /api/auth/register
 * @desc    Classic register (optional - for admin only or alternative flow)
 * @access  Public
 */
const register = async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || (!email && !phone)) {
    return res.status(400).json({ success: false, message: 'Name and email/phone are required' });
  }

  // Check if user exists
  const query = email ? { email } : { phone };
  const existing = await User.findOne(query);
  if (existing) {
    return res.status(400).json({ success: false, message: 'User already registered with this ' + (email ? 'email' : 'phone') });
  }

  const user = await User.create({
    name,
    email: email || undefined,
    phone: phone || undefined,
    password: password || undefined,
    registrationIp: getClientIp(req),
  });

  sendTokenResponse(user, 201, res, 'Account created! Please verify your email/phone.');
};

/**
 * @route   GET /api/auth/me
 * @desc    Get current logged in user
 * @access  Private
 */
const getMe = async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, user });
};

/**
 * @route   PUT /api/auth/update-profile
 * @desc    Update user profile
 * @access  Private
 */
const updateProfile = async (req, res) => {
  const { name, email, phone, address } = req.body;
  const updates = {};
  if (name) updates.name = name;

  // Check email uniqueness before updating
  if (email) {
    const emailTaken = await User.findOne({ email, _id: { $ne: req.user._id } }).lean();
    if (emailTaken) {
      return res.status(400).json({
        success: false,
        message: 'This email is already linked to another Eptomart account. Please use a different email or log in with that account.',
      });
    }
    updates.email = email;
  }

  // Check phone uniqueness before updating
  if (phone) {
    const phoneTaken = await User.findOne({ phone, _id: { $ne: req.user._id } }).lean();
    if (phoneTaken) {
      return res.status(400).json({
        success: false,
        message: 'This mobile number is already linked to another Eptomart account. Please use a different number or log in with that account.',
      });
    }
    updates.phone = phone;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });

  // If address provided and user has no addresses yet, add it as default
  if (address && address.addressLine1 && address.city && address.pincode) {
    const freshUser = await User.findById(req.user._id);
    if (freshUser.addresses.length === 0) {
      freshUser.addresses.push({
        label:        address.label || 'Home',
        fullName:     name || freshUser.name,
        phone:        address.phone || phone || freshUser.phone || '',
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 || '',
        city:         address.city,
        state:        address.state || '',
        pincode:      address.pincode,
        isDefault:    true,
      });
      await freshUser.save();
      return res.json({ success: true, message: 'Profile updated', user: freshUser });
    }
  }

  res.json({ success: true, message: 'Profile updated', user });
};

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
const logout = (req, res) => {
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: 'Logged out successfully' });
};

/**
 * @route   POST /api/auth/firebase-phone-verify
 * @desc    Verify Firebase Phone Auth ID token, return our JWT
 * @access  Public
 */
const verifyFirebasePhone = async (req, res) => {
  const { idToken, name } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'Firebase ID token is required' });
  }

  const getFirebaseAdmin = require('../utils/firebaseAdmin');
  const firebaseAdmin = getFirebaseAdmin();

  if (!firebaseAdmin) {
    return res.status(503).json({ success: false, message: 'Phone auth not configured on server' });
  }

  // Verify the Firebase ID token
  const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);

  if (!decoded.phone_number) {
    return res.status(400).json({ success: false, message: 'Token does not contain phone number' });
  }

  // Extract 10-digit Indian number from +91XXXXXXXXXX
  const phone = decoded.phone_number.replace(/^\+91/, '');

  // Find or create user — check both phone and email fields to avoid duplicates
  let user = await User.findOne({ $or: [{ phone }, { email: phone }] });
  let isNewUser = false;

  if (!user) {
    user = await User.create({
      name: (name || '').trim() || 'New User',
      phone,
      isVerified: true,
      registrationIp: getClientIp(req),
    });
    isNewUser = true;
  } else {
    // If existing user found but phone field not set, link the phone to their account
    if (!user.phone) {
      user.phone = phone;
      await user.save();
    }
    // Block deactivated accounts
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        blocked: true,
        message: 'Your account has been deactivated. Please contact the SuperAdmin at eptosicare@gmail.com to restore access.',
      });
    }
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }
  }

  // Record login
  const { browser, os, device } = parseUserAgent(req.headers['user-agent'] || '');
  await User.findByIdAndUpdate(user._id, {
    lastLogin: new Date(),
    $push: {
      loginHistory: {
        $each: [{ ip: getClientIp(req), userAgent: (req.headers['user-agent'] || '').substring(0, 200), browser, os, device, timestamp: new Date() }],
        $slice: -20,
      }
    }
  });

  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!', { isNewUser });
};

const addAddress = async (req, res) => {
  const user = await User.findById(req.user._id);
  const { label, fullName, phone, addressLine1, addressLine2, city, state, pincode, isDefault } = req.body;

  if (!addressLine1 || !city || !pincode) {
    return res.status(400).json({ success: false, message: 'addressLine1, city and pincode are required' });
  }

  // Prevent duplicate entries (same street + pincode)
  const duplicate = user.addresses.find(
    a => a.addressLine1?.trim().toLowerCase() === addressLine1?.trim().toLowerCase()
      && a.pincode === pincode
  );
  if (duplicate) {
    return res.json({ success: true, addresses: user.addresses, duplicate: true });
  }

  if (isDefault) user.addresses.forEach(a => { a.isDefault = false; });

  user.addresses.push({
    label: label || 'Home',
    fullName, phone,
    addressLine1, addressLine2: addressLine2 || '',
    city, state: state || '', pincode,
    isDefault: !!isDefault || user.addresses.length === 0,
  });
  await user.save();
  res.json({ success: true, addresses: user.addresses });
};

const deleteAddress = async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses = user.addresses.filter(a => a._id.toString() !== req.params.addressId);
  await user.save();
  res.json({ success: true, addresses: user.addresses });
};

const setDefaultAddress = async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses.forEach(a => { a.isDefault = a._id.toString() === req.params.addressId; });
  await user.save();
  res.json({ success: true, addresses: user.addresses });
};

module.exports = { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone, addAddress, deleteAddress, setDefaultAddress };
