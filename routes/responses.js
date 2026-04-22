const express = require('express');
const Response = require('../models/Response');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Submit client response
router.post('/submit', async (req, res) => {
  try {
    const {
      clientName,
      clientEmail,
      clientPhoneCountry,
      clientPhoneDialCode,
      clientPhoneNumber,
      message,
      mediaId,
      rating,
      serviceCategory,
      serviceTitle
    } = req.body;
    
    const response = new Response({
      clientName,
      clientEmail,
      clientPhoneCountry,
      clientPhoneDialCode,
      clientPhoneNumber,
      message,
      mediaId,
      rating,
      serviceCategory,
      serviceTitle
    });
    
    await response.save();
    res.json({ message: 'Response submitted successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all responses (admin only)
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { kind } = req.query;
    const filter = {};

    if (kind === 'service') {
      filter.serviceCategory = { $exists: true, $ne: null };
    }

    if (kind === 'feedback') {
      filter.$or = [
        { serviceCategory: { $exists: false } },
        { serviceCategory: null },
        { serviceCategory: '' }
      ];
    }

    const responses = await Response.find(filter)
      .sort({ createdAt: -1 })
      .populate('mediaId', 'title');
    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update response status (admin only)
router.post('/status/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'approved', 'rejected', 'replied', 'resolved'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const response = await Response.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!response) {
      return res.status(404).json({ message: 'Response not found' });
    }

    res.json({ message: 'Status updated successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reply to response (admin only)
router.post('/reply/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { reply } = req.body;
    const response = await Response.findByIdAndUpdate(
      req.params.id,
      { adminReply: reply, status: 'replied' },
      { new: true }
    );
    
    if (!response) {
      return res.status(404).json({ message: 'Response not found' });
    }
    
    res.json({ message: 'Reply sent successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get responses by client email
router.get('/client/:email', async (req, res) => {
  try {
    const responses = await Response.find({ clientEmail: req.params.email })
      .sort({ createdAt: -1 })
      .populate('mediaId', 'title');
    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
