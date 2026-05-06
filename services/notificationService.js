const Notification = require('../models/Notification');
const User = require('../models/User');
const { getMessaging } = require('./firebaseAdmin');
const nodemailer = require('nodemailer');

const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function cleanText(value, { maxLength = 500 } = {}) {
  const text = (value ?? '').toString().trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeData(data = {}) {
  return Object.entries(data).reduce((result, [key, value]) => {
    if (value === undefined || value === null) {
      return result;
    }
    result[key] = value.toString();
    return result;
  }, {});
}

function getMailTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD,
    },
  });
}

function formatRiyadhDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} توقيت الرياض`;
}

function buildBilingualEmailHtml({ titleAr, titleEn, bodyAr, bodyEn, details = [] }) {
  const rows = details
    .filter((item) => item && (item.value || item.value === 0))
    .map((item) => `
      <tr>
        <td style="padding:10px 12px;color:#bbbbbb;border-bottom:1px solid #2a2a2a">${item.labelAr}<br><span style="font-size:12px;color:#888">${item.labelEn}</span></td>
        <td style="padding:10px 12px;color:#ffffff;border-bottom:1px solid #2a2a2a">${item.value}</td>
      </tr>`)
    .join('');

  return `
  <div style="margin:0;padding:0;background:#050505;color:#fff;font-family:Arial,Tahoma,sans-serif">
    <div style="max-width:680px;margin:0 auto;padding:28px 18px">
      <div style="border:1px solid #2a2a2a;border-top:4px solid #e50914;background:#111;border-radius:10px;overflow:hidden">
        <div style="padding:22px 24px;background:#090909">
          <h1 style="margin:0;color:#fff;font-size:22px;line-height:1.4">${titleAr}</h1>
          <p style="margin:6px 0 0;color:#e50914;font-weight:700">${titleEn}</p>
        </div>
        <div style="padding:24px;line-height:1.8">
          <p dir="rtl" style="margin:0 0 14px;text-align:right">${bodyAr}</p>
          <p style="margin:0 0 18px;color:#d7d7d7">${bodyEn}</p>
          ${rows ? `<table style="width:100%;border-collapse:collapse;background:#171717;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden">${rows}</table>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

async function sendEmail({ to, subject, text, html }) {
  const recipients = Array.isArray(to)
    ? to.map((value) => cleanText(value, { maxLength: 254 })).filter(Boolean)
    : [cleanText(to, { maxLength: 254 })].filter(Boolean);
  if (recipients.length === 0) return null;

  const transporter = getMailTransporter();
  if (!transporter) {
    console.log(`Email skipped; SMTP is not configured. Subject: ${subject}`);
    return null;
  }

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients,
    subject,
    text,
    html,
  });
}

function chunkArray(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function dedupeTokens(users) {
  const uniqueTokens = new Set();

  for (const user of users) {
    for (const entry of user.fcmTokens || []) {
      const token = cleanText(entry?.token, { maxLength: 4096 });
      if (token) uniqueTokens.add(token);
    }
  }

  return Array.from(uniqueTokens);
}

async function removeInvalidTokens(tokens) {
  if (!tokens.length) return;

  await User.updateMany(
    { 'fcmTokens.token': { $in: tokens } },
    {
      $pull: {
        fcmTokens: {
          token: { $in: tokens },
        },
      },
    }
  );
}

async function sendPushToUsers(users, { title, body, data = {} }) {
  const messaging = getMessaging();
  const tokens = dedupeTokens(users);

  if (!messaging || tokens.length === 0) {
    return {
      attempted: false,
      successCount: 0,
      failureCount: 0,
      removedTokenCount: 0,
    };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const chunks = chunkArray(tokens, 500);

  for (const chunk of chunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'mediahouse_general',
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((item, index) => {
      const errorCode = item.error?.code;
      if (!item.success && errorCode && INVALID_TOKEN_ERROR_CODES.has(errorCode)) {
        invalidTokens.push(chunk[index]);
      }
    });
  }

  await removeInvalidTokens(invalidTokens);

  return {
    attempted: true,
    successCount,
    failureCount,
    removedTokenCount: invalidTokens.length,
  };
}

async function createNotificationsForUsers({
  recipientIds,
  title,
  body,
  type,
  data = {},
  createdBy,
  audience = 'single',
}) {
  const uniqueRecipientIds = Array.from(
    new Set(
      (recipientIds || [])
        .map((value) => value?.toString().trim())
        .filter(Boolean)
    )
  );

  if (uniqueRecipientIds.length === 0) {
    return {
      notifications: [],
      delivery: {
        attempted: false,
        successCount: 0,
        failureCount: 0,
        removedTokenCount: 0,
      },
    };
  }

  const recipients = await User.find({
    _id: { $in: uniqueRecipientIds },
  });

  if (recipients.length === 0) {
    return {
      notifications: [],
      delivery: {
        attempted: false,
        successCount: 0,
        failureCount: 0,
        removedTokenCount: 0,
      },
    };
  }

  const normalizedData = normalizeData(data);
  const notificationTitle = cleanText(title, { maxLength: 140 });
  const notificationBody = cleanText(body, { maxLength: 500 });
  const delivery = await sendPushToUsers(recipients, {
    title: notificationTitle,
    body: notificationBody,
    data: {
      type,
      ...normalizedData,
    },
  });

  const notifications = await Notification.insertMany(
    recipients.map((recipient) => ({
      recipient: recipient._id,
      audience,
      title: notificationTitle,
      body: notificationBody,
      type: cleanText(type, { maxLength: 80 }) || 'general',
      data: normalizedData,
      createdBy,
      delivery: {
        pushAttempted: delivery.attempted,
        pushSuccess: delivery.successCount > 0,
        failureCount: delivery.failureCount,
      },
    }))
  );

  return { notifications, delivery };
}

async function findUserByResponse(response) {
  if (response.submittedBy) {
    const user = await User.findById(response.submittedBy);
    if (user) return user;
  }

  const normalizedEmail = cleanText(response.clientEmail, { maxLength: 254 }).toLowerCase();
  if (!normalizedEmail) return null;

  return User.findOne({ email: normalizedEmail });
}

async function notifyAdminsAboutNewResponse(response) {
  const admins = await User.find({ role: 'admin' }).select('_id email fcmTokens');
  const isServiceRequest = Boolean(cleanText(response.serviceCategory));
  const isCasting = response.serviceCategory === 'casting_application';
  const requestLabel = cleanText(
    response.serviceTitle || response.serviceCategory || 'Service request',
    { maxLength: 160 }
  );

  const result = await createNotificationsForUsers({
    recipientIds: admins.map((user) => user._id),
    title: isCasting ? 'New casting request' : isServiceRequest ? 'New service request' : 'New client feedback',
    body: isServiceRequest
      ? `${cleanText(response.clientName, { maxLength: 80 })} submitted ${requestLabel}.`
      : `${cleanText(response.clientName, { maxLength: 80 })} sent new feedback.`,
    type: isServiceRequest ? 'service_request_created' : 'feedback_created',
    audience: 'admins',
    data: {
      responseId: response._id,
      kind: isServiceRequest ? 'service' : 'feedback',
      serviceTitle: requestLabel,
    },
    createdBy: response.submittedBy,
  });

  if (isServiceRequest) {
    await sendEmail({
      to: admins.map((user) => user.email),
      subject: isCasting
        ? 'New Media House Edge casting application'
        : 'New Media House Edge service access request',
      text: [
        `${cleanText(response.clientName, { maxLength: 80 })} submitted ${requestLabel}.`,
        `Email: ${cleanText(response.clientEmail, { maxLength: 254 })}`,
        `Phone: ${cleanText(response.clientPhoneDialCode)} ${cleanText(response.clientPhoneNumber)}`,
        `Organization: ${cleanText(response.organizationName, { maxLength: 180 }) || '-'}`,
        `Evidence: ${cleanText(response.evidenceUrl, { maxLength: 2048 }) || '-'}`,
      ].join('\n'),
      html: buildBilingualEmailHtml({
        titleAr: isCasting ? 'طلب كاستينج جديد' : 'طلب خدمة جديد',
        titleEn: isCasting ? 'New Casting Application' : 'New Service Request',
        bodyAr: `${cleanText(response.clientName, { maxLength: 80 })} قام بإرسال ${requestLabel}.`,
        bodyEn: `${cleanText(response.clientName, { maxLength: 80 })} submitted ${requestLabel}.`,
        details: [
          { labelAr: 'رقم القيد', labelEn: 'Casting Number', value: response.castingNumber },
          { labelAr: 'البريد', labelEn: 'Email', value: cleanText(response.clientEmail, { maxLength: 254 }) },
          { labelAr: 'الجوال', labelEn: 'Phone', value: `${cleanText(response.clientPhoneDialCode)} ${cleanText(response.clientPhoneNumber)}`.trim() },
          { labelAr: 'الدولة', labelEn: 'Country', value: response.castingData?.country || response.clientPhoneCountry },
          { labelAr: 'نوع الهوية', labelEn: 'ID Type', value: response.castingData?.identityType },
          { labelAr: 'المرفق', labelEn: 'Attachment', value: cleanText(response.evidenceUrl, { maxLength: 2048 }) || response.identityFrontUrl || response.passportUrl },
        ],
      }),
    });
  }

  return result;
}

async function notifyClientAboutReply(response, actorId) {
  const user = await findUserByResponse(response);
  if (!user) return null;

  const requestLabel = cleanText(
    response.serviceTitle || response.serviceCategory || 'your request',
    { maxLength: 160 }
  );

  return createNotificationsForUsers({
    recipientIds: [user._id],
    title: 'New admin reply',
    body: `The admin replied to ${requestLabel}.`,
    type: 'admin_reply',
    data: {
      responseId: response._id,
      kind: cleanText(response.serviceCategory) ? 'service' : 'feedback',
      serviceTitle: requestLabel,
    },
    createdBy: actorId,
  });
}

async function notifyClientAboutStatus(response, status, actorId) {
  const user = await findUserByResponse(response);
  if (!user) return null;

  const requestLabel = cleanText(
    response.serviceTitle || response.serviceCategory || 'your request',
    { maxLength: 160 }
  );
  const readableStatus = cleanText(status, { maxLength: 32 }) || response.status;

  const result = await createNotificationsForUsers({
    recipientIds: [user._id],
    title: 'Request status updated',
    body: `${requestLabel} is now ${readableStatus}.`,
    type: 'request_status_updated',
    data: {
      responseId: response._id,
      status: readableStatus,
      kind: cleanText(response.serviceCategory) ? 'service' : 'feedback',
      serviceTitle: requestLabel,
    },
    createdBy: actorId,
  });

  if (readableStatus === 'approved') {
    await sendEmail({
      to: user.email || response.clientEmail,
      subject: response.serviceCategory === 'casting_application'
        ? 'Media House Edge casting appointment'
        : 'Media House Edge service request approved',
      text: `${requestLabel} has been approved.`,
      html: buildBilingualEmailHtml({
        titleAr: 'تحديث على طلبك',
        titleEn: 'Your request was updated',
        bodyAr: response.appointmentAt
          ? `تم قبول طلبك وتحديد موعد المقابلة.`
          : `تم قبول طلبك.`,
        bodyEn: response.appointmentAt
          ? `Your request was approved and an interview appointment was scheduled.`
          : `Your request was approved.`,
        details: [
          { labelAr: 'الطلب', labelEn: 'Request', value: requestLabel },
          { labelAr: 'رقم القيد', labelEn: 'Casting Number', value: response.castingNumber },
          { labelAr: 'الحالة', labelEn: 'Status', value: readableStatus },
          { labelAr: 'الموعد', labelEn: 'Appointment', value: response.appointmentAt ? formatRiyadhDateTime(response.appointmentAt) : '' },
        ],
      }),
    });
  }

  return result;
}

async function notifyClientAboutCastingResult(response, result, actorId, note = '') {
  const user = await findUserByResponse(response);
  if (!user) return null;

  const isQualified = result === 'qualified';
  const resultAr = isQualified ? 'مؤهل' : 'غير مؤهل';
  const resultEn = isQualified ? 'Qualified' : 'Not Qualified';
  const castingNumber = response.castingNumber || response._id.toString();

  const notification = await createNotificationsForUsers({
    recipientIds: [user._id],
    title: isQualified ? 'Casting interview result' : 'Casting interview result',
    body: isQualified
      ? `Your casting interview result is qualified.`
      : `Your casting interview result is not qualified.`,
    type: 'casting_interview_result',
    data: {
      responseId: response._id,
      castingNumber,
      result,
      kind: 'service',
    },
    createdBy: actorId,
  });

  await sendEmail({
    to: user.email || response.clientEmail,
    subject: `Media House Edge casting result - ${resultEn}`,
    text: `Casting request ${castingNumber} result: ${resultEn}`,
    html: buildBilingualEmailHtml({
      titleAr: 'نتيجة مقابلة الكاستينج',
      titleEn: 'Casting Interview Result',
      bodyAr: isQualified
        ? 'نود إبلاغكم بأنه تم قبولكم في المقابلة وأنكم مؤهلون.'
        : 'نود إبلاغكم بنتيجة المقابلة، وحاليا لم يتم تأهيلكم.',
      bodyEn: isQualified
        ? 'We are pleased to inform you that your interview result is qualified.'
        : 'We would like to inform you that your interview result is currently not qualified.',
      details: [
        { labelAr: 'رقم القيد', labelEn: 'Casting Number', value: castingNumber },
        { labelAr: 'النتيجة', labelEn: 'Result', value: `${resultAr} / ${resultEn}` },
        { labelAr: 'ملاحظة الإدارة', labelEn: 'Admin Note', value: cleanText(note, { maxLength: 1000 }) },
      ],
    }),
  });

  return notification;
}

async function notifyClientAboutContractRelease(response, actorId, note = '') {
  const user = await findUserByResponse(response);
  if (!user) return null;

  const castingNumber = response.castingNumber || response._id.toString();
  const cleanNote = cleanText(note, { maxLength: 1000 });

  const notification = await createNotificationsForUsers({
    recipientIds: [user._id],
    title: 'Casting contract released',
    body: `The casting contract for ${castingNumber} has been released.`,
    type: 'casting_contract_released',
    data: {
      responseId: response._id,
      castingNumber,
      kind: 'service',
    },
    createdBy: actorId,
  });

  await sendEmail({
    to: user.email || response.clientEmail,
    subject: 'Media House Edge casting contract released',
    text: `Casting contract ${castingNumber} has been released.`,
    html: buildBilingualEmailHtml({
      titleAr: 'فك تعاقد الكاستينج',
      titleEn: 'Casting Contract Released',
      bodyAr: 'نود إبلاغكم بأنه تم فك التعاقد الخاص بطلب الكاستينج.',
      bodyEn: 'We would like to inform you that the casting contract has been released.',
      details: [
        { labelAr: 'رقم القيد', labelEn: 'Casting Number', value: castingNumber },
        { labelAr: 'التاريخ', labelEn: 'Date', value: formatRiyadhDateTime(new Date()) },
        { labelAr: 'ملاحظة الإدارة', labelEn: 'Admin Note', value: cleanNote },
      ],
    }),
  });

  return notification;
}

async function notifyClientAboutContract(response, contract, actorId, action = 'added') {
  const user = await findUserByResponse(response);
  if (!user) return null;

  const requestLabel = cleanText(
    response.serviceTitle || response.serviceCategory || 'your service request',
    { maxLength: 160 }
  );
  const contractTitle = cleanText(contract?.title, { maxLength: 160 }) || 'contract';

  return createNotificationsForUsers({
    recipientIds: [user._id],
    title: action === 'updated' ? 'Contract updated' : 'New contract added',
    body:
      action === 'updated'
        ? `${contractTitle} was updated for ${requestLabel}.`
        : `${contractTitle} was added to ${requestLabel}.`,
    type: action === 'updated' ? 'contract_updated' : 'contract_added',
    data: {
      responseId: response._id,
      contractId: contract?._id,
      contractTitle,
      kind: 'service',
      serviceTitle: requestLabel,
    },
    createdBy: actorId,
  });
}

async function notifyUsersByCriteria({
  title,
  body,
  type = 'promo',
  data = {},
  createdBy,
  audience = 'broadcast',
  userId,
}) {
  let recipients = [];

  if (audience === 'single_user') {
    recipients = await User.find({
      _id: userId,
      role: { $ne: 'guest' },
    }).select('_id fcmTokens');
  } else {
    recipients = await User.find({
      role: 'client',
    }).select('_id fcmTokens');
  }

  return createNotificationsForUsers({
    recipientIds: recipients.map((user) => user._id),
    title,
    body,
    type,
    data,
    createdBy,
    audience: audience === 'single_user' ? 'single' : 'broadcast',
  });
}

module.exports = {
  cleanText,
  createNotificationsForUsers,
  notifyAdminsAboutNewResponse,
  notifyClientAboutReply,
  notifyClientAboutStatus,
  notifyClientAboutCastingResult,
  notifyClientAboutContractRelease,
  notifyClientAboutContract,
  notifyUsersByCriteria,
  sendEmail,
  buildBilingualEmailHtml,
  formatRiyadhDateTime,
};
