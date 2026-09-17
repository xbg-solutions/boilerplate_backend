/**
 * Sent SMS Provider
 * Implementation using the Sent v3 unified messaging API
 * https://docs.sent.dm/reference/api
 *
 * Sent routes SMS, WhatsApp and RCS through one endpoint. This provider implements only
 * the SMS slice of that surface: every send pins `channel: ['sms']`, which also disables
 * Sent's cross-channel fallback. WhatsApp and RCS are deliberately out of reach here —
 * they have no expression in `SMSProvider`, and giving them one belongs to a messaging
 * connector with its own interface, not to this one.
 *
 * FREE-FORM TEXT IS NOT ALWAYS ACCEPTED. Sent takes `text` only inside an open
 * conversation, or within 7 days of an approved template send. A cold outbound send must
 * therefore use a template, which has no home on `SMSRequest`, so it is passed through
 * `metadata.template` — the same escape hatch the Twilio provider uses for
 * `metadata.statusCallback`. A request carrying a template ignores `message`; the v3 API
 * rejects a request that sets both or neither.
 *
 * Fields of `SMSRequest` with no v3 equivalent are ignored, as the MessageBird provider
 * already ignores `mediaUrls` and `tags`:
 *   - `from`           Sent assigns the outbound number from the account's own pool
 *   - `mediaUrls`      MMS is not a v3 channel
 *   - `validityPeriod` Sent manages its own retry window
 *   - `tags`           no request-level equivalent
 *
 * Neither the send response nor the message record carries a price, so `cost` and
 * `totalCost` are left undefined rather than reported as a misleading 0.
 */

import { SMSProvider } from '../sms-connector';
import {
  SMSRequest,
  SMSResult,
  SMSError,
  BulkSMSResult,
  MessageStatus,
  DeliveryReport,
} from '../types';

export interface SentDmConfig {
  apiKey: string;
  /** Override the API origin. Defaults to https://api.sent.dm */
  baseURL?: string;
  /** Validate requests without sending. Per-request `metadata.sandbox` wins over this. */
  sandbox?: boolean;
  /** Per-attempt timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Retry attempts after the first. Defaults to 3; set 0 to disable. */
  maxRetries?: number;
}

/** Shape accepted at `SMSRequest.metadata.template`. */
export interface SentDmTemplate {
  id: string;
  parameters?: Record<string, string | number>;
}

const PROVIDER = 'sentdm';
const DEFAULT_BASE_URL = 'https://api.sent.dm';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30000;

/** The documented per-request recipient ceiling for POST /v3/messages. */
const MAX_RECIPIENTS_PER_REQUEST = 1000;

/** Statuses that mean the message reached Sent and then stopped short. */
const FAILURE_STATUSES = new Set(['FAILED', 'FILTERED', 'BLOCKED']);

interface SentDmEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string } | null;
  meta?: { request_id?: string; timestamp?: string; version?: string };
}

interface SendData {
  status?: string;
  template_id?: string;
  template_name?: string;
  recipients?: Array<{ message_id: string; to: string; channel: string }>;
}

interface MessageEvent {
  status?: string;
  timestamp?: string;
  description?: string;
}

interface MessageData {
  id: string;
  phone?: string;
  outbound_number?: string;
  template_name?: string;
  text?: string;
  channel?: string;
  status?: string;
  direction?: string;
  created_at?: string;
  events?: MessageEvent[];
}

