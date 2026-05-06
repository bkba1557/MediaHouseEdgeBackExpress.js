const express = require('express');
const multer = require('multer');
const path = require('path');
const Response = require('../models/Response');
const User = require('../models/User');
const Counter = require('../models/Counter');
const {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
} = require('../middleware/auth');
const {
  notifyAdminsAboutNewResponse,
  notifyClientAboutReply,
  notifyClientAboutStatus,
  notifyClientAboutCastingResult,
  notifyClientAboutContractRelease,
  notifyClientAboutContract,
  createNotificationsForUsers,
  formatRiyadhDateTime,
} = require('../services/notificationService');

const router = express.Router();
const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-evidence${ext}`);
  },
});
const evidenceUpload = multer({
  storage: evidenceStorage,
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
      'application/octet-stream',
    ]);
    const allowedExtensions = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.heic',
      '.heif',
      '.pdf',
    ]);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(ext)) {
      return cb(null, true);
    }
    cb(new Error('المرفق يجب أن يكون صورة أو PDF'));
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});

const castingUpload = evidenceUpload.fields([
  { name: 'identityFront', maxCount: 1 },
  { name: 'identityBack', maxCount: 1 },
  { name: 'passport', maxCount: 1 },
]);

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

function publicUploadUrl(req, file) {
  if (!file) return '';
  const publicBaseUrl = (
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/+$/, '');
  return `${publicBaseUrl}/uploads/${file.filename}`;
}

function parseJsonField(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

async function nextCastingNumber() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'casting_application' },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `MHE-${String(counter.sequence).padStart(6, '0')}`;
}

const allowedContractStatuses = new Set([
  'draft',
  'active',
  'signed',
  'completed',
  'cancelled',
]);

// Submit client response
router.post('/submit', optionalAuthMiddleware, evidenceUpload.single('evidence'), async (req, res) => {
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
      serviceTitle,
      organizationName
    } = req.body;
    const normalizedClientEmail = cleanText(clientEmail, {
      maxLength: 254,
    }).toLowerCase();

    const submittedBy =
      req.user && req.user.id && req.user.role !== 'guest' ? req.user.id : undefined;
    
    const publicBaseUrl = (
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get('host')}`
    ).replace(/\/+$/, '');
    const evidenceUrl = req.file
      ? `${publicBaseUrl}/uploads/${req.file.filename}`
      : cleanText(req.body.evidenceUrl, { maxLength: 2048 });

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
      organizationName: cleanText(organizationName, { maxLength: 180 }),
      evidenceUrl,
      submittedBy,
      actionHistory: [
        {
          action: 'created',
          message: 'Request submitted',
          createdBy: submittedBy,
        },
      ],
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

