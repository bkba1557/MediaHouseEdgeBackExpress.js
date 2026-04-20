const express = require('express');
const multer = require('multer');
const path = require('path');
const Media = require('../models/Media');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images and videos are allowed'));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Upload media (admin only)
router.post('/upload', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { title, description, type, category, url, thumbnail } = req.body;
    const fileUrl = url || (req.file
      ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      : null);

    if (!fileUrl) {
      return res.status(400).json({ message: 'File URL is required' });
    }
    
    const media = new Media({
      title,
      description,
      type,
      category,
      url: fileUrl,
      thumbnail,
      uploadedBy: req.user.id
    });
    
    await media.save();
    res.json({ message: 'Media uploaded successfully', media });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all media
router.get('/all', async (req, res) => {
  try {
    const { type, category } = req.query;
    let filter = {};
    if (type) filter.type = type;
    if (category) filter.category = category;
    
    const media = await Media.find(filter).sort({ createdAt: -1 }).populate('uploadedBy', 'username');
    res.json(media);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single media
router.get('/:id', async (req, res) => {
  try {
    const media = await Media.findById(req.params.id).populate('uploadedBy', 'username');
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }
    
    media.views += 1;
    await media.save();
    
    res.json(media);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete media (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const media = await Media.findByIdAndDelete(req.params.id);
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }
    res.json({ message: 'Media deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
