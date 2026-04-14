// ============================================
// AUTH CONTROLLER — Register, Login, OTP
// ============================================
const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateOtp, parseUserAgent, getClientIp } = require('../utils/generateOtp');
const { sendTokenResponse } = require('../utils/generateToken');
const { sendOtpEmail } = require('../utils/sendEmail');
const { sendOtpSms } = require('../utils/sendSMS');

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to email or phone
 * @access  Public
 */
const sendOtp = async (req, res) => {
  const { contact, type = 'email', purpose = 'login' } = req.body;

  if (!contact) {
    return res.status(400).json({ success: false, message: 'Email or phone is required' });
  }

  // Validate email format
  if (type === 'email' && !/^\S+@\S+\.\S+$/.test(contact)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  // Validate Indian phone
  if (type === 'phone' && !/^[6-9]\d{9}$/.test(contact)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number' });
  }

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
    const result = await sendOtpSms(contact, code);
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP SMS. Try again.' });
    }
  }

  // In development, return OTP in response for testing
  const devData = process.env.NODE_ENV === 'development' ? { otp: code } : {};

  res.json({
    success: true,
    message: `OTP sent to ${type === 'email' ? contact : `XXXXX${contact.slice(-5)}`}`,
    expiresIn: `${process.env.OTP_EXPIRY_MINUTES || 10} minutes`,
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

  // Find or create user
  const query = type === 'email' ? { email: contact } : { phone: contact };
  let user = await User.findOne(query);
  let isNewUser = false;

  if (!user) {
    // Register new user
    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required for new registration' });
    }

    const userData = {
      name: name.trim(),
      isVerified: true,
      registrationIp: getClientIp(req),
    };

    if (type === 'email') userData.email = contact;
    else userData.phone = contact;

    user = await User.create(userData);
    isNewUser = true;
  } else {
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

  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!');
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
  const { name, email, phone } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phone) updates.phone = phone;

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
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

  // Find or create user
  let user = await User.findOne({ phone });
  let isNewUser = false;

  if (!user) {
    user = await User.create({
      name: (name || 'User').trim(),
      phone,
      isVerified: true,
      registrationIp: getClientIp(req),
    });
    isNewUser = true;
  } else {
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

  sendTokenResponse(user, 200, res, isNewUser ? 'Account created successfully!' : 'Login successful!');
};

module.exports = { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone };
