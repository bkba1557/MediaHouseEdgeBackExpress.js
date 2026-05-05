const mongoose = require('mongoose');

const ResponseContractSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    contractNumber: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'signed', 'completed', 'cancelled'],
      default: 'active'
    },
    description: {
      type: String,
      trim: true
    },
    documentUrl: {
      type: String,
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

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
  organizationName: String,
  evidenceUrl: String,
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  contracts: {
    type: [ResponseContractSchema],
    default: []
  },
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