router.post('/casting', authMiddleware, castingUpload, async (req, res) => {
  try {
    if (req.user.role === 'guest') {
      return res.status(403).json({ message: 'Guest accounts cannot submit casting applications' });
    }

    const user = await User.findById(req.user.id).select('username email');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const previous = await Response.findOne({
      submittedBy: req.user.id,
      serviceCategory: 'casting_application',
      status: {
        $nin: [
          'rejected',
          'resolved',
          'qualified',
          'unqualified',
          'contract_released',
        ],
      },
    });
    if (previous) {
      return res.status(409).json({
        message: 'You have already reached the maximum casting application limit',
        response: previous,
      });
    }

    const castingData = parseJsonField(req.body.castingData, {});
    const identityType = cleanText(castingData.identityType, { maxLength: 32 });
    const frontFile = req.files?.identityFront?.[0];
    const backFile = req.files?.identityBack?.[0];
    const passportFile = req.files?.passport?.[0];

    if (identityType === 'passport') {
      if (!passportFile) return res.status(400).json({ message: 'Passport image is required' });
    } else if (!frontFile || !backFile) {
      return res.status(400).json({ message: 'Front and back identity images are required' });
    }

    const castingNumber = await nextCastingNumber();
    const response = new Response({
      clientName: cleanText(castingData.name || user.username, { maxLength: 120 }),
      clientEmail: user.email,
      clientPhoneCountry: cleanText(castingData.country, { maxLength: 120 }),
      clientPhoneDialCode: cleanText(castingData.phoneDialCode, { maxLength: 12 }),
      clientPhoneNumber: cleanText(castingData.phoneNumber, { maxLength: 40 }),
      message: cleanText(castingData.selfDescription || 'Casting application'),
      serviceCategory: 'casting_application',
      serviceTitle: 'تقديم للكاستينج',
      castingNumber,
      identityFrontUrl: publicUploadUrl(req, frontFile),
      identityBackUrl: publicUploadUrl(req, backFile),
      passportUrl: publicUploadUrl(req, passportFile),
      castingData,
      submittedBy: req.user.id,
      actionHistory: [
        {
          action: 'created',
          message: `Casting application submitted with number ${castingNumber}`,
          createdBy: req.user.id,
        },
      ],
    });

    await response.save();
    try {
      await notifyAdminsAboutNewResponse(response);
    } catch (notificationError) {
      console.error('Failed to notify admins about casting application:', notificationError.message);
    }

    res.json({ message: 'Casting application submitted successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/casting/:id', authMiddleware, castingUpload, async (req, res) => {
  try {
    const response = await Response.findById(req.params.id);
    if (!response || response.serviceCategory !== 'casting_application') {
      return res.status(404).json({ message: 'Casting application not found' });
    }
    if (String(response.submittedBy) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const castingData = parseJsonField(req.body.castingData, response.castingData || {});
    response.castingData = castingData;
    response.clientName = cleanText(castingData.name || response.clientName, { maxLength: 120 });
    response.clientPhoneCountry = cleanText(castingData.country || response.clientPhoneCountry, { maxLength: 120 });
    response.clientPhoneDialCode = cleanText(castingData.phoneDialCode || response.clientPhoneDialCode, { maxLength: 12 });
    response.clientPhoneNumber = cleanText(castingData.phoneNumber || response.clientPhoneNumber, { maxLength: 40 });
    response.message = cleanText(castingData.selfDescription || response.message);
    response.identityFrontUrl = publicUploadUrl(req, req.files?.identityFront?.[0]) || response.identityFrontUrl;
    response.identityBackUrl = publicUploadUrl(req, req.files?.identityBack?.[0]) || response.identityBackUrl;
    response.passportUrl = publicUploadUrl(req, req.files?.passport?.[0]) || response.passportUrl;
    response.editRequested = false;
    if (response.status === 'needs_edit') response.status = 'pending';
    response.actionHistory.push({
      action: 'updated',
      message: 'Casting application updated',
      createdBy: req.user.id,
    });

    await response.save();
    res.json({ message: 'Casting application updated successfully', response });
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
    const allowed = [
      'pending',
      'approved',
      'rejected',
      'replied',
      'resolved',
      'needs_edit',
      'qualified',
      'unqualified',
      'contract_released',
    ];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const response = await Response.findByIdAndUpdate(
      req.params.id,
      {
        status,
        editRequested: status === 'needs_edit',
        $push: {
          actionHistory: {
            action: `status_${status}`,
            message: cleanText(req.body.message, { maxLength: 1000 }) || `Status changed to ${status}`,
            createdBy: req.user.id,
          },
        },
      },
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

router.post('/casting/:id/appointment', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const appointmentAt = new Date(req.body.appointmentAt);
    if (Number.isNaN(appointmentAt.getTime())) {
      return res.status(400).json({ message: 'Invalid appointment date' });
    }

    const response = await Response.findByIdAndUpdate(
      req.params.id,
      {
        appointmentAt,
        status: 'approved',
        editRequested: false,
        $push: {
          actionHistory: {
            action: 'appointment_scheduled',
            message: cleanText(req.body.message, { maxLength: 1000 }) || `Appointment scheduled at ${formatRiyadhDateTime(appointmentAt)}`,
            createdBy: req.user.id,
          },
        },
      },
      { new: true }
    );

    if (!response || response.serviceCategory !== 'casting_application') {
      return res.status(404).json({ message: 'Casting application not found' });
    }

    try {
      await notifyClientAboutStatus(response, 'approved', req.user.id);
    } catch (notificationError) {
      console.error('Failed to notify client about casting appointment:', notificationError.message);
    }

    res.json({ message: 'Appointment scheduled successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/casting/:id/result', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = cleanText(req.body.result, { maxLength: 32 });
    if (!['qualified', 'unqualified'].includes(result)) {
      return res.status(400).json({ message: 'Invalid casting result' });
    }

    const note = cleanText(req.body.note, { maxLength: 1000 });
    const response = await Response.findByIdAndUpdate(
      req.params.id,
      {
        status: result,
        editRequested: false,
        $push: {
          actionHistory: {
            action: `interview_${result}`,
            message: note || (result === 'qualified'
              ? 'Interview result: qualified'
              : 'Interview result: unqualified'),
            createdBy: req.user.id,
          },
        },
      },
      { new: true }
    );

    if (!response || response.serviceCategory !== 'casting_application') {
      return res.status(404).json({ message: 'Casting application not found' });
    }

    try {
      await notifyClientAboutCastingResult(response, result, req.user.id, note);
    } catch (notificationError) {
      console.error('Failed to notify client about casting result:', notificationError.message);
    }

    res.json({ message: 'Casting result updated successfully', response });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/casting/:id/release-contract', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const note = cleanText(req.body.note, { maxLength: 1000 });
    const response = await Response.findByIdAndUpdate(
      req.params.id,
      {
        status: 'contract_released',
        editRequested: false,
        $push: {
          actionHistory: {
            action: 'contract_released',
            message: note || 'Casting contract released',
            createdBy: req.user.id,
          },
        },
      },
      { new: true }
    );

    if (!response || response.serviceCategory !== 'casting_application') {
      return res.status(404).json({ message: 'Casting application not found' });
    }

    try {
      await notifyClientAboutContractRelease(response, req.user.id, note);
    } catch (notificationError) {
      console.error('Failed to notify client about contract release:', notificationError.message);
    }

    res.json({ message: 'Casting contract released successfully', response });
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
