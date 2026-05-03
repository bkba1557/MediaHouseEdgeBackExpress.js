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

function cleanText(value) {
  return (value || '').toString().trim();
}

function cleanMediaList(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean)
    .map((item) => ({
      title: cleanText(item.title),
      description: cleanText(item.description),
      type: cleanText(item.type).toLowerCase(),
      url: cleanText(item.url),
      thumbnail: cleanText(item.thumbnail),
    }))
    .filter((item) => item.url && ['image', 'video'].includes(item.type));
}

function cleanSections(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const title = cleanText(item.title);
      if (!title) return null;

      return {
        title,
        body: cleanText(item.body),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
        media: cleanMediaList(item.media),
      };
    })
    .filter(Boolean);
}

function cleanCompanyProfile(value) {
  const parsed = parseMaybeJson(value);
  const source = parsed && typeof parsed === 'object' ? parsed : {};

  return {
    commercialRegister: cleanText(source.commercialRegister),
    taxNumber: cleanText(source.taxNumber),
    addressAr: cleanText(source.addressAr),
    addressEn: cleanText(source.addressEn),
    phone: cleanText(source.phone),
    email: cleanText(source.email),
    website: cleanText(source.website),
    whatsapp: cleanText(source.whatsapp),
  };
}

const allowedSocialTypes = new Set([
  'facebook',
  'instagram',
  'x',
  'linkedin',
  'youtube',
  'tiktok',
  'snapchat',
  'whatsapp',
  'website',
]);

function cleanSocialLinks(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean)
    .map((item) => ({
      type: cleanText(item.type).toLowerCase(),
      url: cleanText(item.url),
    }))
    .filter((item) => item.url && allowedSocialTypes.has(item.type));
}

function cleanSuccessPartners(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean)
    .map((item) => ({
      name: cleanText(item.name),
      logoUrl: cleanText(item.logoUrl || item.logo),
    }))
    .filter((item) => item.name && item.logoUrl);
}

function emptyPage() {
  return {
    heroTitle: 'من نحن',
    heroSubtitle: '',
    intro: '',
    companyProfile: {},
    sections: [],
    socialLinks: [],
    successPartners: [],
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
      heroTitle: cleanText(req.body.heroTitle) || 'من نحن',
      heroSubtitle: cleanText(req.body.heroSubtitle),
      intro: cleanText(req.body.intro),
      companyProfile: cleanCompanyProfile(req.body.companyProfile),
      sections: cleanSections(req.body.sections),
      socialLinks: cleanSocialLinks(req.body.socialLinks),
      successPartners: cleanSuccessPartners(req.body.successPartners),
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
