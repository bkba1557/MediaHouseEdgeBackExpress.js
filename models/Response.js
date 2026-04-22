const mongoose = require('mongoose');

const ResponseSchema = new mongoose.Schema({
  clientName: {
    type: String,
    required: true
  },
  clientEmail: {
    type: String,
    required: true
  },
  clientPhoneCountry: String,
  clientPhoneDialCode: String,
  clientPhoneNumber: String,
  message: {
    type: String,
    required: true
  },
  mediaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media'
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  serviceCategory: String,
  serviceTitle: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'replied', 'resolved'],
    default: 'pending'
  },
  adminReply: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Response', ResponseSchema);
