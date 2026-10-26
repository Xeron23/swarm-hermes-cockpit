import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesApiClient, AUTH_KEY } from '../src/api_client.js';
import { Workspace } from '../src/workspace.js';
import { bindConnectionLifecycle } from '../src/connection_lifecycle.js';
import { clearedConnectionError, reconnectDelay } from '../src/connection_policy.js';
import { render } from '../src/views.js';

const tokens = { access_token: 'access', refresh_token: 'refresh', workspace_id: 'w', device_id: 'd' };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const expired = () => response({ error: { code: 'TOKEN_EXPIRED', message: 'Expired' } }, 401);
const snapshot = () => ({ workspace_id: 'w', device_id: 'd', nodes: [], agents: [], active_missions: [], last_event_seq: '0', features: { real_mode: true, runtime_ready: true } });
function memory() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function fixture(fetcher, uncertain = false) {
  const storage = memory();
  const api = new HermesApiClient({ storage, fetcher, retryDelay: 1, readRetryDelay: 0, random: () => 1 });
  api.setTokens(tokens);
  if (uncertain) { api.auth.refresh_uncertain = true; storage.setItem(AUTH_KEY, JSON.stringify(api.auth)); }
  return api;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await pause(); } assert.fail('Condition did not recover'); }
const proof = options => { const body = JSON.parse(options.body); return { request_id: body.request_id, workspace_id: 'w', device_id: 'd', refresh_token_state: 'current', rotation_performed: false }; };
const capability = { status: 'ok', capabilities: { refresh_token_status_v1: true } };

