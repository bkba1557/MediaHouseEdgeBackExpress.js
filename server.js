// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const path = require('path');
// const http = require('http');
// const socketIo = require('socket.io');
// require('dotenv').config();

// const app = express();
// const server = http.createServer(app);
// const io = socketIo(server, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST"]
//   }
// });

// // Middleware
// app.use(cors());
// app.use(express.json());
// app.use('/uploads', express.static('uploads'));

// // MongoDB Connection
// mongoose.connect('mongodb+srv://bkba15577:Qwert1557@cluster2.riqygx8.mongodb.net/', {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// }).then(() => console.log('MongoDB connected'))
//   .catch(err => console.log(err));

// // Socket.io for real-time updates
// io.on('connection', (socket) => {
//   console.log('New client connected');
//   socket.on('disconnect', () => {
//     console.log('Client disconnected');
//   });
// });

// // Routes
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/media', require('./routes/media'));
// app.use('/api/responses', require('./routes/responses'));

// const PORT = process.env.PORT || 6019;
// server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const Response = require('./models/Response');
const User = require('./models/User');
const Counter = require('./models/Counter');
const {
  createNotificationsForUsers,
  sendEmail,
  buildBilingualEmailHtml,
  formatRiyadhDateTime,
} = require('./services/notificationService');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// When running behind Nginx/Cloudflare, trust proxy headers so `req.protocol`
// reflects the original HTTPS scheme (X-Forwarded-Proto).
app.set('trust proxy', true);

const allowedOrigins = [
  'https://mediahouseedge.com',
  'https://www.mediahouseedge.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MediaHouse Edge API is running',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI is missing in .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    ensureCastingNumbers().catch((error) => {
      console.error('Failed to ensure casting numbers:', error.message);
    });
    startCastingAppointmentReminderJob();
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Make io available inside routes if needed
app.set('io', io);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/media', require('./routes/media'));
app.use('/api/responses', require('./routes/responses'));
app.use('/api/team', require('./routes/team'));
app.use('/api/about', require('./routes/about'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/users', require('./routes/users'));

async function ensureCastingNumbers() {
  const missing = await Response.find({
    serviceCategory: 'casting_application',
    $or: [
      { castingNumber: { $exists: false } },
      { castingNumber: null },
      { castingNumber: '' },
    ],
  }).sort({ createdAt: 1 });

  const numbered = await Response.find({
    serviceCategory: 'casting_application',
    castingNumber: /^MHE-\d{6}$/,
  }).select('castingNumber');

  let maxSequence = numbered.reduce((max, item) => {
    const match = String(item.castingNumber || '').match(/^MHE-(\d{6})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  for (const request of missing) {
    maxSequence += 1;
    request.castingNumber = `MHE-${String(maxSequence).padStart(6, '0')}`;
    request.actionHistory.push({
      action: 'casting_number_assigned',
      message: `Casting number assigned ${request.castingNumber}`,
    });
    await request.save();
  }

  await Counter.findOneAndUpdate(
    { key: 'casting_application' },
    { $max: { sequence: maxSequence } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

function startCastingAppointmentReminderJob() {
  const intervalMs = 60 * 60 * 1000;
  const run = async () => {
    try {
      const now = new Date();
      const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const requests = await Response.find({
        serviceCategory: 'casting_application',
        status: 'approved',
        appointmentAt: { $gte: now, $lte: next24h },
        appointmentReminderSent: { $ne: true },
      }).limit(50);

      for (const request of requests) {
        const user = request.submittedBy
          ? await User.findById(request.submittedBy).select('_id email fcmTokens')
          : await User.findOne({ email: request.clientEmail }).select('_id email fcmTokens');
        if (!user) continue;

        await createNotificationsForUsers({
          recipientIds: [user._id],
          title: 'Casting appointment reminder',
          body: 'Your casting interview is scheduled within 24 hours.',
          type: 'casting_appointment_reminder',
          data: {
            responseId: request._id,
            appointmentAt: request.appointmentAt.toISOString(),
            kind: 'service',
          },
        });

        await sendEmail({
          to: user.email || request.clientEmail,
          subject: 'Media House Edge casting appointment reminder',
          text: `Your casting interview is scheduled at ${formatRiyadhDateTime(request.appointmentAt)}.`,
          html: buildBilingualEmailHtml({
            titleAr: 'تذكير بموعد مقابلة الكاستينج',
            titleEn: 'Casting Appointment Reminder',
            bodyAr: 'موعد مقابلة الكاستينج الخاص بكم خلال 24 ساعة.',
            bodyEn: 'Your casting interview is scheduled within 24 hours.',
            details: [
              { labelAr: 'رقم الطلب', labelEn: 'Request ID', value: request._id.toString() },
              { labelAr: 'رقم القيد', labelEn: 'Casting Number', value: request.castingNumber },
              { labelAr: 'الموعد', labelEn: 'Appointment', value: formatRiyadhDateTime(request.appointmentAt) },
            ],
          }),
        });

        request.appointmentReminderSent = true;
        request.actionHistory.push({
          action: 'appointment_reminder_sent',
          message: 'Appointment reminder sent',
        });
        await request.save();
      }
    } catch (error) {
      console.error('Casting appointment reminder job failed:', error.message);
    }
  };

  setTimeout(run, 30 * 1000);
  setInterval(run, intervalMs);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 6019;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
