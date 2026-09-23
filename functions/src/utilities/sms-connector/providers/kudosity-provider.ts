/**
 * Kudosity SMS Provider
 * Implementation using the Kudosity v2 (TransmitMessage) REST API
 * https://developers.kudosity.com/reference/post_v2-sms
 *
 * Kudosity runs two APIs on two hosts. This provider uses v2 (api.transmitmessage.com,
 * `x-api-key` auth), which Kudosity recommends for new builds, rather than the classic
 * v1 (api.transmitsms.com, Basic auth). Both share an account's senders and reporting.
 *
 * v2 IS SINGLE-RECIPIENT. Multi-recipient sends exist only on v1, so `sendBulk` loops, as
 * the Twilio and MessageBird providers do. Moving bulk to v1 would mean a second
 * credential pair and a second error vocabulary for one method; that was not worth it.
 *
 * A SENDER IS REQUIRED on every send, and must be a number (or an alphanumeric id of up
 * to 11 characters) registered to the account for the destination country. It comes from
 * `request.from`, falling back to the configured `fromNumber`.
 *
 * Numbers are sent without a leading '+'. Kudosity's own examples of E.164 omit it
 * (61438333061), and `SMSRequest.to` conventionally carries it.
 *
 * `metadata.messageRef` becomes v2's `message_ref` (up to 500 characters), which Kudosity
 * echoes on every webhook — the reconciliation handle for status callbacks.
 * `metadata.trackLinks` overrides the configured `trackLinks` for one send. Both use the
 * escape hatch the Twilio provider already uses for `metadata.statusCallback`.
 *
 * Fields of `SMSRequest` with no v2 SMS equivalent are ignored, as the MessageBird
 * provider already ignores `mediaUrls` and `tags`:
 *   - `mediaUrls`      MMS is a separate v2 endpoint, with no expression in SMSProvider
 *   - `validityPeriod` no request-level equivalent
 *   - `tags`           no request-level equivalent
 *
 * Neither the send response nor the message record carries a price (`sms_count` is a part
 * count, not a cost), so `cost` and `totalCost` are left undefined rather than reported as
 * a misleading 0.
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

export interface KudosityConfig {
  apiKey: string;
  /** Default sender: a number or alphanumeric id registered to the account. */
  fromNumber: string;
  /** Override the API origin. Defaults to https://api.transmitmessage.com */
  baseURL?: string;
  /** Replace links with tracked short links. Per-request `metadata.trackLinks` wins. */
  trackLinks?: boolean;
  /** Per-attempt timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Retry attempts after the first. Defaults to 3; set 0 to disable. */
  maxRetries?: number;
}

const PROVIDER = 'kudosity';
const DEFAULT_BASE_URL = 'https://api.transmitmessage.com';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30000;
const MAX_MESSAGE_REF_LENGTH = 500;

/** Statuses that mean the message stopped short of the handset. */
const FAILURE_STATUSES = new Set(['FAILED', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'REJECTED']);

/** Of those, the ones that mean the send itself did not go out. */
const SEND_REJECTED_STATUSES = new Set(['FAILED', 'HARD_BOUNCE', 'REJECTED']);

/** The v2 message record, returned by both the send and the read. */
interface KudositySMS {
  id: string;
  recipient?: string;
  recipient_country?: string;
  sender?: string;
  sender_country?: string;
  message_ref?: string;
  message?: string;
  status?: string;
  sms_count?: string;
  is_gsm?: boolean;
  routed_via?: string;
  track_links?: boolean;
  direction?: string;
  created_at?: string;
  updated_at?: string;
}

