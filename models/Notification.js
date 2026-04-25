const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    audience: {
      type: String,
      enum: ['single', 'broadcast', 'admins', 'system'],
      default: 'single',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    data: {
      type: Map,
      of: String,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: Date,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    delivery: {
      pushAttempted: {
        type: Boolean,
        default: false,
      },
      pushSuccess: {
        type: Boolean,
        default: false,
      },
      failureCount: {
        type: Number,
        default: 0,
      },
      lastError: {
        type: String,
        trim: true,
      },
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
