const express = require('express');
const AboutPage = require('../models/AboutPage');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function cleanMediaList(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean)
    .map((item) => ({
      title: (item.title || '').toString().trim(),
      description: (item.description || '').toString().trim(),
      type: (item.type || '').toString().trim().toLowerCase(),
      url: (item.url || '').toString().trim(),
      thumbnail: (item.thumbnail || '').toString().trim(),
    }))
    .filter((item) => item.url && ['image', 'video'].includes(item.type));
}

function cleanSections(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const title = (item.title || '').toString().trim();
      if (!title) return null;
      return {
        title,
        body: (item.body || '').toString().trim(),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        media: cleanMediaList(item.media),
      };
    })
    .filter(Boolean);
}

function emptyPage() {
  return {
    heroTitle: 'من نحن',
    heroSubtitle: '',
    intro: '',
    sections: [],
  };
}

router.get('/', async (req, res) => {
  try {
    const page = await AboutPage.findOne().sort({ updatedAt: -1 });
    res.json(page || emptyPage());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const payload = {
      heroTitle: (req.body.heroTitle || 'من نحن').toString().trim(),
      heroSubtitle: (req.body.heroSubtitle || '').toString().trim(),
      intro: (req.body.intro || '').toString().trim(),
      sections: cleanSections(req.body.sections),
      updatedBy: req.user.id,
    };

    const existing = await AboutPage.findOne().sort({ updatedAt: -1 });
    let page;

    if (existing) {
      Object.assign(existing, payload);
      page = await existing.save();
    } else {
      page = await AboutPage.create(payload);
    }

    res.json({ message: 'About page updated successfully', page });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