interface KudosityRequestError extends Error {
  code: string;
  status?: number;
  issues?: Array<{ code?: number; field?: string; message?: string }>;
  retryable: boolean;
  retryAfterMs?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withoutPlus = (number: string): string => number.trim().replace(/^\+/, '');

export class KudosityProvider implements SMSProvider {
  private baseURL: string;
  private headers: Record<string, string>;
  private fromNumber: string;
  private trackLinks: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: KudosityConfig) {
    this.baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fromNumber = config.fromNumber;
    this.trackLinks = config.trackLinks === true;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.headers = {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

    let sms: KudositySMS;
    try {
      sms = await this.request<KudositySMS>('/v2/sms', {
        method: 'POST',
        body: this.buildPayload(request),
      });
    } catch (error: any) {
      return {
        success: false,
        error: this.toSMSError(error),
        provider: PROVIDER,
        timestamp: new Date(),
      };
    }

    // A 200 can carry a message Kudosity refused on the spot (compliance, a dead number).
    // It has an id, and is still not a send.
    const status = sms.status?.toUpperCase();
    if (status && SEND_REJECTED_STATUSES.has(status)) {
      return {
        success: false,
        messageId: sms.id,
        error: {
          code: status,
          message: `Kudosity reported the message as ${status}`,
          details: { status: sms.status },
        },
        provider: PROVIDER,
        timestamp: new Date(),
      };
    }

    return {
      success: true,
      messageId: sms.id,
      provider: PROVIDER,
      timestamp: new Date(),
    };
  }

  /**
   * Send many SMS, one request each — v2 has no multi-recipient send.
   *
   * No fixed delay between sends: Kudosity documents no rate limit, and a 429 is retried
   * with backoff by `request`, which paces the loop to whatever the limit turns out to be.
   */
  async sendBulk(requests: SMSRequest[]): Promise<BulkSMSResult> {
    const results: SMSResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const request of requests) {
      const result = await this.sendMessage(request);
      results.push(result);

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
    const sms = await this.fetchMessage(messageId);
    const status = sms.status?.toUpperCase();
    const failed = status !== undefined && FAILURE_STATUSES.has(status);

    return {
      messageId: sms.id,
      status: this.mapKudosityStatus(status),
      to: sms.recipient || '',
      from: sms.sender || '',
      body: sms.message || '',
      // v2 carries no error detail on the record; the status is the most it says.
      errorCode: failed ? status : undefined,
      timestamp: sms.created_at ? new Date(sms.created_at) : new Date(),
    };
  }

  /**
   * Get delivery report
   */
  async getDeliveryReport(messageId: string): Promise<DeliveryReport> {
    const sms = await this.fetchMessage(messageId);
    const status = sms.status?.toUpperCase();
    const delivered = status === 'DELIVERED';

    return {
      messageId: sms.id,
      delivered,
      // The record has no delivery timestamp. DELIVERED is terminal, so the last update
      // is the moment it became delivered.
      deliveredAt: delivered && sms.updated_at ? new Date(sms.updated_at) : undefined,
      errorCode: status && FAILURE_STATUSES.has(status) ? status : undefined,
    };
  }

  private fetchMessage(messageId: string): Promise<KudositySMS> {
    return this.request<KudositySMS>(`/v2/sms/${encodeURIComponent(messageId)}`);
  }

  /**
   * Build the v2 request body.
   */
  private buildPayload(request: SMSRequest): Record<string, any> {
    const sender = request.from || this.fromNumber;
    const payload: Record<string, any> = {
      message: request.message,
      // An alphanumeric sender has no '+' to strip; a number may.
      sender: withoutPlus(sender),
      recipient: withoutPlus(request.to),
    };

    const messageRef = request.metadata?.messageRef;
    if (messageRef !== undefined && messageRef !== null && messageRef !== '') {
      payload.message_ref = String(messageRef);
    }

    if (request.metadata?.trackLinks ?? this.trackLinks) {
      payload.track_links = true;
    }

    return payload;
  }

  /**
   * Reject locally what v2 would reject anyway, to save a round trip.
   */
  private validate(request: SMSRequest): SMSError | null {
    if (!request.message) {
      return { code: 'VALIDATION_ERROR', message: 'A message body is required' };
    }

    if (!request.to) {
      return { code: 'VALIDATION_ERROR', message: 'A recipient is required' };
    }

    if (!(request.from || this.fromNumber)) {
      return {
        code: 'VALIDATION_ERROR',
        message:
          'A sender is required. Set fromNumber in config or pass request.from — it must be ' +
          'registered to the Kudosity account for the destination country.',
      };
    }

    const messageRef = request.metadata?.messageRef;
    if (messageRef !== undefined && String(messageRef).length > MAX_MESSAGE_REF_LENGTH) {
      return {
        code: 'VALIDATION_ERROR',
        message: `metadata.messageRef is limited to ${MAX_MESSAGE_REF_LENGTH} characters`,
      };
    }

    return null;
  }

  /**
   * Issue a request, retrying where a retry is SAFE.
   *
   * v2 documents no idempotency key, so replaying a POST that the server had in fact
   * accepted would send the message twice. Only 429 is retried on a send — it is a
   * rejection, so nothing was queued. A 5xx or a timeout on a send is reported, never
   * replayed; on a GET, which carries no such risk, both are retried.
   */
  private async request<T = any>(
    path: string,
    options: { method?: string; body?: any } = {}
  ): Promise<T> {
    const { method = 'GET', body } = options;
    const idempotent = method === 'GET';
    const url = `${this.baseURL}${path}`;
    let lastError: KudosityRequestError | undefined;

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
        if (!payload || typeof payload.id !== 'string') {
          throw this.malformedResponse(res);
        }
        return payload as T;
      }

      lastError = this.apiError(res, payload);

      const retryable = lastError.status === 429 || (idempotent && lastError.retryable);
      if (retryable && attempt < this.maxRetries) continue;
      throw lastError;
    }

