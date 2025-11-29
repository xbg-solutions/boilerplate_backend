# Realtime Connector

> Real-time communication via Server-Sent Events (SSE) and WebSockets

## Overview

The Realtime Connector provides real-time, bidirectional communication between server and clients. It supports both Server-Sent Events (SSE) for server-to-client streaming and WebSockets for full-duplex communication.

## Features

- **Server-Sent Events (SSE)** for server-to-client streaming
- **WebSocket** support for bidirectional communication
- **Channel-based messaging** for topic subscriptions
- **User-specific messaging** for targeted updates
- **Client management** with connection tracking
- **Heartbeat/keep-alive** for connection stability
- **Message broadcasting** to multiple clients
- **Metadata support** for client context
- **Provider abstraction** (SSE or WebSocket)

## Installation

```typescript
import {
  createRealtimeConnector,
  getRealtimeConnector,
  RealtimeConnector,
} from '../utilities/realtime-connector';
```

## Configuration

```typescript
export const COMMUNICATIONS_CONFIG = {
  realtime: {
    enabled: true,
    provider: 'sse', // or 'websocket'
    providers: {
      sse: {
        heartbeatInterval: 30000, // 30 seconds
      },
      websocket: {
        port: 8080,
        path: '/ws',
      },
    },
  },
};
```

## Usage

### Broadcast Message

```typescript
const realtimeConnector = getRealtimeConnector();

await realtimeConnector.broadcast({
  type: 'notification',
  data: {
    message: 'New order received',
    orderId: '12345',
  },
});
```

### Send to Channel

```typescript
await realtimeConnector.broadcast({
  type: 'update',
  data: { status: 'processing' },
}, {
  channel: 'orders',
});
```

### Send to Specific User

```typescript
await realtimeConnector.broadcast({
  type: 'alert',
  data: { message: 'Payment successful' },
}, {
  userId: 'user-123',
});
```

## Known Gaps & Future Enhancements

### Missing Features
- [ ] **Presence detection** (online/offline status)
- [ ] **Typing indicators** for chat applications
- [ ] **Read receipts** for messages
- [ ] **Message persistence** and replay
- [ ] **Connection recovery** after disconnect
- [ ] **Message queuing** for offline clients
- [ ] **Rate limiting** per client/channel
- [ ] **Authentication** for WebSocket connections
- [ ] **Encryption** for sensitive data
- [ ] **Channel permissions** and access control
- [ ] **Scalability** with Redis pub/sub
- [ ] **Load balancing** across multiple servers
- [ ] **Message acknowledgment** system

## Event-Driven Usage

```typescript
import { eventBus } from '../utilities/events';

eventBus.subscribe('order.created', async (event) => {
  const realtimeConnector = getRealtimeConnector();

  await realtimeConnector?.broadcast({
    type: 'order.created',
    data: event.payload,
  }, {
    channel: 'orders',
  });
});
```

## Related Components

- **communications.config.ts**: Realtime configuration
- **events**: Event-driven real-time updates

## References

- [Server-Sent Events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
