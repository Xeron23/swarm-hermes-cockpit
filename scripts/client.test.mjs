import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesApiClient, compareSequence } from '../src/api_client.js';
import { Workspace, metricRows } from '../src/workspace.js';
import { render } from '../src/views.js';
import { SERVER_URL, NETWORK } from '../src/transport.js';

const tokens = { access_token: 'test-access', refresh_token: 'test-refresh', workspace_id: 'test-workspace', device_id: 'test-device' };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const unauthorized = () => response({ error: { code: 'TOKEN_EXPIRED', message: 'Expired', retryable: false } }, 401);
function storage() { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) }; }
const client = options => { const api = new HermesApiClient({ storage: storage(), ...options }); api.setTokens(tokens); return api; };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } assert.fail('Timed out waiting for client'); }
const snapshot = () => ({ ...tokens, last_event_seq: '90071992547409931', agents: [{ id: 'main', name: 'Real orchestrator', status: 'idle', tools: [] }], nodes: [
  { id: 'vps', name: 'Actual server', status: 'online', os: 'linux', metrics: null, metrics_stale: true, accepting_tasks: true },
  { id: 'pc', name: 'Actual PC', status: 'offline', os: 'windows', metrics: null, metrics_stale: true, accepting_tasks: false }
], active_missions: [], features: { real_mode: true, runtime_ready: true } });