interface SentDmRequestError extends Error {
  code: string;
  status?: number;
  requestId?: string;
  retryable: boolean;
  retryAfterMs?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SentDmProvider implements SMSProvider {
  private baseURL: string;
  private headers: Record<string, string>;
  private sandbox: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: SentDmConfig) {
    this.baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.sandbox = config.sandbox === true;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.headers = {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send one SMS.
   */
  async sendMessage(request: SMSRequest): Promise<SMSResult> {
    const invalid = this.validate(request);
    if (invalid) {
      return { success: false, error: invalid, provider: PROVIDER, timestamp: new Date() };
    }

    try {
      const envelope = await this.request<SendData>('/v3/messages', {
        method: 'POST',
        body: this.buildPayload(request, [request.to]),
      });

      return {
        success: true,
        messageId: envelope.data?.recipients?.[0]?.message_id,
        provider: PROVIDER,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: this.toSMSError(error),
        provider: PROVIDER,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send many SMS.
   *
   * Unlike Twilio and MessageBird, Sent takes up to 1,000 recipients in a single request,
   * so this batches rather than looping: requests sharing one body are grouped, each group
   * is chunked to the ceiling, and each chunk costs one round trip. A 1,000-recipient send
   * is one call here against 1,000 sequential calls elsewhere.
   *
   * A chunk fails as a unit — every request in it takes that chunk's error — because the
   * v3 API accepts or rejects the whole request.
   */
  async sendBulk(requests: SMSRequest[]): Promise<BulkSMSResult> {
    const results: SMSResult[] = new Array(requests.length);
    const groups = new Map<string, number[]>();

    for (let i = 0; i < requests.length; i++) {
      const invalid = this.validate(requests[i]);
      if (invalid) {
        results[i] = { success: false, error: invalid, provider: PROVIDER, timestamp: new Date() };
        continue;
      }

      const key = this.payloadKey(requests[i]);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        groups.set(key, [i]);
      }
    }

    for (const indices of groups.values()) {
      for (let offset = 0; offset < indices.length; offset += MAX_RECIPIENTS_PER_REQUEST) {
        await this.sendChunk(
          requests,
          indices.slice(offset, offset + MAX_RECIPIENTS_PER_REQUEST),
          results
        );
      }
    }

    let successful = 0;
    let failed = 0;
    for (const result of results) {
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      success: failed === 0,
      successful,
      failed,
      results,
      timestamp: new Date(),
    };
  }

  /**
   * Get message status
   */
  async getMessageStatus(messageId: string): Promise<MessageStatus> {
    const envelope = await this.request<MessageData>(
      `/v3/messages/${encodeURIComponent(messageId)}`
    );
    const data = envelope.data;
    const failure = this.lastFailureEvent(data);

    return {
      messageId: data.id,
      status: this.mapSentDmStatus(data.status),
      to: data.phone || '',
      // v3 reports neither the outbound number nor the rendered body on this record; the
      // template name is the closest identification of what was sent.
      from: data.outbound_number || '',
      body: data.text || data.template_name || '',
      errorCode: failure?.status,
      errorMessage: failure?.description,
      timestamp: data.created_at ? new Date(data.created_at) : new Date(),
    };
  }

  /**
   * Get delivery report
   */
  async getDeliveryReport(messageId: string): Promise<DeliveryReport> {
    const envelope = await this.request<MessageData>(
      `/v3/messages/${encodeURIComponent(messageId)}`
    );
    const data = envelope.data;
    const deliveredEvent = data.events?.find((event) => event.status === 'DELIVERED');
    const failure = this.lastFailureEvent(data);

    return {
      messageId: data.id,
      // READ implies delivered, and is the terminal status on channels that report it.
      delivered: data.status === 'DELIVERED' || data.status === 'READ',
      deliveredAt: deliveredEvent?.timestamp ? new Date(deliveredEvent.timestamp) : undefined,
      errorCode: failure?.status,
      errorMessage: failure?.description,
    };
  }

  /**
   * Send one chunk of a bulk request as a single v3 call.
   */
  private async sendChunk(
    requests: SMSRequest[],
    indices: number[],
    results: SMSResult[]
  ): Promise<void> {
    const numbers = indices.map((index) => requests[index].to);
    const timestamp = new Date();

    let envelope: SentDmEnvelope<SendData>;
    try {
      envelope = await this.request<SendData>('/v3/messages', {
        method: 'POST',
        body: this.buildPayload(requests[indices[0]], numbers),
      });
    } catch (error: any) {
      const smsError = this.toSMSError(error);
      for (const index of indices) {
        results[index] = { success: false, error: smsError, provider: PROVIDER, timestamp };
      }
      return;
    }

    // Match ids on the number rather than on position, so a reordered response cannot
    // misattribute one. A queue per number keeps a repeated recipient honest, and position
    // is the fallback for a number the API echoed in a different format.
    const recipients = envelope.data?.recipients || [];
    const byNumber = new Map<string, string[]>();
    for (const recipient of recipients) {
      const queue = byNumber.get(recipient.to);
      if (queue) {
        queue.push(recipient.message_id);
      } else {
        byNumber.set(recipient.to, [recipient.message_id]);
      }
    }

    for (let position = 0; position < indices.length; position++) {
      const index = indices[position];
      const matched = byNumber.get(requests[index].to)?.shift();
      results[index] = {
        success: true,
        messageId: matched ?? recipients[position]?.message_id,
        provider: PROVIDER,
        timestamp,
      };
    }
  }

  /**
   * Build the v3 request body for a set of recipients.
   */
  private buildPayload(request: SMSRequest, to: string[]): Record<string, any> {
    const template = request.metadata?.template as SentDmTemplate | undefined;
    const payload: Record<string, any> = { to, channel: ['sms'] };

    if (template) {
      payload.template = {
        id: template.id,
        ...(template.parameters ? { parameters: template.parameters } : {}),
      };
    } else {
      payload.text = request.message;
    }

    if (request.metadata?.sandbox ?? this.sandbox) {
      payload.sandbox = true;
    }

    return payload;
  }

  /**
   * The body of a request, minus its recipients — the key requests must share to batch
   * together. `buildPayload` inserts keys in a fixed order, so the serialisation is stable.
   */
  private payloadKey(request: SMSRequest): string {
    const { to: _recipients, ...body } = this.buildPayload(request, []);
    return JSON.stringify(body);
  }

  /**
   * Reject locally what v3 would reject anyway, to save a round trip.
   */
  private validate(request: SMSRequest): SMSError | null {
    const template = request.metadata?.template as SentDmTemplate | undefined;

    if (template && !template.id) {
      return {
        code: 'VALIDATION_ERROR',
        message: 'metadata.template requires an id',
      };
    }

    if (!template && !request.message) {
      return {
        code: 'VALIDATION_ERROR',
        message:
          'A message body is required. Sent accepts free-form text only inside an open ' +
          'conversation; a cold send needs metadata.template.',
      };
    }

    return null;
  }

  /**
   * The last event that stopped the message, if any.
   */
  private lastFailureEvent(data: MessageData): MessageEvent | undefined {
    if (!data.events?.length) return undefined;

    for (let i = data.events.length - 1; i >= 0; i--) {
      const event = data.events[i];
      if (event.status && FAILURE_STATUSES.has(event.status)) return event;
    }

    return undefined;
  }

  /**
   * Issue a request, retrying where a retry is SAFE.
   *
   * v3 has no idempotency key, so replaying a POST that the server had in fact accepted
   * would send the message twice. Only 429 is retried on a send — it is a rejection, so
   * nothing was queued. A 5xx or a timeout on a send is reported, never replayed; on a GET,
   * which carries no such risk, both are retried.
   */
  private async request<T = any>(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<SentDmEnvelope<T>> {
    const { method = 'GET', body } = options;
    const idempotent = method === 'GET';
    const url = `${this.baseURL}${path}`;
    let lastError: SentDmRequestError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await delay(this.backoffMs(attempt, lastError));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: this.headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (error: any) {
        lastError = this.transportError(error);
        if (idempotent && attempt < this.maxRetries) continue;
        throw lastError;
      } finally {
        clearTimeout(timer);
      }

      const payload = await res.json().catch(() => undefined);

      if (res.ok) {
        // A 2xx carrying success:false is still a failure; trust the envelope over the code.
        if (payload && payload.success === false) throw this.apiError(res, payload);
        return payload as SentDmEnvelope<T>;
      }

      lastError = this.apiError(res, payload);

      const retryable = lastError.status === 429 || (idempotent && lastError.retryable);
      if (retryable && attempt < this.maxRetries) continue;
      throw lastError;
    }

    throw lastError;
  }

  private apiError(res: Response, payload: any): SentDmRequestError {
    const error = new Error(
      payload?.error?.message || `HTTP ${res.status}: ${res.statusText}`
    ) as SentDmRequestError;

    error.code = String(payload?.error?.code || `HTTP_${res.status}`);
    error.status = res.status;
    error.requestId = payload?.meta?.request_id;
    error.retryable = res.status === 429 || res.status >= 500;

    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      error.retryAfterMs = retryAfter * 1000;
    }

    return error;
  }

  private transportError(cause: any): SentDmRequestError {
    const aborted = cause?.name === 'AbortError';
    const error = new Error(
      aborted ? `Request timed out after ${this.timeoutMs}ms` : cause?.message || 'Network error'
    ) as SentDmRequestError;

    error.code = aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
    error.retryable = true;

    return error;
  }

  /** Exponential backoff — 1s, 2s, 4s — capped, jittered, and yielding to Retry-After. */
  private backoffMs(attempt: number, previous?: SentDmRequestError): number {
    if (previous?.retryAfterMs !== undefined) {
      return Math.min(previous.retryAfterMs, MAX_RETRY_DELAY_MS);
    }

    const base = Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    return base + Math.floor(Math.random() * 1000);
  }

  private toSMSError(error: any): SMSError {
    const typed = error as SentDmRequestError;

    return {
      code: typed?.code || 'SENTDM_ERROR',
      message: typed?.message || 'Unknown Sent error',
      details: {
        status: typed?.status,
        requestId: typed?.requestId,
        retryable: typed?.retryable === true,
      },
    };
  }

  /**
   * Map a Sent status to the connector's own vocabulary.
   *
   * FILTERED and BLOCKED are 'undelivered', not 'failed': Sent accepted the message and
   * then withheld it — an opt-out, or an empty balance — which is a different thing to
   * send having gone wrong, and the distinction is what a caller retries on.
   */
  private mapSentDmStatus(sentStatus?: string): MessageStatus['status'] {
    const statusMap: Record<string, MessageStatus['status']> = {
      QUEUED: 'queued',
      SCHEDULED: 'queued',
      ROUTED: 'sending',
      SENT: 'sent',
      DELIVERED: 'delivered',
      READ: 'delivered',
      RECEIVED: 'delivered',
      FAILED: 'failed',
      FILTERED: 'undelivered',
      BLOCKED: 'undelivered',
    };

    return (sentStatus && statusMap[sentStatus]) || 'failed';
  }
}
