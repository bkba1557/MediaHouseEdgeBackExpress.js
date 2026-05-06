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
  castingNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  organizationName: String,
  evidenceUrl: String,
  identityFrontUrl: String,
  identityBackUrl: String,
  passportUrl: String,
  castingData: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  appointmentAt: Date,
  appointmentReminderSent: {
    type: Boolean,
    default: false
  },
  editRequested: {
    type: Boolean,
    default: false
  },
  actionHistory: {
    type: [
      {
        action: String,
        message: String,
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    default: []
  },
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
    enum: [
      'pending',
      'approved',
      'rejected',
      'replied',
      'resolved',
      'needs_edit',
      'qualified',
      'unqualified',
      'contract_released'
    ],
    default: 'pending'
  },
  adminReply: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Response', ResponseSchema);
