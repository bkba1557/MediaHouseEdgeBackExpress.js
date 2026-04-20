require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');

// Edit these values, then run: node create-admin.js
const adminData = {
  username: 'admin',
  email: 'mohamedaliarafat21@gmail.com',
  password: '123456',
};

const mongoUri = process.env.MONGO_URI || 'mongodb+srv://bkba15577:Qwert1557@cluster2.riqygx8.mongodb.net/';

const createAdmin = async () => {
  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const usernameOwner = await User.findOne({ username: adminData.username });
    const emailOwner = await User.findOne({ email: adminData.email });

    if (
      usernameOwner &&
      emailOwner &&
      String(usernameOwner._id) !== String(emailOwner._id)
    ) {
      throw new Error('Username and email are used by two different accounts.');
    }

    const admin = usernameOwner || emailOwner || new User();
    admin.username = adminData.username;
    admin.email = adminData.email;
    admin.password = adminData.password;
    admin.role = 'admin';

    await admin.save();

    console.log(`Admin account is ready: ${admin.email}`);
  } catch (error) {
    console.error('Failed to create admin account:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

createAdmin();
