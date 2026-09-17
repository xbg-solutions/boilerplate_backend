/**
 * Sent SMS Provider - Unit Tests
 *
 * Testing WHAT the provider does against the v3 API, not HOW it builds requests:
 * - Pins every send to the SMS channel
 * - Sends free-form text, or a template passed through metadata
 * - Batches a bulk send into one call per shared body, chunked at the 1,000 ceiling
 * - Attributes returned message ids to the right recipient
 * - Never replays a send that may already have been accepted
 * - Maps Sent's status vocabulary onto the connector's
 */

import { SentDmProvider } from '../providers/sentdm-provider';
import { SMSRequest } from '../types';

const API_KEY = 'test-api-key';

function jsonResponse(status: number, body: any, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `Status ${status}`,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function sendAccepted(recipients: Array<{ message_id: string; to: string }>): Response {
  return jsonResponse(202, {
    success: true,
    data: {
      status: 'QUEUED',
      recipients: recipients.map((r) => ({ ...r, channel: 'sms' })),
    },
    meta: { request_id: 'req_test' },
  });
}

function messageRecord(overrides: Record<string, any> = {}): Response {
  return jsonResponse(200, {
    success: true,
    data: {
      id: 'msg-1',
      phone: '+61412345678',
      outbound_number: '+61498765432',
      template_name: 'order_confirmation',
      channel: 'sms',
      status: 'DELIVERED',
      direction: 'OUTBOUND',
      created_at: '2026-09-17T08:30:00Z',
      events: [
        { status: 'QUEUED', timestamp: '2026-09-17T08:30:00Z', description: 'Message queued' },
        { status: 'DELIVERED', timestamp: '2026-09-17T08:30:15Z', description: 'Delivered' },
      ],
      ...overrides,
    },
    error: null,
    meta: { request_id: 'req_test' },
  });
}

const fetchMock = jest.fn();

describe('Sent SMS Provider', () => {
  let provider: SentDmProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
    provider = new SentDmProvider({ apiKey: API_KEY });
  });

  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  describe('sendMessage', () => {
    it('posts free-form text pinned to the SMS channel', async () => {
      fetchMock.mockResolvedValue(sendAccepted([{ message_id: 'msg-1', to: '+61412345678' }]));

      const result = await provider.sendMessage({
        to: '+61412345678',
        message: 'Your code is 123456',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.sent.dm/v3/messages');
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe(API_KEY);
      expect(bodyOf(0)).toEqual({
        to: ['+61412345678'],
        channel: ['sms'],
        text: 'Your code is 123456',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-1');
      expect(result.provider).toBe('sentdm');
    });

    it('sends a template from metadata instead of text', async () => {
      fetchMock.mockResolvedValue(sendAccepted([{ message_id: 'msg-2', to: '+61412345678' }]));

      await provider.sendMessage({
        to: '+61412345678',
        message: 'ignored when a template is given',
        metadata: {
          template: { id: 'tmpl-1', parameters: { customerName: 'Jo' } },
        },
      });

      expect(bodyOf(0)).toEqual({
        to: ['+61412345678'],
        channel: ['sms'],
        template: { id: 'tmpl-1', parameters: { customerName: 'Jo' } },
      });
      expect(bodyOf(0).text).toBeUndefined();
    });

    it('marks the request as sandbox when configured', async () => {
      fetchMock.mockResolvedValue(sendAccepted([{ message_id: 'msg-3', to: '+61412345678' }]));
      provider = new SentDmProvider({ apiKey: API_KEY, sandbox: true });

      await provider.sendMessage({ to: '+61412345678', message: 'Test' });

      expect(bodyOf(0).sandbox).toBe(true);
    });

    it('rejects a body-less request without calling the API', async () => {
      const result = await provider.sendMessage({ to: '+61412345678', message: '' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('surfaces the API error code and status', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(402, {
          success: false,
          status: 402,
          error: { code: 'BUSINESS_003', message: 'Account balance is insufficient' },
          meta: { request_id: 'req_402' },
        })
      );

      const result = await provider.sendMessage({ to: '+61412345678', message: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BUSINESS_003');
      expect(result.error?.message).toBe('Account balance is insufficient');
      expect(result.error?.details).toMatchObject({ status: 402, retryable: false });
    });
  });

  describe('sendBulk', () => {
    it('sends one request for many recipients sharing a body', async () => {
      fetchMock.mockResolvedValue(
        sendAccepted([
          { message_id: 'msg-a', to: '+61400000001' },
          { message_id: 'msg-b', to: '+61400000002' },
          { message_id: 'msg-c', to: '+61400000003' },
        ])
      );

      const requests: SMSRequest[] = ['+61400000001', '+61400000002', '+61400000003'].map(
        (to) => ({ to, message: 'Same body' })
      );

      const result = await provider.sendBulk(requests);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyOf(0).to).toEqual(['+61400000001', '+61400000002', '+61400000003']);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results.map((r) => r.messageId)).toEqual(['msg-a', 'msg-b', 'msg-c']);
    });

    it('splits requests with different bodies into separate calls', async () => {
      fetchMock
        .mockResolvedValueOnce(sendAccepted([{ message_id: 'msg-a', to: '+61400000001' }]))
        .mockResolvedValueOnce(sendAccepted([{ message_id: 'msg-b', to: '+61400000002' }]));

      await provider.sendBulk([
        { to: '+61400000001', message: 'First' },
        { to: '+61400000002', message: 'Second' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodyOf(0).text).toBe('First');
      expect(bodyOf(1).text).toBe('Second');
    });

    it('chunks a group at the 1,000 recipient ceiling', async () => {
      fetchMock.mockImplementation(async (_url: string, init: any) =>
        sendAccepted(
          JSON.parse(init.body).to.map((to: string) => ({ message_id: `msg-${to}`, to }))
        )
      );

      const requests: SMSRequest[] = Array.from({ length: 1001 }, (_, i) => ({
        to: `+6140000${String(i).padStart(4, '0')}`,
        message: 'Broadcast',
      }));

      const result = await provider.sendBulk(requests);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodyOf(0).to).toHaveLength(1000);
      expect(bodyOf(1).to).toHaveLength(1);
      expect(result.successful).toBe(1001);
    });

    it('attributes message ids by number even when the response is reordered', async () => {
      fetchMock.mockResolvedValue(
        sendAccepted([
          { message_id: 'msg-c', to: '+61400000003' },
          { message_id: 'msg-a', to: '+61400000001' },
          { message_id: 'msg-b', to: '+61400000002' },
        ])
      );

      const result = await provider.sendBulk(
        ['+61400000001', '+61400000002', '+61400000003'].map((to) => ({ to, message: 'Same' }))
      );

      expect(result.results.map((r) => r.messageId)).toEqual(['msg-a', 'msg-b', 'msg-c']);
    });

    it('fails every request in a chunk the API rejected', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          success: false,
          error: { code: 'VALIDATION_002', message: 'Invalid phone format' },
        })
      );

      const result = await provider.sendBulk([
        { to: '+61400000001', message: 'Same' },
        { to: 'not-a-number', message: 'Same' },
      ]);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(2);
      expect(result.results.every((r) => r.error?.code === 'VALIDATION_002')).toBe(true);
    });

    it('fails an invalid request locally without dropping the rest of the batch', async () => {
      fetchMock.mockResolvedValue(sendAccepted([{ message_id: 'msg-a', to: '+61400000001' }]));

      const result = await provider.sendBulk([
        { to: '+61400000001', message: 'Valid' },
        { to: '+61400000002', message: '' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[1].error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('getMessageStatus', () => {
    it('reads a message record and maps its status', async () => {
      fetchMock.mockResolvedValue(messageRecord());

      const status = await provider.getMessageStatus('msg-1');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.sent.dm/v3/messages/msg-1');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
      expect(status).toMatchObject({
        messageId: 'msg-1',
        status: 'delivered',
        to: '+61412345678',
        from: '+61498765432',
      });
    });

    it('treats a withheld message as undelivered, not failed', async () => {
      fetchMock.mockResolvedValue(
        messageRecord({
          status: 'FILTERED',
          events: [
            { status: 'QUEUED', timestamp: '2026-09-17T08:30:00Z', description: 'Queued' },
            {
              status: 'FILTERED',
              timestamp: '2026-09-17T08:30:05Z',
              description: 'Recipient has opted out',
            },
          ],
        })
      );

      const status = await provider.getMessageStatus('msg-1');

      expect(status.status).toBe('undelivered');
      expect(status.errorCode).toBe('FILTERED');
      expect(status.errorMessage).toBe('Recipient has opted out');
    });

    it('maps READ as delivered and ROUTED as sending', async () => {
      fetchMock.mockResolvedValue(messageRecord({ status: 'READ' }));
      expect((await provider.getMessageStatus('msg-1')).status).toBe('delivered');

      fetchMock.mockResolvedValue(messageRecord({ status: 'ROUTED' }));
      expect((await provider.getMessageStatus('msg-1')).status).toBe('sending');
    });
  });

  describe('getDeliveryReport', () => {
    it('reports delivery with the timestamp of the delivered event', async () => {
      fetchMock.mockResolvedValue(messageRecord());

      const report = await provider.getDeliveryReport('msg-1');

      expect(report.delivered).toBe(true);
      expect(report.deliveredAt).toEqual(new Date('2026-09-17T08:30:15Z'));
    });

    it('reports a failure with its reason', async () => {
      fetchMock.mockResolvedValue(
        messageRecord({
          status: 'FAILED',
          events: [
            {
              status: 'FAILED',
              timestamp: '2026-09-17T08:30:05Z',
              description: 'Carrier rejected the message',
            },
          ],
        })
      );

      const report = await provider.getDeliveryReport('msg-1');

      expect(report.delivered).toBe(false);
      expect(report.deliveredAt).toBeUndefined();
      expect(report.errorCode).toBe('FAILED');
      expect(report.errorMessage).toBe('Carrier rejected the message');
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
      fetchMock.mockResolvedValue(
        jsonResponse(503, { success: false, error: { code: 'HTTP_503', message: 'Unavailable' } })
      );

      const result = await settle(provider.sendMessage({ to: '+61412345678', message: 'Test' }));

      // One attempt only: a 5xx on POST /v3/messages may have queued the message, and v3
      // has no idempotency key, so a retry would send it twice.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.error?.details?.retryable).toBe(true);
    });

    it('retries a send that was rate limited, because nothing was queued', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            429,
            { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
            { 'retry-after': '1' }
          )
        )
        .mockResolvedValueOnce(sendAccepted([{ message_id: 'msg-1', to: '+61412345678' }]));

      const result = await settle(provider.sendMessage({ to: '+61412345678', message: 'Test' }));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-1');
    });

    it('retries a status read on a server error, which carries no such risk', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(500, { success: false, error: { code: 'HTTP_500', message: 'Boom' } })
        )
        .mockResolvedValueOnce(messageRecord());

      const status = await settle(provider.getMessageStatus('msg-1'));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(status.status).toBe('delivered');
    });

    it('gives up after maxRetries', async () => {
      provider = new SentDmProvider({ apiKey: API_KEY, maxRetries: 2 });
      fetchMock.mockResolvedValue(
        jsonResponse(500, { success: false, error: { code: 'HTTP_500', message: 'Boom' } })
      );

      await expect(settle(provider.getMessageStatus('msg-1'))).rejects.toThrow('Boom');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry at all when retries are disabled', async () => {
      provider = new SentDmProvider({ apiKey: API_KEY, maxRetries: 0 });
      fetchMock.mockResolvedValue(
        jsonResponse(500, { success: false, error: { code: 'HTTP_500', message: 'Boom' } })
      );

      await expect(settle(provider.getMessageStatus('msg-1'))).rejects.toThrow('Boom');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
