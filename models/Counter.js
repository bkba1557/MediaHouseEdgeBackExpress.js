const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  sequence: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model('Counter', CounterSchema);
