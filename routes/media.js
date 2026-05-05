const express = require('express');
const multer = require('multer');
const path = require('path');

const Media = require('../models/Media');
const MediaFolderConfig = require('../models/MediaFolderConfig');
const Response = require('../models/Response');
const User = require('../models/User');
const { authMiddleware, optionalAuthMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const restrictedCategories = new Set([
  'gov_partnership_ads',
  'international_institutions',
]);
const categoriesRequiringFolder = new Set([
  'series_movies',
  'artist_contracts',
  'commercial_ads',
]);

const defaultFolderTitlesByCategory = {
  artist_contracts: ['مطربين ومطربات', 'فنانيين شعبي', 'مهرجنات شعبية'],
  commercial_ads: [
    'المجال الطبي',
    'مطاعم وكافيهات',
    'مقاولات واستثمار عقاري',
    'منتجات',
    'اخر',
  ],
};

function normalizeText(value) {
  return (value || '').toString().trim();
}

async function userCanAccessCategory(req, category) {
  const normalizedCategory = normalizeText(category);
  if (!restrictedCategories.has(normalizedCategory)) return true;
  if (!req.user || req.user.role === 'guest') return false;
  if (req.user.role === 'admin') return true;

  const user = await User.findById(req.user.id).select('email role').lean();
  if (!user) return false;
  if (user.role === 'admin') return true;

  const ownership = [{ submittedBy: req.user.id }];
  if (user.email) {
    ownership.push({
      clientEmail: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
  }

  const approved = await Response.exists({
    serviceCategory: normalizedCategory,
    status: 'approved',
    $or: ownership,
  });

  return Boolean(approved);
}

function buildCollectionKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\\/#?%&+]/g, '')
    .replace(/\s+/g, '_');
}

function defaultFoldersForCategory(category) {
  const titles = defaultFolderTitlesByCategory[normalizeText(category)] || [];
  return titles.map((title, index) => ({
    collectionKey: buildCollectionKey(title),
    collectionTitle: title,
    sortOrder: index,
  }));
}

function validateFolderFields(category, collectionKey, collectionTitle) {
  if (!categoriesRequiringFolder.has(normalizeText(category))) {
    return null;
  }

  if (!normalizeText(collectionKey) || !normalizeText(collectionTitle)) {
    return 'Folder name is required for this category';
  }

  return null;
}

async function getNextFolderSortOrder(category) {
  const normalizedCategory = normalizeText(category);
  const defaultCount = defaultFoldersForCategory(normalizedCategory).length;
  const lastConfig = await MediaFolderConfig.findOne({
    category: normalizedCategory,
  })
    .sort({ sortOrder: -1, updatedAt: -1 })
    .lean();

  if (!lastConfig || !Number.isFinite(lastConfig.sortOrder)) {
    return defaultCount;
  }

  return Math.max(defaultCount, lastConfig.sortOrder + 1);
}

async function ensureFolderConfig({ category, collectionKey, collectionTitle }) {
  const normalizedCategory = normalizeText(category);
  const normalizedKey = normalizeText(collectionKey);
  const normalizedTitle = normalizeText(collectionTitle);

  if (!categoriesRequiringFolder.has(normalizedCategory)) {
    return null;
  }

  if (!normalizedKey || !normalizedTitle) {
    return null;
  }

  const defaultFolder = defaultFoldersForCategory(normalizedCategory).find(
    (item) => item.collectionKey === normalizedKey,
  );

  const existing = await MediaFolderConfig.findOne({
    category: normalizedCategory,
    collectionKey: normalizedKey,
  });

  if (existing) {
    let changed = false;

    if (existing.collectionTitle !== normalizedTitle) {
      existing.collectionTitle = normalizedTitle;
      changed = true;
    }

    if (!Number.isFinite(existing.sortOrder)) {
      existing.sortOrder = defaultFolder
        ? defaultFolder.sortOrder
        : await getNextFolderSortOrder(normalizedCategory);
      changed = true;
    }

    if (changed) {
      await existing.save();
    }

    return existing;
  }

  const sortOrder = defaultFolder
    ? defaultFolder.sortOrder
    : await getNextFolderSortOrder(normalizedCategory);

  return MediaFolderConfig.findOneAndUpdate(
    {
      category: normalizedCategory,
      collectionKey: normalizedKey,
    },
    {
      category: normalizedCategory,
      collectionKey: normalizedKey,
      collectionTitle: normalizedTitle,
      sortOrder,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );
}

async function listFoldersForCategory(category) {
  const normalizedCategory = normalizeText(category);
  if (!normalizedCategory) {
    return [];
  }

  const [mediaItems, configs] = await Promise.all([
    Media.find({ category: normalizedCategory }).sort({ createdAt: -1 }).lean(),
    MediaFolderConfig.find({ category: normalizedCategory })
      .sort({ sortOrder: 1, updatedAt: 1 })
      .lean(),
  ]);

  const folders = new Map();

  for (const preset of defaultFoldersForCategory(normalizedCategory)) {
    folders.set(preset.collectionKey, {
      collectionKey: preset.collectionKey,
      collectionTitle: preset.collectionTitle,
      count: 0,
      previewUrl: '',
      sortOrder: preset.sortOrder,
    });
  }

  for (const config of configs) {
    const key = normalizeText(config.collectionKey);
    const title = normalizeText(config.collectionTitle);
    if (!key || !title) continue;

    const existing = folders.get(key) || {
      collectionKey: key,
      collectionTitle: title,
      count: 0,
      previewUrl: '',
      sortOrder: null,
    };

    folders.set(key, {
      ...existing,
      collectionTitle: title,
      sortOrder: Number.isFinite(config.sortOrder) ? config.sortOrder : null,
    });
  }

  for (const item of mediaItems) {
    const key = normalizeText(item.collectionKey);
    const title = normalizeText(item.collectionTitle);
    if (!key || !title) continue;

    const existing = folders.get(key) || {
      collectionKey: key,
      collectionTitle: title,
      count: 0,
      previewUrl: '',
      sortOrder: null,
    };

    folders.set(key, {
      ...existing,
      collectionTitle: existing.collectionTitle || title,
      count: (existing.count || 0) + 1,
      previewUrl:
        existing.previewUrl ||
        normalizeText(item.thumbnail) ||
        (item.type === 'image' ? normalizeText(item.url) : ''),
    });
  }

  return Array.from(folders.values()).sort((a, b) => {
    const aHasOrder = Number.isFinite(a.sortOrder);
    const bHasOrder = Number.isFinite(b.sortOrder);

    if (aHasOrder && bHasOrder) {
      const byOrder = a.sortOrder - b.sortOrder;
      if (byOrder !== 0) return byOrder;
    } else if (aHasOrder) {
      return -1;
    } else if (bHasOrder) {
      return 1;
    }

    return a.collectionTitle.localeCompare(b.collectionTitle, 'ar');
  });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  }

  cb(new Error('Only images and videos are allowed'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Upload media (admin only)
router.post(
  '/upload',
  authMiddleware,
  adminMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      const {
        title,
        description,
        type,
        category,
        url,
        thumbnail,
        crew,
        collectionKey,
        collectionTitle,
        sequence,
      } = req.body;

      const folderError = validateFolderFields(
        category,
        collectionKey,
        collectionTitle,
      );
      if (folderError) {
        return res.status(400).json({ message: folderError });
      }

      const publicBaseUrl = (
        process.env.PUBLIC_BASE_URL ||
        `${req.protocol}://${req.get('host')}`
      ).replace(/\/+$/, '');

      const fileUrl =
        url ||
        (req.file ? `${publicBaseUrl}/uploads/${req.file.filename}` : null);

      if (!fileUrl) {
        return res.status(400).json({ message: 'File URL is required' });
      }

      let parsedCrew = crew;
      if (typeof parsedCrew === 'string') {
        try {
          parsedCrew = JSON.parse(parsedCrew);
        } catch (_) {
          parsedCrew = undefined;
        }
      }

      const media = new Media({
        title,
        description,
        type,
        category,
        url: fileUrl,
        thumbnail,
        crew: Array.isArray(parsedCrew) ? parsedCrew : undefined,
        collectionKey,
        collectionTitle,
        sequence,
        uploadedBy: req.user.id,
      });

      await media.save();
      await ensureFolderConfig({ category, collectionKey, collectionTitle });

      res.json({ message: 'Media uploaded successfully', media });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

router.get('/folders', optionalAuthMiddleware, async (req, res) => {
  try {
    const category = normalizeText(req.query.category);
    if (!category) {
      return res.status(400).json({ message: 'Category is required' });
    }

    if (!(await userCanAccessCategory(req, category))) {
      return res.status(403).json({ message: 'Service access is pending approval' });
    }

    const folders = await listFoldersForCategory(category);
    res.json(folders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch(
  '/folders/reorder',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const category = normalizeText(req.body.category);
      const folders = Array.isArray(req.body.folders) ? req.body.folders : [];

      if (!category) {
        return res.status(400).json({ message: 'Category is required' });
      }

      const currentFolders = await listFoldersForCategory(category);
      const currentByKey = new Map(
        currentFolders.map((item) => [item.collectionKey, item]),
      );
      const seen = new Set();
      let nextSortOrder = 0;

      for (const item of folders) {
        const key = normalizeText(item?.collectionKey);
        if (!key || seen.has(key)) continue;

        const current = currentByKey.get(key);
        const title =
          normalizeText(item?.collectionTitle) ||
          normalizeText(current?.collectionTitle);

        if (!title) continue;

        seen.add(key);
        await MediaFolderConfig.findOneAndUpdate(
          { category, collectionKey: key },
          {
            category,
            collectionKey: key,
            collectionTitle: title,
            sortOrder: nextSortOrder++,
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );
      }

      for (const folder of currentFolders) {
        if (seen.has(folder.collectionKey)) continue;

        await MediaFolderConfig.findOneAndUpdate(
          { category, collectionKey: folder.collectionKey },
          {
            category,
            collectionKey: folder.collectionKey,
            collectionTitle: folder.collectionTitle,
            sortOrder: nextSortOrder++,
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );
      }

      res.json({
        message: 'Folder order updated successfully',
        folders: await listFoldersForCategory(category),
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

// Get all media
router.get('/all', optionalAuthMiddleware, async (req, res) => {
  try {
    const { type, category } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (category) {
      if (!(await userCanAccessCategory(req, category))) {
        return res.status(403).json({ message: 'Service access is pending approval' });
      }
      filter.category = category;
    } else {
      filter.category = { $nin: Array.from(restrictedCategories) };
    }

    const media = await Media.find(filter)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'username');
    res.json(media);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single media
router.get('/:id', optionalAuthMiddleware, async (req, res) => {
  try {
    const media = await Media.findById(req.params.id).populate(
      'uploadedBy',
      'username',
    );
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    if (!(await userCanAccessCategory(req, media.category))) {
      return res.status(403).json({ message: 'Service access is pending approval' });
    }

    media.views += 1;
    await media.save();

    res.json(media);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update media metadata (admin only)
router.patch('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const allowed = [
      'title',
      'description',
      'type',
      'category',
      'url',
      'thumbnail',
      'crew',
      'collectionKey',
      'collectionTitle',
      'sequence',
    ];
    const update = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = req.body[key];
      }
    }

    const nextCategory = Object.prototype.hasOwnProperty.call(update, 'category')
      ? update.category
      : undefined;
    const existingMedia = await Media.findById(req.params.id);
    if (!existingMedia) {
      return res.status(404).json({ message: 'Media not found' });
    }

    const resolvedCategory = normalizeText(nextCategory || existingMedia.category);
    const resolvedCollectionKey = Object.prototype.hasOwnProperty.call(
      update,
      'collectionKey',
    )
      ? update.collectionKey
      : existingMedia.collectionKey;
    const resolvedCollectionTitle = Object.prototype.hasOwnProperty.call(
      update,
      'collectionTitle',
    )
      ? update.collectionTitle
      : existingMedia.collectionTitle;

    const folderError = validateFolderFields(
      resolvedCategory,
      resolvedCollectionKey,
      resolvedCollectionTitle,
    );
    if (folderError) {
      return res.status(400).json({ message: folderError });
    }

    const media = await Media.findByIdAndUpdate(req.params.id, update, {
      new: true,
    }).populate('uploadedBy', 'username');

    await ensureFolderConfig({
      category: resolvedCategory,
      collectionKey: resolvedCollectionKey,
      collectionTitle: resolvedCollectionTitle,
    });

    res.json({ message: 'Media updated successfully', media });
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
