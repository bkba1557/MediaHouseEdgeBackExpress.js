const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const { getAuth: getFirebaseAuth } = require('../services/firebaseAdmin');

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
  customerTier: user.customerTier || 'regular',
});

const createOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const getOtpKey = (purpose, email) => `${purpose}:${email.toLowerCase()}`;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findUserByEmail = (email) =>
  User.findOne({
    email: new RegExp(`^${escapeRegExp(normalizeEmail(email))}$`, 'i'),
  });

const socialProviderMap = {
  google: 'google.com',
  apple: 'apple.com',
};

const sanitizeUsername = (value) => {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.length >= 3 ? normalized : '';
};

const buildUsernameBase = (displayName, email) => {
  const emailLocalPart = normalizeEmail(email).split('@')[0];
  return (
    sanitizeUsername(displayName) ||
    sanitizeUsername(emailLocalPart) ||
    `user_${Date.now().toString().slice(-6)}`
  );
};

const ensureUniqueUsername = async (displayName, email) => {
  const base = buildUsernameBase(displayName, email);
  let candidate = base;
  let attempt = 0;

  while (await User.exists({ username: candidate })) {
    attempt += 1;
    candidate = `${base}_${Math.random().toString(36).slice(2, 6)}${attempt}`;
  }

  return candidate;
};

const mergeProviders = (currentProviders, provider) => {
  const providers = Array.isArray(currentProviders) ? currentProviders : [];
  return Array.from(new Set([...providers, provider]));
};

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
    const username = req.body.username.trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    
    let user = await User.findOne({
      $or: [{ username }, { email: new RegExp(`^${escapeRegExp(email)}$`, 'i') }],
    });
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
    const normalizedEmail = normalizeEmail(email);
    const pending = getPendingOtp('register', normalizedEmail, otp);

    if (!pending) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    let user = await User.findOne({
      $or: [
        { username: pending.username },
        { email: new RegExp(`^${escapeRegExp(pending.email)}$`, 'i') },
      ],
    });
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
  body('password').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login/request-otp', [
  body('email').isEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const email = normalizeEmail(req.body.email);
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(400).json({ message: 'No account found for this email' });
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
    const normalizedEmail = normalizeEmail(email);
    const pending = getPendingOtp('login', normalizedEmail, otp);

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

router.post('/social/firebase', [
  body('provider').isIn(Object.keys(socialProviderMap)),
  body('idToken').isString().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) {
    return res.status(503).json({
      message:
        'Social login is not configured on the server. Connect Firebase Admin to the same Firebase project used by the app.',
    });
  }

  try {
    const provider = req.body.provider.trim().toLowerCase();
    const expectedProviderId = socialProviderMap[provider];
    const decodedToken = await firebaseAuth.verifyIdToken(req.body.idToken);
    const actualProviderId = decodedToken.firebase?.sign_in_provider;

    if (actualProviderId !== expectedProviderId) {
      return res.status(400).json({ message: 'Social login provider mismatch' });
    }

    const email = normalizeEmail(decodedToken.email);
    if (!email) {
      return res.status(400).json({
        message: 'The selected social account did not provide an email address',
      });
    }

    const firebaseUid = String(decodedToken.uid || '').trim();
    const displayName = String(decodedToken.name || '').trim();

    const userByFirebaseUid = firebaseUid
      ? await User.findOne({ firebaseUid })
      : null;
    const userByEmail = await findUserByEmail(email);
    const user = userByFirebaseUid || userByEmail;

    if (
      user &&
      user.firebaseUid &&
      firebaseUid &&
      user.firebaseUid !== firebaseUid
    ) {
      return res.status(409).json({
        message: 'This email is already linked to another social account',
      });
    }

    if (!user) {
      const username = await ensureUniqueUsername(displayName, email);
      const newUser = new User({
        username,
        email,
        password: crypto.randomBytes(24).toString('hex'),
        role: 'client',
        firebaseUid,
        authProviders: [provider],
      });

      await newUser.save();
      return res.json({ token: createToken(newUser), user: publicUser(newUser) });
    }

    user.email = email;
    if (firebaseUid && !user.firebaseUid) {
      user.firebaseUid = firebaseUid;
    }
    if (!user.username || user.username.trim().isEmpty) {
      user.username = await ensureUniqueUsername(displayName, email);
    }
    if (!user.password || user.password.trim().isEmpty) {
      user.password = crypto.randomBytes(24).toString('hex');
    }
    user.authProviders = mergeProviders(user.authProviders, provider);

    await user.save();

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (
      error?.code === 'auth/id-token-expired' ||
      error?.code === 'auth/argument-error' ||
      error?.code === 'auth/invalid-id-token'
    ) {
      return res.status(401).json({ message: 'Invalid social login token' });
    }

    res.status(500).json({
      message:
        'Social login failed. Confirm Firebase Admin uses the same Firebase project as the app.',
    });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: publicUser(user) });
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
