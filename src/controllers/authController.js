// ============================================
// AUTH CONTROLLER — Register, Login, OTP
// ============================================
const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateOtp, parseUserAgent, getClientIp } = require('../utils/generateOtp');
const { sendTokenResponse } = require('../utils/generateToken');
const { sendOtpEmail } = require('../utils/sendEmail');
// SMS is used only for order confirmations — OTP uses email (or Firebase for phone)

// Demo account constants (module-level so all functions can access)
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'eptosicare@gmail.com';
const DEMO_OTP   = process.env.DEMO_OTP   || '246810';
// Second demo account, reachable via phone login — used for testing full
// checkout (across every vertical) in production without a real payment,
// e.g. app-store reviewers or internal QA. Mirrors the email demo account
// above exactly; see isDemoAccount on User.js and the payment-bypass
// branches added to each vertical's create-razorpay-order function.
const DEMO_PHONE     = process.env.DEMO_PHONE     || '9999999999';
const DEMO_PHONE_OTP = process.env.DEMO_PHONE_OTP || '000000';
const isDemoContactValue = (contact) => contact === DEMO_EMAIL || contact === DEMO_PHONE;

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
  const { purpose = 'login' } = req.body;
  const contact = (req.body.contact || '').trim().toLowerCase();
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

  // Use fixed OTP for demo accounts (Apple/Play Store review + internal QA)
  const code = (contact === DEMO_EMAIL) ? DEMO_OTP
    : (contact === DEMO_PHONE) ? DEMO_PHONE_OTP
    : generateOtp();

  const expiryMs = isDemoContactValue(contact)
    ? 365 * 24 * 60 * 60 * 1000
    : (parseInt(process.env.OTP_EXPIRY_MINUTES || 10)) * 60 * 1000;

  // Delete existing OTPs for this contact then create fresh one
  await Otp.deleteMany({ contact, type });
  await Otp.create({ contact, type, purpose, code, expiresAt: new Date(Date.now() + expiryMs) });

  // Send OTP
  if (type === 'email') {
    const result = await sendOtpEmail(contact, code, purpose);
    if (!result.success) {
      console.error('[OTP] Email send failed for', contact, '— reason:', result.error || 'unknown');
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
  const { type = 'email', code, name } = req.body;
  const contact = (req.body.contact || '').trim().toLowerCase();

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

  // OTP is valid — mark as used (demo account OTP stays reusable)
  const isDemoContact = isDemoContactValue(contact);
  if (!isDemoContact) {
    otpDoc.used = true;
    await otpDoc.save();
  }

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
      ...(isDemoContact ? { isDemoAccount: true } : {}),
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
        message: 'Your account has been deactivated. Please contact the SuperAdmin at support@eptomart.com to restore access.',
      });
    }
    // Defensive: some accounts were seeded with a role value ('customer')
    // that predates the current User.role enum (user/seller/admin/superAdmin).
    // user.save() below validates the WHOLE document, so a stale bad value
    // here throws "not a valid enum value" and blocks login entirely for
    // that account — normalize it instead of letting login fail.
    let needsSave = false;
    const validRoles = User.schema.path('role').enumValues;
    if (!validRoles.includes(user.role)) { user.role = 'user'; needsSave = true; }
    if (!user.isVerified) { user.isVerified = true; needsSave = true; }
    if (isDemoContact && !user.isDemoAccount) { user.isDemoAccount = true; needsSave = true; }
    if (needsSave) await user.save();
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

  const needsProfile = isNewUser && !isDemoContactValue(contact);
  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!', { isNewUser, needsProfile });
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

  // Silent token refresh: if the current token expires within 7 days, issue a new 30-day token
  // so the user never gets logged out mid-session
  let refreshedToken = null;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(req.headers.authorization?.replace('Bearer ', '') || '');
    if (decoded?.exp) {
      const secsLeft = decoded.exp - Math.floor(Date.now() / 1000);
      if (secsLeft < 7 * 24 * 3600) { // < 7 days remaining
        const { generateToken } = require('../utils/generateToken');
        refreshedToken = generateToken(user._id, user.role);
      }
    }
  } catch (_) {}

  res.json({ success: true, user, ...(refreshedToken ? { token: refreshedToken } : {}) });
};

/**
 * @route   PUT /api/auth/update-profile
 * @desc    Update user profile
 * @access  Private
 */
