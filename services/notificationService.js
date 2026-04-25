const Notification = require('../models/Notification');
const User = require('../models/User');
const { getMessaging } = require('./firebaseAdmin');

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
  const admins = await User.find({ role: 'admin' }).select('_id fcmTokens');
  const isServiceRequest = Boolean(cleanText(response.serviceCategory));
  const requestLabel = cleanText(
    response.serviceTitle || response.serviceCategory || 'Service request',
    { maxLength: 160 }
  );

  return createNotificationsForUsers({
    recipientIds: admins.map((user) => user._id),
    title: isServiceRequest ? 'New service request' : 'New client feedback',
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

  return createNotificationsForUsers({
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
  notifyClientAboutContract,
  notifyUsersByCriteria,
};
