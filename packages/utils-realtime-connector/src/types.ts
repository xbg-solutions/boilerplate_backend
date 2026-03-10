/**
 * Realtime Connector Types
 * For SSE and WebSocket real-time communication
 */

export interface RealtimeMessage {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
}

export interface RealtimeClient {
  id: string;
  userId?: string;
  channels: string[];
  metadata?: Record<string, any>;
}

export interface BroadcastOptions {
  channel?: string;
  userId?: string;
  excludeClient?: string;
}

export interface SSEResponse {
  write: (data: string) => void;
  end: () => void;
}
