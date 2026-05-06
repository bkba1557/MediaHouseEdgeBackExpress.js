const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DeviceTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web', 'macos', 'windows', 'linux', 'unknown'],
      default: 'unknown',
    },
    deviceId: {
      type: String,
      trim: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  firebaseUid: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    required: true
  },
  authProviders: {
    type: [String],
    default: ['password'],
  },
  role: {
    type: String,
    enum: ['admin', 'client', 'guest'],
    default: 'client'
  },
  customerTier: {
    type: String,
    enum: ['regular', 'vip', 'key_account'],
    default: 'regular',
  },
  accountType: {
    type: String,
    enum: ['client', 'casting'],
    default: 'client',
  },
  fcmTokens: {
    type: [DeviceTokenSchema],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);
