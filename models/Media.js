const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
  url: {
    type: String,
    required: true
  },
  thumbnail: String,
  crew: [
    {
      name: String,
      role: String,
      photoUrl: String
    }
  ],
  collectionKey: String,
  collectionTitle: String,
  sequence: Number,
  category: {
    type: String,
    enum: [
      'film',
      'montage',
      'advertisement',
      'story',
      'series_movies',
      'ads_shooting',
      'podcast',
      'video_clip',
      'art_production',
      'platform_distribution',
      'commercial_ads',
      'global_events',
      'media_coverage',
      'audio_recordings',
      'gov_partnership_ads'
    ],
    default: 'film'
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  views: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Media', MediaSchema);
