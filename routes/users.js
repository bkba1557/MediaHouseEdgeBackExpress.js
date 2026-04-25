const express = require('express');
const User = require('../models/User');
const {
  authMiddleware,
  adminMiddleware,
} = require('../middleware/auth');
const { cleanText } = require('../services/notificationService');

const router = express.Router();

function serializeUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    customerTier: user.customerTier || 'regular',
    createdAt: user.createdAt,
    notificationTokenCount: Array.isArray(user.fcmTokens) ? user.fcmTokens.length : 0,
  };
}

router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const search = cleanText(req.query.search, { maxLength: 120 });
    const role = cleanText(req.query.role, { maxLength: 32 });
    const filter = {};

    if (role) {
      filter.role = role;
    }

    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .select('username email role customerTier createdAt fcmTokens');

    res.json(users.map(serializeUser));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/customer-tier', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const customerTier = cleanText(req.body.customerTier, { maxLength: 32 });
    const allowedTiers = ['regular', 'vip', 'key_account'];

    if (!allowedTiers.includes(customerTier)) {
      return res.status(400).json({ message: 'Invalid customer tier' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'guest') {
      return res.status(400).json({ message: 'Guest accounts cannot be classified' });
    }

    user.customerTier = customerTier;
    await user.save();

    res.json({
      message: 'Customer tier updated',
      user: serializeUser(user),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
