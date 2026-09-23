/**
 * Kudosity SMS Provider - Unit Tests
 *
 * Testing WHAT the provider does against the v2 API, not HOW it builds requests:
 * - Sends from the request's sender, or the configured one, without a leading '+'
 * - Carries a message reference and link tracking through metadata
 * - Treats a message refused on the spot as a failed send, though it has an id
 * - Reads both of Kudosity's error shapes
 * - Never replays a send that may already have been accepted
 * - Maps Kudosity's status vocabulary, in either case, onto the connector's
 */

import { KudosityProvider } from '../providers/kudosity-provider';

const API_KEY = 'test-api-key';
const FROM = '+61481074185';

function jsonResponse(status: number, body: any, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `Status ${status}`,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function smsRecord(overrides: Record<string, any> = {}): Response {
  return jsonResponse(200, {
    id: 'sms-1',
    recipient: '61412345678',
    recipient_country: 'AU',
    sender: '61481074185',
    sender_country: 'AU',
    message_ref: '',
    message: 'Your code is 123456',
    status: 'SENT',
    sms_count: '1',
    is_gsm: true,
    routed_via: '',
    track_links: false,
    direction: 'OUT',
    created_at: '2026-09-23T08:30:00.450674000Z',
    updated_at: '2026-09-23T08:30:15.000000000Z',
    ...overrides,
  });
}

function problem(status: number, type: string, detail: string, extra: Record<string, any> = {}) {
  return jsonResponse(status, {
    type: `https://developers.kudosity.com/reference/errors#${type}`,
    title: 'Problem',
    status,
    detail,
    ...extra,
  });
}

const fetchMock = jest.fn();

describe('Kudosity SMS Provider', () => {
  let provider: KudosityProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
    provider = new KudosityProvider({ apiKey: API_KEY, fromNumber: FROM });
  });

  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  describe('sendMessage', () => {
    it('posts to v2 with the api key, sending numbers without a leading +', async () => {
      fetchMock.mockResolvedValue(smsRecord());

      const result = await provider.sendMessage({
        to: '+61412345678',
        message: 'Your code is 123456',
      });

      expect(result).toMatchObject({ success: true, messageId: 'sms-1', provider: 'kudosity' });
      expect(result.cost).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.transmitmessage.com/v2/sms');
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe(API_KEY);
      expect(bodyOf(0)).toEqual({
        message: 'Your code is 123456',
        sender: '61481074185',
        recipient: '61412345678',
      });
    });

    it('sends from request.from over the configured sender, alphanumeric included', async () => {
      fetchMock.mockResolvedValue(smsRecord());

      await provider.sendMessage({ to: '+61412345678', message: 'Hi', from: 'XBG' });

      expect(bodyOf(0).sender).toBe('XBG');
    });

    it('carries a message reference and link tracking from metadata', async () => {
      fetchMock.mockResolvedValue(smsRecord());

      await provider.sendMessage({
        to: '+61412345678',
        message: 'See https://xbg.solutions',
        metadata: { messageRef: 'order-42', trackLinks: true },
      });

      expect(bodyOf(0)).toMatchObject({ message_ref: 'order-42', track_links: true });
    });

    it('tracks links by default when configured, and lets a request turn it off', async () => {
      provider = new KudosityProvider({ apiKey: API_KEY, fromNumber: FROM, trackLinks: true });
      fetchMock.mockResolvedValue(smsRecord());

      await provider.sendMessage({ to: '+61412345678', message: 'A' });
      await provider.sendMessage({
        to: '+61412345678',
        message: 'B',
        metadata: { trackLinks: false },
      });

      expect(bodyOf(0).track_links).toBe(true);
      expect(bodyOf(1).track_links).toBeUndefined();
    });

    it('rejects a request with no sender anywhere, without calling the API', async () => {
      provider = new KudosityProvider({ apiKey: API_KEY, fromNumber: '' });

      const result = await provider.sendMessage({ to: '+61412345678', message: 'Hi' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a body-less request or an overlong reference locally', async () => {
      const empty = await provider.sendMessage({ to: '+61412345678', message: '' });
      const longRef = await provider.sendMessage({
        to: '+61412345678',
        message: 'Hi',
        metadata: { messageRef: 'x'.repeat(501) },
      });

      expect(empty.error?.code).toBe('VALIDATION_ERROR');
      expect(longRef.error?.code).toBe('VALIDATION_ERROR');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails a message Kudosity refused on the spot, keeping its id', async () => {
      fetchMock.mockResolvedValue(smsRecord({ status: 'rejected' }));

      const result = await provider.sendMessage({ to: '+61412345678', message: 'Hi' });

      expect(result.success).toBe(false);
      expect(result.messageId).toBe('sms-1');
      expect(result.error?.code).toBe('REJECTED');
    });

    it('surfaces a validation problem with its issues', async () => {
      fetchMock.mockResolvedValue(
        problem(422, 'input-validation', 'The request contained invalid, or malformed parameters.', {
          issues: [{ code: 2200, field: 'sender', message: 'Sender is not registered.' }],
        })
      );

      const result = await provider.sendMessage({ to: '+61412345678', message: 'Hi' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INPUT_VALIDATION');
      expect(result.error?.message).toContain('sender: Sender is not registered.');
      expect(result.error?.details).toMatchObject({ status: 422, retryable: false });
      expect(result.error?.details?.issues).toHaveLength(1);
    });

    it('reports an authentication failure', async () => {
      fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'Missing or invalid API key'));

      const result = await provider.sendMessage({ to: '+61412345678', message: 'Hi' });

      expect(result.error?.code).toBe('UNAUTHORIZED');
      expect(result.error?.message).toBe('Missing or invalid API key');
    });
  });

  describe('sendBulk', () => {
    it('sends one request per recipient and totals the outcome', async () => {
      fetchMock
        .mockResolvedValueOnce(smsRecord({ id: 'sms-1' }))
        .mockResolvedValueOnce(problem(422, 'input-validation', 'Bad recipient'))
        .mockResolvedValueOnce(smsRecord({ id: 'sms-3' }));

      const result = await provider.sendBulk([
        { to: '+61400000001', message: 'Hi' },
        { to: '+61400000002', message: 'Hi' },
        { to: '+61400000003', message: 'Hi' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({ success: false, successful: 2, failed: 1 });
      expect(result.results.map((r) => r.messageId)).toEqual(['sms-1', undefined, 'sms-3']);
      expect(result.totalCost).toBeUndefined();
    });
  });

  describe('getMessageStatus', () => {
    it('reads the message record and maps its status', async () => {
      fetchMock.mockResolvedValue(smsRecord({ status: 'delivered' }));

      const status = await provider.getMessageStatus('sms-1');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.transmitmessage.com/v2/sms/sms-1');
      expect(status).toMatchObject({
        messageId: 'sms-1',
        status: 'delivered',
        to: '61412345678',
        from: '61481074185',
        body: 'Your code is 123456',
        errorCode: undefined,
      });
      expect(status.timestamp.toISOString()).toBe('2026-09-23T08:30:00.450Z');
    });

    it.each([
      ['ACCEPTED', 'sent'],
      ['SENT', 'sent'],
      ['OTHER', 'sent'],
      ['DELIVERED', 'delivered'],
      ['SOFT_BOUNCE', 'undelivered'],
      ['REJECTED', 'undelivered'],
      ['HARD_BOUNCE', 'failed'],
      ['FAILED', 'failed'],
    ])('maps %s to %s', async (kudosity, expected) => {
      fetchMock.mockResolvedValue(smsRecord({ status: kudosity }));

      const status = await provider.getMessageStatus('sms-1');

      expect(status.status).toBe(expected);
    });

    it('reports a bounce as the error code', async () => {
      fetchMock.mockResolvedValue(smsRecord({ status: 'HARD_BOUNCE' }));

      const status = await provider.getMessageStatus('sms-1');

      expect(status.errorCode).toBe('HARD_BOUNCE');
    });

    it('throws on an unknown message, reading the bare error shape', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { error: 'SMS not found' }));

      await expect(provider.getMessageStatus('missing')).rejects.toThrow('SMS not found');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDeliveryReport', () => {
    it('reports delivery at the time of the last update', async () => {
      fetchMock.mockResolvedValue(smsRecord({ status: 'DELIVERED' }));

      const report = await provider.getDeliveryReport('sms-1');

      expect(report.delivered).toBe(true);
      expect(report.deliveredAt?.toISOString()).toBe('2026-09-23T08:30:15.000Z');
      expect(report.errorCode).toBeUndefined();
    });

    it('reports a failure with its status', async () => {
      fetchMock.mockResolvedValue(smsRecord({ status: 'SOFT_BOUNCE' }));

      const report = await provider.getDeliveryReport('sms-1');

      expect(report.delivered).toBe(false);
      expect(report.deliveredAt).toBeUndefined();
      expect(report.errorCode).toBe('SOFT_BOUNCE');
    });
  });

  describe('retries', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const settle = async <T>(promise: Promise<T>): Promise<T> => {
      // Keep the rejection handled while the timers advance; an unhandled one in that
      // window fails the test before the assertion below ever sees it.
      promise.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(120000);
      return promise;
    };

    it('never replays a send that the server may already have accepted', async () => {
      fetchMock.mockResolvedValue(problem(500, 'server-error', 'Unexpected error'));

      const result = await settle(provider.sendMessage({ to: '+61412345678', message: 'Test' }));

      // One attempt only: a 5xx on POST /v2/sms may have queued the message, and v2
      // documents no idempotency key, so a retry could send it twice.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SERVER_ERROR');
      expect(result.error?.details?.retryable).toBe(true);
    });

    it('never replays a send that timed out', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      const result = await settle(provider.sendMessage({ to: '+61412345678', message: 'Test' }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('retries a send that was rate limited, because nothing was queued', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '1' }))
        .mockResolvedValueOnce(smsRecord());

      const result = await settle(provider.sendMessage({ to: '+61412345678', message: 'Test' }));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('sms-1');
    });

    it('retries a status read on a server error, which carries no such risk', async () => {
      fetchMock
        .mockResolvedValueOnce(problem(500, 'server-error', 'Boom'))
        .mockResolvedValueOnce(smsRecord({ status: 'DELIVERED' }));

      const status = await settle(provider.getMessageStatus('sms-1'));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(status.status).toBe('delivered');
    });

    it('gives up after maxRetries', async () => {
      provider = new KudosityProvider({ apiKey: API_KEY, fromNumber: FROM, maxRetries: 2 });
      fetchMock.mockResolvedValue(problem(500, 'server-error', 'Boom'));

      await expect(settle(provider.getMessageStatus('sms-1'))).rejects.toThrow('Boom');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry at all when retries are disabled', async () => {
      provider = new KudosityProvider({ apiKey: API_KEY, fromNumber: FROM, maxRetries: 0 });
      fetchMock.mockResolvedValue(problem(500, 'server-error', 'Boom'));

      await expect(settle(provider.getMessageStatus('sms-1'))).rejects.toThrow('Boom');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
