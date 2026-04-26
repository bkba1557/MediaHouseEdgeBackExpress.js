const mongoose = require('mongoose');

const MediaFolderConfigSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    collectionKey: {
      type: String,
      required: true,
      trim: true,
    },
    collectionTitle: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

MediaFolderConfigSchema.index(
  { category: 1, collectionKey: 1 },
  { unique: true },
);

module.exports = mongoose.model('MediaFolderConfig', MediaFolderConfigSchema);
