const express = require('express');
const TeamMember = require('../models/TeamMember');
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

function cleanStringList(value) {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => item?.toString().trim() || '')
    .filter((item) => item.length > 0);
}

function cleanAssetList(value) {
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
    .filter((item) => item.title && item.url && ['image', 'video'].includes(item.type));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanText(value, { maxLength = 3000, fallback = '' } = {}) {
  const text = (value || '').toString().trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeActor(req) {
  return {
    userId: cleanText(req.body?.userId ?? req.query?.userId, { maxLength: 128 }),
    clientId: cleanText(req.body?.clientId ?? req.query?.clientId, {
      maxLength: 128,
    }),
  };
}

function likeMatchesActor(like, actor) {
  if (!like || !actor) return false;
  if (actor.userId && like.userId && actor.userId === like.userId) return true;
  if (actor.clientId && like.clientId && actor.clientId === like.clientId) {
    return true;
  }
  return false;
}

async function getTotalTeamViews() {
  const totals = await TeamMember.aggregate([
    {
      $group: {
        _id: null,
        totalViews: { $sum: '$viewsCount' },
      },
    },
  ]);

  return totals[0]?.totalViews || 0;
}

function serializeComment(comment) {
  return {
    _id: comment._id?.toString() || '',
    authorName: cleanText(comment.authorName, { maxLength: 80, fallback: 'زائر' }),
    message: cleanText(comment.message, { maxLength: 2000 }),
    createdAt: comment.createdAt || null,
  };
}

function serializeMember(member, { totalViews = 0, actor } = {}) {
  const raw = member.toObject();
  const likes = Array.isArray(member.likes) ? member.likes : [];
  const comments = Array.isArray(member.comments) ? member.comments : [];
  const viewsCount = toNumber(member.viewsCount, 0);
  const likesCount = likes.length;
  const commentsCount = comments.length;
  const viewSharePercent =
    totalViews > 0 ? Number(((viewsCount / totalViews) * 100).toFixed(1)) : 0;

  delete raw.likes;

  return {
    ...raw,
    viewsCount,
    likesCount,
    commentsCount,
    viewSharePercent,
    likedByCurrentActor: likes.some((like) => likeMatchesActor(like, actor)),
    comments: comments
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(serializeComment),
  };
}

router.get('/', async (req, res) => {
  try {
    const actor = normalizeActor(req);
    const members = await TeamMember.find().sort({ order: 1, createdAt: -1 });
    const totalViews = await getTotalTeamViews();
    res.json(
      members.map((member) => serializeMember(member, { totalViews, actor }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const actor = normalizeActor(req);
    const member = await TeamMember.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }
    const totalViews = await getTotalTeamViews();
    res.json(serializeMember(member, { totalViews, actor }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || '').toString().trim();
    const role = (req.body.role || '').toString().trim();

    if (!name || !role) {
      return res.status(400).json({ message: 'Name and role are required' });
    }

    const member = new TeamMember({
      name,
      role,
      bio: (req.body.bio || '').toString().trim(),
      photoUrl: (req.body.photoUrl || '').toString().trim(),
      skills: cleanStringList(req.body.skills),
      portfolio: cleanAssetList(req.body.portfolio),
      certifications: cleanAssetList(req.body.certifications),
      order: toNumber(req.body.order, 0),
    });

    await member.save();
    const totalViews = await getTotalTeamViews();
    res.json({
      message: 'Team member created successfully',
      member: serializeMember(member, { totalViews }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const update = {};
    const scalarFields = ['name', 'role', 'bio', 'photoUrl'];

    for (const field of scalarFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        update[field] = (req.body[field] || '').toString().trim();
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'skills')) {
      update.skills = cleanStringList(req.body.skills);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'portfolio')) {
      update.portfolio = cleanAssetList(req.body.portfolio);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'certifications')) {
      update.certifications = cleanAssetList(req.body.certifications);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'order')) {
      update.order = toNumber(req.body.order, 0);
    }

    const member = await TeamMember.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    const totalViews = await getTotalTeamViews();
    res.json({
      message: 'Team member updated successfully',
      member: serializeMember(member, { totalViews }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/view', async (req, res) => {
  try {
    const actor = normalizeActor(req);
    const member = await TeamMember.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewsCount: 1 } },
      { new: true }
    );

    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    const totalViews = await getTotalTeamViews();
    res.json({
      message: 'View registered successfully',
      member: serializeMember(member, { totalViews, actor }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/like', async (req, res) => {
  try {
    const actor = normalizeActor(req);
    if (!actor.clientId && !actor.userId) {
      return res
        .status(400)
        .json({ message: 'A client or user identity is required' });
    }

    const member = await TeamMember.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    const likes = Array.isArray(member.likes) ? member.likes : [];
    const existingIndex = likes.findIndex((like) => likeMatchesActor(like, actor));

    let liked = false;
    if (existingIndex >= 0) {
      member.likes.splice(existingIndex, 1);
    } else {
      member.likes.push({
        userId: actor.userId,
        clientId: actor.clientId,
      });
      liked = true;
    }

    await member.save();

    const totalViews = await getTotalTeamViews();
    res.json({
      message: liked ? 'Like added successfully' : 'Like removed successfully',
      liked,
      likesCount: member.likes.length,
      member: serializeMember(member, { totalViews, actor }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/comments', async (req, res) => {
  try {
    const actor = normalizeActor(req);
    const authorName = cleanText(req.body.authorName, {
      maxLength: 80,
      fallback: 'زائر',
    });
    const message = cleanText(req.body.message, { maxLength: 2000 });

    if (!message) {
      return res.status(400).json({ message: 'Comment message is required' });
    }

    const member = await TeamMember.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    member.comments.unshift({
      authorName,
      message,
      userId: actor.userId,
    });

    if (member.comments.length > 200) {
      member.comments.splice(200);
    }

    await member.save();

    const totalViews = await getTotalTeamViews();
    const latestComment = member.comments[0];
    res.json({
      message: 'Comment added successfully',
      comment: latestComment ? serializeComment(latestComment) : null,
      member: serializeMember(member, { totalViews, actor }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const member = await TeamMember.findByIdAndDelete(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Team member not found' });
    }
    res.json({ message: 'Team member deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