test('health transport retry is bounded and cannot alter session/uncertainty', async () => {
  let calls = 0;
  const api = fixture(async (_url, options) => {
    calls++; assert.equal(options.headers.Authorization, undefined);
    if (calls === 1) throw new Error('Network failed');
    return response({ status: 'ok' });
  });
  const before = api.storage.getItem(AUTH_KEY);
  assert.equal((await api.getHealth()).status, 'ok');
  assert.equal(calls, 2); assert.equal(api.storage.getItem(AUTH_KEY), before);
});
test('a timed out safe health read retries, while native-compatible timeout remains bounded', async () => {
  let calls = 0;
  const api = new HermesApiClient({ storage: memory(), timeout: 15, readRetryDelay: 0, fetcher: async (_url, options) => {
    if (++calls === 1) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    return response({ status: 'ok' });
  } });
  assert.equal((await api.getHealth()).status, 'ok'); assert.equal(calls, 2);
});
test('GET 503 retries but a mutation transport failure is sent once', async () => {
  let reads = 0, writes = 0;
  const api = fixture(async (_url, options) => {
    if (options.method === 'POST') { writes++; throw new Error('Lost response'); }
    return ++reads === 1 ? response({ error: { code: 'STARTING' } }, 503) : response({ items: [] });
  });
  await api.getNodes();
  await assert.rejects(api.createMission('x', 'x', 'auto'));
  assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(api.auth.refresh_uncertain, undefined);
});
test('refresh intent is persisted before POST and a successful rotation removes it', async () => {
  let api;
  api = fixture(async () => {
    const stored = JSON.parse(api.storage.getItem(AUTH_KEY));
    assert.equal(stored.refresh_uncertain, true); assert.match(stored.refresh_attempt_id, /^[a-f0-9]{32}$/);
    return response({ ...tokens, access_token: 'next-access', refresh_token: 'next-refresh' });
  });
  await api.refreshToken();
  assert.equal(api.auth.refresh_token, 'next-refresh');
  assert.equal(JSON.parse(api.storage.getItem(AUTH_KEY)).refresh_uncertain, undefined);
});
test('restart during a pending rotation never replays the old refresh token', async () => {
  let finish, rotations = 0;
  const api = fixture(async () => { rotations++; return new Promise(resolve => { finish = resolve; }); });
  const pending = api.refreshToken();
  const restored = new HermesApiClient({ storage: api.storage, fetcher: async () => assert.fail('No replay after restart') });
  await assert.rejects(restored.refreshToken(), { code: 'REFRESH_UNCERTAIN' });
  assert.equal(rotations, 1);
  finish(response({ ...tokens, access_token: 'next', refresh_token: 'next-refresh' })); await pending;
});
test('a failed durable intent write prevents the rotating POST', async () => {
  let calls = 0;
  const api = fixture(async () => { calls++; return response(tokens); });
  api.storage.setItem = () => { throw new Error('Read-only storage'); };
  await assert.rejects(api.refreshToken(), { code: 'SESSION_STORAGE_FAILED' });
  assert.equal(calls, 0); assert.equal(api.auth.refresh_uncertain, undefined);
});
test('recovery waits for an in-flight rotation instead of clearing its durable intent', async () => {
  let finish, statusQueries = 0;
  const api = fixture(async url => {
    if (url.endsWith('/refresh-status')) { statusQueries++; assert.fail('No status probe during rotation'); }
    return new Promise(resolve => { finish = resolve; });
  });
  const rotating = api.refreshToken();
  const recovery = api.recoverSession(capability);
  assert.equal(JSON.parse(api.storage.getItem(AUTH_KEY)).refresh_uncertain, true);
  finish(response({ ...tokens, refresh_token: 'next' }));
  await Promise.all([rotating, recovery]); assert.equal(statusQueries, 0);
  assert.equal(api.auth.refresh_token, 'next');
});
test('health OK plus expired access cannot authorize an uncertain refresh replay', async () => {
  let calls = 0;
  const api = fixture(async url => { calls++; assert.ok(url.endsWith('/bootstrap')); return expired(); }, true);
  const before = api.storage.getItem(AUTH_KEY);
  await assert.rejects(api.recoverSession({ status: 'ok' }), { code: 'REFRESH_RECOVERY_REQUIRED' });
  assert.equal(calls, 1); assert.equal(api.storage.getItem(AUTH_KEY), before); assert.equal(api.authenticationRequired, false);
});
test('valid access can be verified without erasing uncertain refresh state', async () => {
  const api = fixture(async () => response(snapshot()), true);
  await api.recoverSession({ status: 'ok' });
  assert.equal(api.auth.refresh_uncertain, true);
});
test('advertised non-rotating status proof recovers and permits exactly one future rotation', async () => {
  let checks = 0, rotations = 0;
  const api = fixture(async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    if (url.endsWith('/refresh-status')) { checks++; return response(proof(options)); }
    assert.ok(url.endsWith('/auth/refresh')); rotations++; return response({ ...tokens, refresh_token: 'next' });
  }, true);
  await Promise.all([api.recoverSession(capability), api.recoverSession(capability)]);
  assert.equal(checks, 1); assert.equal(api.auth.refresh_uncertain, undefined);
  await api.refreshToken(); assert.equal(rotations, 1);
});
test('foreign, stale, or rotated proof cannot unlock saved refresh credentials', async () => {
  for (const change of [{ request_id: 'stale' }, { device_id: 'foreign' }, { workspace_id: 'foreign' }, { rotation_performed: true }, { refresh_token_state: 'spent' }]) {
    const api = fixture(async (_url, options) => response({ ...proof(options), ...change }), true);
    await assert.rejects(api.recoverSession(capability), { code: 'REFRESH_RECOVERY_REQUIRED' });
    assert.equal(api.auth.refresh_uncertain, true);
  }
});
test('backend revocation during recovery is terminal, health and network failures are not', async () => {
  const api = fixture(async () => response({ error: { code: 'DEVICE_REVOKED', message: 'Revoked' } }, 401), true);
  await assert.rejects(api.recoverSession(capability), { code: 'DEVICE_REVOKED' });
  assert.equal(api.authenticationRequired, true); assert.equal(api.storage.getItem(AUTH_KEY), null);
});
test('transient failure of the non-rotating status query remains recoverable without deleting tokens', async () => {
  const api = fixture(async () => { throw new Error('Temporary network failure'); }, true);
  const before = api.storage.getItem(AUTH_KEY);
  await assert.rejects(api.recoverSession(capability), { code: 'REFRESH_RECOVERY_REQUIRED' });
  assert.equal(api.storage.getItem(AUTH_KEY), before); assert.equal(api.authenticationRequired, false);
});
test('a late recovery proof cannot restore a forgotten session', async () => {
  let finish;
  const api = fixture(async (_url, options) => new Promise(resolve => { finish = () => resolve(response(proof(options))); }), true);
  const pending = api.recoverSession(capability); api.clearTokens(); finish();
  await assert.rejects(pending, { code: 'SESSION_CLOSED' }); assert.equal(api.accessToken, null);
});
test('startup reconnects after transient health failures and only a WebSocket handshake becomes connected', async t => {
  let health = 0, sockets = 0;
  const api = fixture(async url => {
    if (url.endsWith('/health/ready')) { if (++health <= 2) throw new Error('Wake in progress'); return response({ status: 'ok' }); }
    if (url.endsWith('/bootstrap')) return response(snapshot());
    if (url.endsWith('/ws-ticket')) return response({ ticket: 'test', subprotocol: 'hermes.telemetry.v1' });
    return response({ items: [] });
  });
  api.socketFactory = async () => { sockets++; return { close() {}, send() {} }; };
  const workspace = new Workspace(api); t.after(() => workspace.disconnect());
  await workspace.connect(); assert.notEqual(workspace.state.status, 'connected');
  await until(() => workspace.state.status === 'connected');
  assert.equal(sockets, 1); assert.equal(workspace.state.error, ''); assert.ok(health >= 3);
});
test('parallel connect calls share the initial attempt and suspend cancels reconnect without logout', async t => {
  let finish, reads = 0;
  const api = fixture(async url => {
    if (url.endsWith('/health/ready')) { reads++; return new Promise(resolve => { finish = resolve; }); }
    return response({ items: [] });
  });
  const workspace = new Workspace(api); t.after(() => workspace.disconnect());
  const one = workspace.connect(), two = workspace.connect(); assert.equal(reads, 1);
  workspace.suspend(); finish(response({ status: 'ok' })); await Promise.all([one, two]);
  assert.equal(api.accessToken, 'access'); assert.equal(api.reconnectTimer, null); assert.equal(workspace.state.telemetryConnected, false);
});
test('pairing/external telemetry stop cannot leave Workspace stuck with a stale started flag', async t => {
  let sockets = 0;
  const api = fixture(async url => response(url.endsWith('/health/ready') ? { status: 'ok' } : url.endsWith('/bootstrap') ? snapshot() : url.endsWith('/ws-ticket') ? { ticket: 't', subprotocol: 'hermes.telemetry.v1' } : { items: [] }));
  api.socketFactory = async () => { sockets++; return { close() {}, send() {} }; };
  const workspace = new Workspace(api); t.after(() => workspace.disconnect());
  await workspace.connect(); api.stopTelemetry();
  await workspace.connect(); assert.equal(sockets, 2);
  await workspace.reconnect(); assert.equal(sockets, 3); assert.equal(api.accessToken, 'access');
});
test('a stale socket without pong reconnects even when the OS emits no visibility event', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0, closed = 0;
  const api = fixture(async () => response({ ticket: 'test', subprotocol: 'hermes.telemetry.v1' }));
  api.now = () => now;
  api.socketFactory = async () => ({ close() { closed++; }, send() {} });
  t.after(() => api.stopTelemetry());
  const states = [];
  await api.startTelemetry({ onEvent() {}, onStatus: status => states.push(status) });
  now = 46000; t.mock.timers.tick(15000);
  assert.equal(closed, 1); assert.ok(states.includes('reconnecting'));
});
test('loading refresh is single-flight and a recovered snapshot clears its old transport error', async () => {
  let finish, calls = 0;
  const api = { accessToken: 'access', auth: {}, workspaceId: 'w', deviceId: 'd', socket: {}, stopTelemetry() {},
    getBootstrap: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    getMissions: async () => ({ items: [] }), getSessions: async () => ({ items: [] }), getApprovals: async () => ({ items: [] }), getQuestions: async () => ({ items: [] }) };
  const workspace = new Workspace(api);
  Object.assign(workspace.state, { status: 'offline', telemetryConnected: true, error: 'Old timeout' });
  const one = workspace.refresh(), two = workspace.refresh(); assert.equal(workspace.state.syncing, true);
  finish(snapshot()); await Promise.all([one, two]);
  assert.equal(calls, 1); assert.equal(workspace.state.syncing, false); assert.equal(workspace.state.error, ''); assert.equal(workspace.state.status, 'connected');
});
test('only scoped connection errors clear on recovery; mutation uncertainty remains visible', () => {
  assert.equal(clearedConnectionError('connection', { status: 'offline', syncVersion: 2 }, 1), true);
  assert.equal(clearedConnectionError('action', { status: 'connected', syncVersion: 2 }, 1), false);
  assert.equal(clearedConnectionError('connection', { status: 'offline', syncVersion: 1 }, 1), false);
});
test('lifecycle coalesces wake hints, suspends hidden content, and does not require internet onLine', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  let resumed = 0, suspended = 0;
  const workspace = { state: { status: 'offline' }, resume: async () => { resumed++; }, suspend: () => { suspended++; } };
  const dispose = bindConnectionLifecycle(workspace, win, doc);
  win.dispatchEvent(new Event('online')); win.dispatchEvent(new Event('focus')); t.mock.timers.tick(150); assert.equal(resumed, 1);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(suspended, 1);
  t.mock.timers.tick(1000); assert.equal(resumed, 1);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(150); assert.equal(resumed, 2);
  dispose(); t.mock.timers.tick(1000); assert.equal(resumed, 2);
});
test('refresh renderer exposes disabled busy feedback and bounded jitter does not exceed 30 seconds', () => {
  const api = { accessToken: 'access', auth: {} };
  const workspace = new Workspace(api); workspace.state.status = 'connected'; workspace.state.syncing = true;
  const html = render(workspace.state, { page: 'overview', pending: new Set() }, api, false);
  assert.match(html, /data-action="refresh"[^>]*aria-busy="true"[^>]*disabled/);
  assert.equal(reconnectDelay(50, 1000, () => 1), 30000);
  assert.ok(reconnectDelay(50, 1000, () => 0) >= 24000);
});
