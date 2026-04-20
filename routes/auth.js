const express = require('express');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const pendingOtps = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;

const createToken = (user) => jwt.sign(
  { id: user._id, username: user.username, role: user.role },
  process.env.JWT_SECRET || 'your_jwt_secret',
  { expiresIn: '7d' }
);

const publicUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
});

const createOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const getOtpKey = (purpose, email) => `${purpose}:${email.toLowerCase()}`;

const sendOtpEmail = async (email, code, purpose) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    console.log(`OTP for ${email} (${purpose}): ${code}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Media House Edge verification code',
    text: `Your Media House Edge verification code is ${code}. It expires in 10 minutes.`,
  });
};

if (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD) {
  console.log('SMTP email delivery is configured');
} else {
  console.log('SMTP is not configured; OTP codes will be printed in the console');
}

const setPendingOtp = async (purpose, email, payload) => {
  const code = createOtp();
  pendingOtps.set(getOtpKey(purpose, email), {
    code,
    payload,
    expiresAt: Date.now() + OTP_TTL_MS,
  });
  await sendOtpEmail(email, code, purpose);
};

const getPendingOtp = (purpose, email, code) => {
  const key = getOtpKey(purpose, email);
  const pending = pendingOtps.get(key);

  if (!pending || pending.expiresAt < Date.now()) {
    pendingOtps.delete(key);
    return null;
  }

  if (pending.code !== code) return null;

  pendingOtps.delete(key);
  return pending.payload;
};

// Register
router.post('/register', [
  body('username').isLength({ min: 3 }),
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const { username, email, password } = req.body;
    
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    await setPendingOtp('register', email, {
      username,
      email,
      password,
      role: 'client',
    });
    
    res.json({ message: 'Verification code sent', requiresOtp: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/register/verify', [
  body('email').isEmail(),
  body('otp').isLength({ min: 6, max: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, otp } = req.body;
    const pending = getPendingOtp('register', email, otp);

    if (!pending) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    let user = await User.findOne({ $or: [{ email: pending.email }, { username: pending.username }] });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    user = new User(pending);
    await user.save();

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail(),
  body('password').exists()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    await setPendingOtp('login', email, { userId: user._id });
    
    res.json({ message: 'Verification code sent', requiresOtp: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login/verify', [
  body('email').isEmail(),
  body('otp').isLength({ min: 6, max: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, otp } = req.body;
    const pending = getPendingOtp('login', email, otp);

    if (!pending) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    const user = await User.findById(pending.userId);
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Guest login
router.post('/guest', async (req, res) => {
  try {
    const guestToken = jwt.sign(
      { id: 'guest', username: 'Guest', role: 'guest' },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );
    res.json({ token: guestToken, user: { id: 'guest', username: 'Guest', role: 'guest' } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
