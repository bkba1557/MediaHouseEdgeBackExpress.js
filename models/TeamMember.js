const mongoose = require('mongoose');

const PortfolioItemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnail: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: true }
);

const TeamLikeSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: '',
      trim: true,
    },
    clientId: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    _id: false,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const TeamCommentSchema = new mongoose.Schema(
  {
    authorName: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    _id: true,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const TeamMemberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    bio: {
      type: String,
      default: '',
      trim: true,
    },
    photoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    skills: [
      {
        type: String,
        trim: true,
      },
    ],
    portfolio: [PortfolioItemSchema],
    certifications: [PortfolioItemSchema],
    order: {
      type: Number,
      default: 0,
    },
    viewsCount: {
      type: Number,
      default: 0,
    },
    likes: {
      type: [TeamLikeSchema],
      default: [],
    },
    comments: {
      type: [TeamCommentSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TeamMember', TeamMemberSchema);