    throw lastError;
  }

  /**
   * Kudosity answers errors in two shapes: RFC 7807 problem details
   * (`{ type, title, status, detail, issues? }`) and, on some endpoints, a bare
   * `{ error: "SMS not found" }`. Both are read.
   */
  private apiError(res: Response, payload: any): KudosityRequestError {
    const issues: KudosityRequestError['issues'] = Array.isArray(payload?.issues)
      ? payload.issues
      : undefined;
    const issueText = issues
      ?.map((issue) => (issue.field ? `${issue.field}: ${issue.message}` : issue.message))
      .filter(Boolean)
      .join('; ');

    const headline =
      payload?.detail ||
      payload?.title ||
      (typeof payload?.error === 'string' ? payload.error : undefined) ||
      `HTTP ${res.status}: ${res.statusText}`;

    const error = new Error(issueText ? `${headline} (${issueText})` : headline) as KudosityRequestError;

    // The problem type's anchor names the error: …/errors#input-validation → INPUT_VALIDATION
    const anchor = typeof payload?.type === 'string' ? payload.type.split('#')[1] : undefined;
    error.code = anchor ? anchor.toUpperCase().replace(/-/g, '_') : `HTTP_${res.status}`;
    error.status = res.status;
    error.issues = issues;
    error.retryable = res.status === 429 || res.status >= 500;

    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      error.retryAfterMs = retryAfter * 1000;
    }

    return error;
  }

  private malformedResponse(res: Response): KudosityRequestError {
    const error = new Error(
      `Kudosity returned HTTP ${res.status} without a message record`
    ) as KudosityRequestError;

    error.code = 'MALFORMED_RESPONSE';
    error.status = res.status;
    // A send that got this far was accepted; retrying it could send twice.
    error.retryable = false;

    return error;
  }

  private transportError(cause: any): KudosityRequestError {
    const aborted = cause?.name === 'AbortError';
    const error = new Error(
      aborted ? `Request timed out after ${this.timeoutMs}ms` : cause?.message || 'Network error'
    ) as KudosityRequestError;

    error.code = aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
    error.retryable = true;

    return error;
  }

  /** Exponential backoff — 1s, 2s, 4s — capped, jittered, and yielding to Retry-After. */
  private backoffMs(attempt: number, previous?: KudosityRequestError): number {
    if (previous?.retryAfterMs !== undefined) {
      return Math.min(previous.retryAfterMs, MAX_RETRY_DELAY_MS);
    }

    const base = Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    return base + Math.floor(Math.random() * 1000);
  }

  private toSMSError(error: any): SMSError {
    const typed = error as KudosityRequestError;

    return {
      code: typed?.code || 'KUDOSITY_ERROR',
      message: typed?.message || 'Unknown Kudosity error',
      details: {
        status: typed?.status,
        issues: typed?.issues,
        retryable: typed?.retryable === true,
      },
    };
  }

  /**
   * Map a Kudosity status to the connector's own vocabulary. The API is not consistent
   * about case — webhooks say DELIVERED, the record's own example says delivered — so the
   * caller upper-cases first.
   *
   * SOFT_BOUNCE and REJECTED are 'undelivered', not 'failed': a soft bounce is temporary
   * (handset off, out of range) and a rejection is Kudosity withholding the message on
   * compliance grounds — neither is the send having gone wrong, and the distinction is
   * what a caller retries on. HARD_BOUNCE is permanent, so 'failed'.
   *
   * OTHER is the carrier's own status passed through unmapped. It says nothing either
   * way, so it stays 'sent' rather than being reported as a failure it may not be.
   */
  private mapKudosityStatus(status?: string): MessageStatus['status'] {
    const statusMap: Record<string, MessageStatus['status']> = {
      ACCEPTED: 'sent',
      SENT: 'sent',
      OTHER: 'sent',
      DELIVERED: 'delivered',
      SOFT_BOUNCE: 'undelivered',
      REJECTED: 'undelivered',
      HARD_BOUNCE: 'failed',
      FAILED: 'failed',
    };

    return (status && statusMap[status]) || 'failed';
  }
}