test('subnet router uses the VM endpoint, not the Proxmox endpoint; credentials are endpoint scoped', () => {
  assert.equal(SERVER_URL, 'http://192.168.1.4:3450');
  assert.equal(NETWORK.subnetRouter, '100.114.42.71');
  const saved = storage();
  client({ storage: saved });
  assert.equal(new HermesApiClient({ storage: saved }).workspaceId, tokens.workspace_id);
  assert.equal(new HermesApiClient({ storage: saved, baseUrl: 'http://other.invalid' }).accessToken, null);
});
test('pairing validates Base32 and sends no old Authorization header', async () => {
  let calls = 0;
  const api = client({ fetcher: async (url, options) => {
    calls++; assert.ok(url.endsWith('/auth/pair'));
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { pairing_code: 'A'.repeat(26), device_name: 'PC' });
    return response(tokens);
  } });
  await assert.rejects(api.pair('8'.repeat(26), 'PC'), { code: 'INVALID_PAIRING_CODE' });
  assert.equal(calls, 0);
  await api.pair('a'.repeat(26), ' PC ');
  assert.equal(calls, 1);
});
test('concurrent expired access tokens rotate a refresh token only once', async () => {
  let rotations = 0;
  const api = client({ fetcher: async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      rotations++; await tick();
      assert.equal(JSON.parse(options.body).refresh_token, 'test-refresh');
      assert.equal(options.headers.Authorization, undefined);
      return response({ ...tokens, access_token: 'new-access', refresh_token: 'new-refresh' });
    }
    return options.headers.Authorization === 'Bearer new-access' ? response({ items: [] }) : unauthorized();
  } });
  await Promise.all(Array.from({ length: 12 }, () => api.getNodes()));
  assert.equal(rotations, 1);
  assert.equal(api.auth.refresh_token, 'new-refresh');
});
test('a lost rotating refresh response is never automatically retried, including after restart', async () => {
  let rotations = 0;
  const saved = storage();
  const fetcher = async url => {
    if (url.endsWith('/auth/refresh')) { rotations++; throw new TypeError('Connection lost'); }
    return unauthorized();
  };
  const api = client({ storage: saved, fetcher });
  await assert.rejects(api.getNodes(), { code: 'NETWORK_ERROR' });
  await assert.rejects(api.getNodes(), { code: 'REFRESH_UNCERTAIN' });
  await assert.rejects(new HermesApiClient({ storage: saved, fetcher }).getNodes(), { code: 'REFRESH_UNCERTAIN' });
  assert.equal(rotations, 1);
});
test('token reuse revocation clears the local session', async () => {
  const api = client({ fetcher: async url => url.endsWith('/auth/refresh') ? response({ error: { code: 'TOKEN_REUSE_DETECTED', message: 'Revoked' } }, 401) : unauthorized() });
  await assert.rejects(api.getNodes(), { code: 'TOKEN_REUSE_DETECTED' });
  assert.equal(api.accessToken, null);
});
test('expired credentials transition telemetry to auth_required even when revocation stops its generation', async () => {
  const statuses = [];
  const api = client({ fetcher: async () => unauthorized(), socketFactory: async () => assert.fail('No socket without authentication') });
  api.startTelemetry({ beforeConnect: () => api.getBootstrap(), onEvent() {}, onStatus: status => statuses.push(status) });
  await until(() => statuses.includes('auth_required'));
  assert.equal(api.accessToken, null);
  api.stopTelemetry();
});
test('a forbidden action does not rotate credentials or retry the action', async () => {
  let calls = 0;
  const api = client({ fetcher: async () => { calls++; return response({ error: { code: 'FORBIDDEN', message: 'Not permitted' } }, 403); } });
  await assert.rejects(api.power('pc', 'shutdown', 'Reason'), { status: 403 });
  assert.equal(calls, 1);
  assert.equal(api.accessToken, 'test-access');
});
test('an in-flight refresh cannot restore credentials after logout', async () => {
  let resolveRefresh;
  const api = client({ fetcher: async () => new Promise(resolve => { resolveRefresh = resolve; }) });
  const refresh = api.refreshToken();
  await until(() => resolveRefresh);
  api.clearTokens(); resolveRefresh(response(tokens));
  await assert.rejects(refresh, { code: 'SESSION_CLOSED' });
  assert.equal(api.accessToken, null);
});
test('mutation transport failure is not replayed and has an uncertain-outcome message', async () => {
  let calls = 0;
  const api = client({ fetcher: async () => { calls++; throw new TypeError('Lost response'); } });
  await assert.rejects(api.createMission('Mission', 'Prompt', 'auto'), error => error.code === 'NETWORK_ERROR' && !error.retryable && error.message.includes('belum diketahui'));
  assert.equal(calls, 1);
});
test('server error details and typed proof are preserved without claiming action success', async () => {
  const api = client({ fetcher: async () => response({ error: { code: 'APPROVAL_REQUIRED', message: 'Approval needed', details: { request_hash: 'hash' }, retryable: false } }, 409) });
  await assert.rejects(api.power('pc', 'sleep', 'Reason'), error => error.code === 'APPROVAL_REQUIRED' && error.details.request_hash === 'hash');
});
test('decimal event sequence comparison is precise beyond JS number limits and older WebViews need no BigInt', () => {
  assert.equal(compareSequence('90071992547409932', '90071992547409931'), 1);
  assert.equal(compareSequence('10', '9'), 1);
  assert.equal(compareSequence('00010', '10'), 0);
  assert.throws(() => compareSequence(105, '104'));
});
test('telemetry handles pong, duplicate/out-of-order events and foreign workspace; reconnect gets a fresh ticket', async t => {
  const sockets = [], events = [], ticketNumbers = [];
  let tickets = 0;
  const api = client({ retryDelay: 1, fetcher: async () => response({ ticket: `ticket-${++tickets}`, subprotocol: 'hermes.telemetry.v1' }), socketFactory: async (url, protocol, handlers) => {
    const parsed = new URL(url);
    assert.equal(protocol, 'hermes.telemetry.v1');
    ticketNumbers.push(parsed.searchParams.get('ticket'));
    sockets.push(handlers);
    return { send() {}, close() { handlers.close(); } };
  } });
  t.after(() => api.stopTelemetry());
  api.lastEventSeq = '90071992547409931';
  api.startTelemetry({ onEvent: e => events.push(e), onStatus() {} });
  await until(() => sockets.length === 1 && api.socket);
  const event = { schema_version: '1.0', workspace_id: tokens.workspace_id, event_id: 'event-1', seq: '90071992547409932', event_type: 'NODE_STATE', payload: {} };
  sockets[0].message('pong'); sockets[0].message('not-json');
  sockets[0].message(JSON.stringify({ ...event, workspace_id: 'foreign' }));
  sockets[0].message(JSON.stringify(event)); sockets[0].message(JSON.stringify(event));
  sockets[0].message(JSON.stringify({ ...event, seq: '2', event_id: 'older' }));
  assert.equal(events.length, 1);
  sockets[0].close();
  await until(() => sockets.length === 2 && api.socket);
  sockets[0].message(JSON.stringify({ ...event, event_id: 'old-socket', seq: '90071992547409933' }));
  assert.equal(events.length, 1);
  assert.deepEqual(ticketNumbers, ['ticket-1', 'ticket-2']);
  api.stopTelemetry();
  sockets[1].close(); await tick();
  assert.equal(sockets.length, 2);
});
test('null hardware metrics stay unavailable, PC stays offline, and the renderer contains no seeded demo', async () => {
  const api = client({ fetcher: async () => response(snapshot()) });
  const workspace = new Workspace(api);
  await workspace.snapshot(true);
  workspace.state.status = 'connected';
  assert.equal(workspace.state.nodes[1].status, 'offline');
  assert.deepEqual(metricRows(workspace.state.nodes[0]), []);
  const html = render(workspace.state, { page: 'nodes', pending: new Set() }, api, workspace.writable);
  assert.match(html, /Belum ada metrik/);
  assert.doesNotMatch(html, /42%|12\.2|RTX 4070|Deploy webhook|Rifki/);
  assert.deepEqual(workspace.state.events, []);
});
test('reject a snapshot for another workspace and prohibit writes until real runtime is connected', async () => {
  const api = client({ fetcher: async () => response({ ...snapshot(), workspace_id: 'foreign' }) });
  const workspace = new Workspace(api);
  await assert.rejects(workspace.snapshot(true), { code: 'INVALID_SNAPSHOT' });
  assert.deepEqual(workspace.state.nodes, []);
  assert.throws(() => workspace.requireOnline(), { code: 'NOT_READY' });
});
test('a malformed mission list reports a contract error instead of erasing a known backend mission', async () => {
  const api = client({ fetcher: async url => response(url.endsWith('/missions') ? { wrong_shape: [] } : { items: [] }) });
  const workspace = new Workspace(api);
  workspace.state.missions = [{ id: 'actual-mission', title: 'Backend mission' }];
  await workspace.sections();
  assert.equal(workspace.state.missions[0].id, 'actual-mission');
  assert.match(workspace.state.sectionErrors.missions, /kontrak/);
});
test('delta messages are reconciled with authoritative final messages, not simulated replies', async () => {
  const api = client({ fetcher: async () => response({ items: [{ id: 'message', session_id: 'session', content: 'Actual final', status: 'complete', seq_no: '100', created_at: '2026-10-25T00:00:00Z' }] }) });
  const workspace = new Workspace(api);
  workspace.applyEvent({ event_type: 'MESSAGE_DELTA', sender: 'agent:coder', timestamp: '2026-10-25T00:00:00Z', payload: { session_id: 'session', message_id: 'message', delta: 'Actual ' } });
  assert.equal(workspace.state.messages.session[0].content, 'Actual ');
  await workspace.loadMessages('session');
  assert.equal(workspace.state.messages.session.length, 1);
  assert.equal(workspace.state.messages.session[0].content, 'Actual final');
  workspace.disconnect();
});
