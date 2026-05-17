import {
  FinBridgeError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  ServerError,
  NetworkError,
  fromAxiosError,
} from '../index';
import { AxiosError, AxiosHeaders } from 'axios';

function makeAxiosError(
  status: number,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): AxiosError {
  const response = {
    status,
    data: body,
    headers: { ...headers },
    config: { headers: new AxiosHeaders() },
    statusText: 'Error',
  } as AxiosError['response'];

  const err = new AxiosError('Request failed', undefined, undefined, undefined, response);
  return err;
}

describe('Error classes', () => {
  it('FinBridgeError serialises to JSON correctly', () => {
    const err = new FinBridgeError('Test error', 'TEST_CODE', 400);
    const json = err.toJSON();
    expect(json.code).toBe('TEST_CODE');
    expect(json.statusCode).toBe(400);
    expect(json.name).toBe('FinBridgeError');
  });

  it('RateLimitError includes retryAfter', () => {
    const err = new RateLimitError('Rate limited', 30);
    expect(err.retryAfter).toBe(30);
    expect(err.statusCode).toBe(429);
  });

  it('ValidationError includes field details', () => {
    const err = new ValidationError('Invalid', { email: 'Required' });
    expect(err.fields?.['email']).toBe('Required');
  });

  it('prototype chain is intact for instanceof checks', () => {
    const err = new AuthenticationError();
    expect(err instanceof AuthenticationError).toBe(true);
    expect(err instanceof FinBridgeError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('fromAxiosError', () => {
  it('maps 401 to AuthenticationError', () => {
    const err = fromAxiosError(makeAxiosError(401, { message: 'Unauthorized' }));
    expect(err instanceof AuthenticationError).toBe(true);
  });

  it('maps 404 to NotFoundError', () => {
    const err = fromAxiosError(makeAxiosError(404, { message: 'Not found', resource: 'Payout' }));
    expect(err instanceof NotFoundError).toBe(true);
    expect(err.message).toContain('Payout');
  });

  it('maps 429 to RateLimitError with retryAfter', () => {
    const err = fromAxiosError(makeAxiosError(429, {}, { 'retry-after': '60' }));
    expect(err instanceof RateLimitError).toBe(true);
    expect((err as RateLimitError).retryAfter).toBe(60);
  });

  it('maps 500 to ServerError', () => {
    const err = fromAxiosError(makeAxiosError(500, { message: 'Internal error' }));
    expect(err instanceof ServerError).toBe(true);
  });

  it('maps network error (no response) to NetworkError', () => {
    const axErr = new AxiosError('Network error');
    const err = fromAxiosError(axErr);
    expect(err instanceof NetworkError).toBe(true);
  });
});
