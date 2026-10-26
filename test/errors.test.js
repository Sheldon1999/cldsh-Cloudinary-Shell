import test from 'node:test';
import assert from 'node:assert/strict';
import { toCldError, CODES, EXIT, formatError } from '../lib/errors.js';

// The SDK rejects with plain objects of this shape (verified against the live API).
const sdkError = (http_code, message) => ({ error: { message, http_code }, request_options: {}, query_params: {} });

test('toCldError: SDK error objects keep their message and map the HTTP status', () => {
  const cases = [
    [401, CODES.AUTH],
    [403, CODES.FORBIDDEN],
    [404, CODES.NOT_FOUND],
    [409, CODES.CONFLICT],
    [420, CODES.RATE_LIMITED],
    [400, CODES.API],
  ];
  for (const [status, code] of cases) {
    const e = toCldError(sdkError(status, `boom ${status}`));
    assert.equal(e.code, code);
    assert.equal(e.message, `boom ${status}`);
    assert.equal(e.httpCode, status);
    assert.notEqual(String(e.message), '[object Object]');
  }
});

test('toCldError: auth and rate-limit errors carry a hint', () => {
  assert.match(formatError(sdkError(401, 'api_secret mismatch')), /hint: .*API key/);
  assert.match(formatError({ ...sdkError(420, 'Rate Limit Exceeded'), rate_limit_reset_at: '2026-10-26T19:00:00Z' }), /resets at 2026-10-26T19:00:00/);
});

test('toCldError: network failures are NETWORK errors', () => {
  const e = toCldError(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }));
  assert.equal(e.code, CODES.NETWORK);
});

test('exit codes follow the error code', () => {
  assert.equal(toCldError(sdkError(404, 'x')).exitCode, EXIT.ERROR);
  assert.equal(toCldError({ error: { message: 'x' } }).exitCode, EXIT.ERROR);
});

test('toCldError: uploader errors ({ message, http_code }) keep their message', () => {
  const e = toCldError({ message: 'to_public_id(a) already exists', http_code: 400, name: 'Error' });
  assert.equal(e.message, 'to_public_id(a) already exists');
  assert.equal(e.httpCode, 400);
});

test('toCldError: serialized errors never contain request credentials', () => {
  const raw = { error: { message: 'Bad request', http_code: 400 }, request_options: { auth: 'key:supersecret' } };
  const odd = { request_options: { auth: 'key:supersecret' } };
  for (const e of [raw, odd]) {
    const json = JSON.stringify(toCldError(e).toJSON());
    assert.ok(!json.includes('supersecret'), json);
  }
});

test('toCldError: socket errors wrapped by the SDK ({ error: Error }) are NETWORK errors', () => {
  const e = toCldError({ error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  assert.equal(e.code, CODES.NETWORK);
});
