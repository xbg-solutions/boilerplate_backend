# Push Notifications Connector

> Send push notifications to mobile and web apps via APNs, FCM, and other providers

## Overview

The Push Notifications Connector provides push notification delivery to iOS, Android, and web applications through Apple Push Notification service (APNs), Firebase Cloud Messaging (FCM), and other providers.

## Features

- **iOS push** via APNs
- **Android push** via FCM
- **Web push** notifications
- **Topic-based** messaging
- **User targeting**
- **Batch notifications**
- **Rich media** support
- **Provider abstraction**

## Configuration

```typescript
export const COMMUNICATIONS_CONFIG = {
  pushNotifications: {
    enabled: true,
    provider: 'fcm', // 'apns' | 'onesignal'
    providers: {
      fcm: {
        serviceAccount: process.env.FCM_SERVICE_ACCOUNT || '',
      },
      apns: {
        keyId: process.env.APNS_KEY_ID || '',
        teamId: process.env.APNS_TEAM_ID || '',
        key: process.env.APNS_KEY || '',
        production: true,
      },
    },
  },
};
```

## Usage

```typescript
const pushConnector = getPushNotificationsConnector();

// Send notification
await pushConnector.send({
  tokens: ['device-token-1', 'device-token-2'],
  notification: {
    title: 'New Message',
    body: 'You have a new message from John',
    imageUrl: 'https://example.com/image.jpg',
  },
  data: {
    messageId: 'msg-123',
    senderId: 'user-456',
  },
});

// Send to topic
await pushConnector.sendToTopic({
  topic: 'news-updates',
  notification: {
    title: 'Breaking News',
    body: 'Important update available',
  },
});
```

## Known Gaps & Future Enhancements

### Missing Providers
- [ ] **APNs** provider implementation
- [ ] **FCM** provider implementation
- [ ] **OneSignal** provider implementation
- [ ] **Airship** provider
- [ ] **Pusher Beams** provider

### Missing Features
- [ ] **Silent notifications** for background updates
- [ ] **Action buttons** in notifications
- [ ] **Notification groups** and threading
- [ ] **Badge** count management
- [ ] **Sound** customization
- [ ] **Priority** levels (high/normal)
- [ ] **Time-to-live** (TTL) settings
- [ ] **Device group** messaging
- [ ] **A/B testing** for notifications
- [ ] **Analytics** (delivery, open rates)
- [ ] **Scheduling** for future delivery
- [ ] **Geofencing** triggers
- [ ] **Rich media** (images, video, audio)
- [ ] **Deep linking** support

## References

- [APNs Documentation](https://developer.apple.com/documentation/usernotifications)
- [FCM Documentation](https://firebase.google.com/docs/cloud-messaging)
- [OneSignal Documentation](https://documentation.onesignal.com/)
