const express = require('express');
const Notification = require('../models/Notification');
const User = require('../models/User');
const {
  authMiddleware,
  adminMiddleware,
} = require('../middleware/auth');
const {
  cleanText,
  notifyUsersByCriteria,
} = require('../services/notificationService');

const router = express.Router();

function serializeNotification(notification) {
  const data = notification.data instanceof Map
    ? Object.fromEntries(notification.data.entries())
    : notification.data || {};

  return {
    id: notification._id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    data,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

async function removeTokenFromUser(userId, token) {
  const normalizedToken = cleanText(token, { maxLength: 4096 });
  if (!normalizedToken) {
    return false;
  }

  const result = await User.updateOne(
    { _id: userId },
    {
      $pull: {
        fcmTokens: {
          token: normalizedToken,
        },
      },
    }
  );

  return result.modifiedCount > 0;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const notifications = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit);
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    });

    res.json({
      notifications: notifications.map(serializeNotification),
      unreadCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    });

    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user.id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.user.id,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({
      message: 'Notification marked as read',
      notification: serializeNotification(notification),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/device-token', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'guest') {
      return res.status(400).json({ message: 'Guest accounts cannot register push tokens' });
    }

    const token = cleanText(req.body.token, { maxLength: 4096 });
    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    const platform = cleanText(req.body.platform, { maxLength: 32 }) || 'unknown';
    const deviceId = cleanText(req.body.deviceId, { maxLength: 120 });

    await User.updateMany(
      {
        _id: { $ne: req.user.id },
        'fcmTokens.token': token,
      },
      {
        $pull: {
          fcmTokens: { token },
        },
      }
    );

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existingToken = user.fcmTokens.find((entry) => entry.token === token);
    if (existingToken) {
      existingToken.platform = platform;
      existingToken.deviceId = deviceId;
      existingToken.updatedAt = new Date();
    } else {
      user.fcmTokens.push({
        token,
        platform,
        deviceId,
        updatedAt: new Date(),
      });
    }

    await user.save();

    res.json({
      message: 'Push token registered',
      tokenCount: user.fcmTokens.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/device-token/remove', authMiddleware, async (req, res) => {
  try {
    const removed = await removeTokenFromUser(req.user.id, req.body.token);
    res.json({
      message: removed ? 'Push token removed' : 'Push token not found',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/device-token', authMiddleware, async (req, res) => {
  try {
    const removed = await removeTokenFromUser(req.user.id, req.body?.token);
    res.json({
      message: removed ? 'Push token removed' : 'Push token not found',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/send', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const title = cleanText(req.body.title, { maxLength: 140 });
    const body = cleanText(req.body.body, { maxLength: 500 });
    const audience = cleanText(req.body.audience, { maxLength: 32 }) || 'all_clients';
    const userId = cleanText(req.body.userId, { maxLength: 64 });

    if (!title || !body) {
      return res.status(400).json({ message: 'Title and body are required' });
    }

    if (audience === 'single_user' && !userId) {
      return res.status(400).json({ message: 'userId is required for single_user audience' });
    }

    if (!['all_clients', 'single_user'].includes(audience)) {
      return res.status(400).json({ message: 'Invalid audience' });
    }

    const result = await notifyUsersByCriteria({
      title,
      body,
      createdBy: req.user.id,
      audience,
      userId,
      type: cleanText(req.body.type, { maxLength: 80 }) || 'promo',
      data: typeof req.body.data === 'object' && req.body.data !== null ? req.body.data : {},
    });

    res.json({
      message: 'Notification sent',
      createdCount: result.notifications.length,
      delivery: result.delivery,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
