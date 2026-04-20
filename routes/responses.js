const express = require('express');
const Response = require('../models/Response');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Submit client response
router.post('/submit', async (req, res) => {
  try {
    const { clientName, clientEmail, message, mediaId, rating } = req.body;
    
    const response = new Response({
      clientName,
      clientEmail,
      message,
      mediaId,
      rating
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
    const responses = await Response.find().sort({ createdAt: -1 }).populate('mediaId', 'title');
    res.json(responses);
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