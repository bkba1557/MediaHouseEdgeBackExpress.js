const express = require('express');
const Response = require('../models/Response');
const User = require('../models/User');
const {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
} = require('../middleware/auth');
const {
  notifyAdminsAboutNewResponse,
  notifyClientAboutReply,
  notifyClientAboutStatus,
  notifyClientAboutContract,
} = require('../services/notificationService');

const router = express.Router();

function buildKindFilter(kind) {
  const filter = {};

  if (kind === 'service') {
    filter.serviceCategory = { $exists: true, $ne: null };
  }

  if (kind === 'feedback') {
    filter.$or = [
      { serviceCategory: { $exists: false } },
      { serviceCategory: null },
      { serviceCategory: '' },
    ];
  }

  return filter;
}

function cleanText(value, { maxLength = 4000 } = {}) {
  const text = (value ?? '').toString().trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

const allowedContractStatuses = new Set([
  'draft',
  'active',
  'signed',
  'completed',
  'cancelled',
]);

// Submit client response
router.post('/submit', optionalAuthMiddleware, async (req, res) => {
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
    const normalizedClientEmail = cleanText(clientEmail, {
      maxLength: 254,
    }).toLowerCase();

    const submittedBy =
      req.user && req.user.id && req.user.role !== 'guest' ? req.user.id : undefined;
    
    const response = new Response({
      clientName: cleanText(clientName, { maxLength: 120 }),
      clientEmail: normalizedClientEmail,
      clientPhoneCountry,
      clientPhoneDialCode,
      clientPhoneNumber,
      message: cleanText(message),
      mediaId,
      rating,
      serviceCategory: cleanText(serviceCategory, { maxLength: 120 }),
      serviceTitle: cleanText(serviceTitle, { maxLength: 180 }),
      submittedBy
    });
    
    await response.save();
    try {
      await notifyAdminsAboutNewResponse(response);
    } catch (notificationError) {
      console.error('Failed to notify admins about new response:', notificationError.message);
    }
    res.json({ message: 'Response submitted successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all responses (admin only)
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { kind } = req.query;
    const filter = buildKindFilter(kind);

    const responses = await Response.find(filter)
      .sort({ createdAt: -1 })
      .populate('mediaId', 'title');
    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const { kind = 'service' } = req.query;
    const user = await User.findById(req.user.id).select('email');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const filter = buildKindFilter(kind);
    const emailPattern = user.email
      ? new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      : null;
    const ownershipChecks = [{ submittedBy: req.user.id }];
    if (emailPattern != null) {
      ownershipChecks.push({ clientEmail: emailPattern });
    }
    filter.$and = [
      {
        $or: ownershipChecks,
      },
    ];

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

    try {
      await notifyClientAboutStatus(response, status, req.user.id);
    } catch (notificationError) {
      console.error('Failed to notify client about status update:', notificationError.message);
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

    try {
      await notifyClientAboutReply(response, req.user.id);
    } catch (notificationError) {
      console.error('Failed to notify client about admin reply:', notificationError.message);
    }
    
    res.json({ message: 'Reply sent successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get responses by client email
router.get('/client/:email', authMiddleware, async (req, res) => {
  try {
    const requestedEmail = req.params.email.trim().toLowerCase();
    const user = await User.findById(req.user.id).select('email role');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.role !== 'admin' && user.email.trim().toLowerCase() !== requestedEmail) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const emailPattern = new RegExp(
      `^${requestedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i'
    );
    const responses = await Response.find({ clientEmail: emailPattern })
      .sort({ createdAt: -1 })
      .populate('mediaId', 'title');
    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/contracts', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const response = await Response.findById(req.params.id);
    if (!response) {
      return res.status(404).json({ message: 'Response not found' });
    }

    if (!response.serviceCategory) {
      return res.status(400).json({ message: 'Contracts can only be added to service requests' });
    }

    const title = cleanText(req.body.title, { maxLength: 160 });
    if (!title) {
      return res.status(400).json({ message: 'Contract title is required' });
    }
    const contractStatus = cleanText(req.body.status, { maxLength: 32 }) || 'active';
    if (!allowedContractStatuses.has(contractStatus)) {
      return res.status(400).json({ message: 'Invalid contract status' });
    }

    response.contracts.push({
      title,
      contractNumber: cleanText(req.body.contractNumber, { maxLength: 80 }),
      status: contractStatus,
      description: cleanText(req.body.description, { maxLength: 4000 }),
      documentUrl: cleanText(req.body.documentUrl, { maxLength: 2048 }),
      createdBy: req.user.id,
    });

    await response.save();
    const contract = response.contracts[response.contracts.length - 1];

    try {
      await notifyClientAboutContract(response, contract, req.user.id, 'added');
    } catch (notificationError) {
      console.error('Failed to notify client about new contract:', notificationError.message);
    }

    res.json({
      message: 'Contract added successfully',
      contract,
      response,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch(
  '/:id/contracts/:contractId',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const response = await Response.findById(req.params.id);
      if (!response) {
        return res.status(404).json({ message: 'Response not found' });
      }

      const contract = response.contracts.id(req.params.contractId);
      if (!contract) {
        return res.status(404).json({ message: 'Contract not found' });
      }

      const nextTitle = cleanText(req.body.title, { maxLength: 160 });
      if (Object.prototype.hasOwnProperty.call(req.body, 'title') && !nextTitle) {
        return res.status(400).json({ message: 'Contract title is required' });
      }

      if (nextTitle) contract.title = nextTitle;
      if (Object.prototype.hasOwnProperty.call(req.body, 'contractNumber')) {
        contract.contractNumber = cleanText(req.body.contractNumber, { maxLength: 80 });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
        const contractStatus =
          cleanText(req.body.status, { maxLength: 32 }) || contract.status;
        if (!allowedContractStatuses.has(contractStatus)) {
          return res.status(400).json({ message: 'Invalid contract status' });
        }
        contract.status = contractStatus;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
        contract.description = cleanText(req.body.description, { maxLength: 4000 });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'documentUrl')) {
        contract.documentUrl = cleanText(req.body.documentUrl, { maxLength: 2048 });
      }

      await response.save();

      try {
        await notifyClientAboutContract(response, contract, req.user.id, 'updated');
      } catch (notificationError) {
        console.error('Failed to notify client about updated contract:', notificationError.message);
      }

      res.json({
        message: 'Contract updated successfully',
        contract,
        response,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