const updateProfile = async (req, res) => {
  const { name, firstName, lastName, email, phone, address } = req.body;
  const updates = {};

  // firstName + lastName → derive name
  if (firstName) {
    updates.firstName = firstName.trim();
    updates.lastName  = (lastName || '').trim();
    updates.name      = `${firstName.trim()} ${(lastName || '').trim()}`.trim() || firstName.trim();
  } else if (name) {
    updates.name = name;
  }

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

  // This is the real phone-login path (Firebase Phone Auth verified above) —
  // DEMO_PHONE only ever reaches here once it's registered as a Firebase
  // "test phone number" (Firebase Console → Authentication → Sign-in
  // method → Phone → Phone numbers for testing) with a fixed code, which
  // is what actually makes phone OTP skip a real SMS. This just makes
  // sure that account is flagged once it does log in.
  const isDemoPhone = phone === DEMO_PHONE;

  if (!user) {
    user = await User.create({
      name: (name || '').trim() || 'New User',
      phone,
      isVerified: true,
      registrationIp: getClientIp(req),
      ...(isDemoPhone ? { isDemoAccount: true } : {}),
    });
    isNewUser = true;
  } else {
    // Block deactivated accounts
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        blocked: true,
        message: 'Your account has been deactivated. Please contact the SuperAdmin at support@eptomart.com to restore access.',
      });
    }
    // Defensive: some accounts were seeded with a role value ('customer')
    // that predates the current User.role enum (user/seller/admin/superAdmin).
    // user.save() below validates the WHOLE document, so a stale bad value
    // here throws "not a valid enum value" and blocks login entirely for
    // that account — normalize it instead of letting login fail.
    let needsSave = false;
    const validRoles = User.schema.path('role').enumValues;
    if (!validRoles.includes(user.role)) { user.role = 'user'; needsSave = true; }
    if (!user.phone) { user.phone = phone; needsSave = true; }
    if (!user.isVerified) { user.isVerified = true; needsSave = true; }
    if (isDemoPhone && !user.isDemoAccount) { user.isDemoAccount = true; needsSave = true; }
    if (needsSave) await user.save();
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

  const needsProfile2 = isNewUser && phone !== DEMO_EMAIL && !isDemoPhone;
  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!', { isNewUser, needsProfile: needsProfile2 });
};

const addAddress = async (req, res) => {
  const user = await User.findById(req.user._id);
  const { label, fullName, phone, addressLine1, addressLine2, city, state, pincode, isDefault } = req.body;

  if (!addressLine1 || !city || !pincode) {
    return res.status(400).json({ success: false, message: 'addressLine1, city and pincode are required' });
  }
  if (phone && !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
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

  const { lat, lng } = req.body;
  user.addresses.push({
    label: label || 'Home',
    fullName, phone,
    addressLine1, addressLine2: addressLine2 || '',
    city, state: state || '', pincode,
    isDefault: !!isDefault || user.addresses.length === 0,
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
  });
  await user.save();
  res.json({ success: true, addresses: user.addresses });
};

/**
 * PUT /api/auth/address/:addressId
 * Edit an existing saved address's details in place (no separate
 * delete+recreate needed for a simple correction). lat/lng can also be
 * updated here if a caller wants to re-pin without changing text fields.
 */
const updateAddress = async (req, res) => {
  const user = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.addressId);
  if (!address) return res.status(404).json({ success: false, message: 'Address not found' });

  const { label, fullName, phone, addressLine1, addressLine2, city, state, pincode, isDefault, lat, lng } = req.body;
  if (phone && !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
  }

  if (label != null) address.label = label;
  if (fullName != null) address.fullName = fullName;
  if (phone != null) address.phone = phone;
  if (addressLine1 != null) address.addressLine1 = addressLine1;
  if (addressLine2 != null) address.addressLine2 = addressLine2;
  if (city != null) address.city = city;
  if (state != null) address.state = state;
  if (pincode != null) address.pincode = pincode;
  if (lat != null) address.lat = Number(lat);
  if (lng != null) address.lng = Number(lng);
  if (isDefault) user.addresses.forEach(a => { a.isDefault = a._id.toString() === req.params.addressId; });

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

/**
 * DELETE /api/auth/delete-account
 * Permanently deletes the user's account and all associated data.
 * Demo account cannot be deleted.
 */
const deleteAccount = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  // Protect demo account from deletion
  if (user.email === DEMO_EMAIL || user.phone === DEMO_EMAIL) {
    return res.status(403).json({ success: false, message: 'Demo account cannot be deleted' });
  }

  const userId = user._id;

  // Delete associated data
  try {
    const Cart          = require('../models/Cart');
    const Order         = require('../models/Order');
    const Wishlist      = require('../models/Wishlist');
    await Cart.deleteMany({ user: userId });
    // Anonymise orders (keep for seller records but remove buyer PII)
    await Order.updateMany({ buyer: userId }, {
      $set: {
        'shippingAddress.fullName': 'Deleted User',
        'shippingAddress.phone':    '',
        'shippingAddress.addressLine1': 'Deleted',
        buyer: null,
      }
    });
    await Wishlist?.deleteMany?.({ user: userId });
  } catch (_) {}

  try {
    const KoyambeduCart  = require('../models/KoyambeduCart');
    const KoyambeduOrder = require('../models/KoyambeduOrder');
    await KoyambeduCart.deleteMany({ user: userId });
    await KoyambeduOrder.updateMany({ buyer: userId }, {
      $set: { 'shippingAddress.fullName': 'Deleted User', 'shippingAddress.phone': '', buyer: null }
    });
  } catch (_) {}

  try {
    const UzhavarOrder = require('../models/UzhavarOrder');
    await UzhavarOrder.updateMany({ buyer: userId }, { $set: { buyer: null } });
  } catch (_) {}

  // Delete OTPs
  await Otp.deleteMany({ contact: user.email || user.phone });

  // Delete the user
  await User.findByIdAndDelete(userId);

  // Clear auth cookie
  res.clearCookie('token');
  res.json({ success: true, message: 'Your account has been permanently deleted.' });
};

module.exports = { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone, addAddress, updateAddress, deleteAddress, setDefaultAddress, deleteAccount };
