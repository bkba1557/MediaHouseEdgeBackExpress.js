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

const CompanyProfileSchema = new mongoose.Schema(
  {
    commercialRegister: {
      type: String,
      default: '',
      trim: true,
    },
    taxNumber: {
      type: String,
      default: '',
      trim: true,
    },
    addressAr: {
      type: String,
      default: '',
      trim: true,
    },
    addressEn: {
      type: String,
      default: '',
      trim: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
    },
    website: {
      type: String,
      default: '',
      trim: true,
    },
    whatsapp: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
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
    companyProfile: {
      type: CompanyProfileSchema,
      default: () => ({}),
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
