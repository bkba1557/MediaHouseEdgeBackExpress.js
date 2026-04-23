const mongoose = require('mongoose');

const AboutMediaSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: '',
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

const AboutSectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      default: '',
      trim: true,
    },
    media: [AboutMediaSchema],
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const AboutPageSchema = new mongoose.Schema(
  {
    heroTitle: {
      type: String,
      default: 'من نحن',
      trim: true,
    },
    heroSubtitle: {
      type: String,
      default: '',
      trim: true,
    },
    intro: {
      type: String,
      default: '',
      trim: true,
    },
    sections: [AboutSectionSchema],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AboutPage', AboutPageSchema);
