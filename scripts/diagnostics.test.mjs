import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesApiClient } from '../src/api_client.js';
import { formatApiError, transportFailure } from '../src/diagnostics.js';
import { validateBuildInfo } from './check-build-info.mjs';

for (const [reason, code] of [
  ['url not allowed on the configured scope: http://192.168.1.4:3450/api/v1/auth/pair', 'NATIVE_SCOPE_DENIED'],
  ['http.fetch not allowed. Permissions associated with this command: http:allow-fetch', 'NATIVE_PERMISSION_DENIED'],
  ['Connection refused (os error 111)', 'CONNECTION_REFUSED'],
  ['request timed out', 'TIMEOUT']
]) {
  test(`pairing reports ${code} with endpoint context instead of an undifferentiated network error`, async () => {
    const api = new HermesApiClient({ storage: null, fetcher: async () => { throw reason; } });
    await assert.rejects(api.pair('A'.repeat(26), 'Diagnostic fixture'), error => {
      assert.equal(error.code, code);
      assert.equal(error.method, 'POST');
      assert.equal(error.endpoint, '/api/v1/auth/pair');
      assert.ok(formatApiError(error).includes(code));
      return true;
    });
  });
}
test('browser fetch failures name possible browser restrictions without claiming CORS is the proven cause', () => {
  const failure = transportFailure(new TypeError('Failed to fetch'));
  assert.equal(failure.code, 'BROWSER_FETCH_FAILED');
  assert.match(failure.message, /CORS, CSP/);
});
test('native diagnostic output never echoes raw request URLs/tickets/token text', () => {
  const failure = transportFailure(new Error('error fetching ?ticket=secret-ticket Authorization: Bearer secret-access'), { native: true, mutation: true });
  assert.equal(failure.code, 'NETWORK_ERROR');
  assert.ok(!failure.message.includes('secret'));
  assert.match(failure.message, /belum diketahui/);
  assert.equal(failure.retryable, false);
});
test('HTTP pairing errors expose status and code but redact the one-time pairing value', async () => {
  const code = 'A'.repeat(26);
  const api = new HermesApiClient({ storage: null, fetcher: async () => new Response(JSON.stringify({ error: { code: 'INVALID_PAIRING_CODE', message: `Code ${code} expired`, retryable: false } }), { status: 400 }) });
  await assert.rejects(api.pair(code, 'Fixture'), error => {
    const text = formatApiError(error);
    assert.match(text, /HTTP 400/);
    assert.match(text, /INVALID_PAIRING_CODE/);
    assert.match(text, /POST \/api\/v1\/auth\/pair/);
    assert.ok(!text.includes(code));
    assert.match(text, /\[redacted\]/);
    return true;
  });
});
test('health diagnostic sends no bearer token or pairing mutation even when a session is stored', async () => {
  let calls = 0;
  const api = new HermesApiClient({ storage: null, fetcher: async (url, options) => {
    calls++;
    assert.ok(url.endsWith('/health/ready'));
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify({ status: 'ok', service: 'api', version: '1.0.0' }));
  } });
  api.setTokens({ access_token: 'secret-access', refresh_token: 'secret-refresh', workspace_id: 'workspace', device_id: 'device' });
  assert.equal((await api.getHealth()).status, 'ok');
  assert.equal(calls, 1);
});
test('frontend manifest must match the CI source and application version', () => {
  const info = { version: '0.1.2', commit: 'a'.repeat(40), run: '14', attempt: '1' };
  const env = { GITHUB_SHA: info.commit, GITHUB_RUN_NUMBER: info.run, GITHUB_RUN_ATTEMPT: info.attempt };
  assert.doesNotThrow(() => validateBuildInfo(info, '0.1.2', env));
  assert.throws(() => validateBuildInfo({ ...info, version: '0.1.1' }, '0.1.2', env), /version/);
  assert.throws(() => validateBuildInfo({ ...info, commit: 'b'.repeat(40) }, '0.1.2', env), /commit/);
  assert.throws(() => validateBuildInfo({ ...info, run: '12' }, '0.1.2', env), /run/);
});
