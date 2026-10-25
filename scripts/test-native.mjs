import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';

// Test only the OS boundary with Tauri's official IPC mock; no OS clipboard writes.
globalThis.window = globalThis;
globalThis.isTauri = false;
const webWrites = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async text => { webWrites.push(text); } } }
});
await import('../src/native.js');
await window.HermesNative.copyText('browser payload');
assert.deepEqual(webWrites, ['browser payload']);
assert.equal((await window.HermesNative.getRuntimeInfo()).platform, 'browser');
await assert.rejects(window.HermesNative.copyText(123), TypeError);

const nativeCalls = [];
globalThis.isTauri = true;
mockIPC((command, args) => {
  nativeCalls.push({ command, args });
  if (command === 'runtime_info') return { app: 'Hermes Cockpit', version: '0.1.5', platform: 'android', mode: 'live', commit: 'fixture-commit', build_run: '15' };
  if (command === 'plugin:clipboard-manager|write_text') return null;
  throw new Error(`Unexpected native command: ${command}`);
});
await window.HermesNative.copyText('native payload');
assert.equal(nativeCalls[0].command, 'plugin:clipboard-manager|write_text');
assert.equal(nativeCalls[0].args.text, 'native payload');
assert.equal((await window.HermesNative.getRuntimeInfo()).platform, 'android');
assert.equal(webWrites.length, 1, 'Native mode must not use the browser clipboard fallback.');
assert.ok(nativeCalls.every(c => !c.command.includes('read_text')), 'No clipboard reads are needed.');

// Native telemetry must receive replay frames sent before connect resolves.
const { openSocket } = await import('../src/transport.js');
let channel;
const sends = [];
mockIPC((command, args) => {
  if (command === 'plugin:websocket|connect') {
    assert.equal(args.url, 'ws://192.168.1.4:3450/ws/telemetry?ticket=fixture');
    assert.deepEqual(args.config.headers, [['Sec-WebSocket-Protocol', 'hermes.telemetry.v1']]);
    channel = args.onMessage;
    channel.onmessage({ type: 'Text', data: 'early replay' });
    return 17;
  }
  if (command === 'plugin:websocket|send') { sends.push(args); return null; }
  throw new Error(`Unexpected native command: ${command}`);
});
const received = [];
const socket = await openSocket('ws://192.168.1.4:3450/ws/telemetry?ticket=fixture', 'hermes.telemetry.v1', { message: text => received.push(text), close() {} });
assert.deepEqual(received, ['early replay']);
channel.onmessage(null);
await socket.send('ping');
assert.deepEqual(sends[0], { id: 17, message: { type: 'Text', data: 'ping' } });
await socket.close();
channel.onmessage({ type: 'Text', data: 'stale replay' });
assert.deepEqual(received, ['early replay']);
// The packaged app must use Rust HTTP, not the WebView fetch blocked by CSP.
const { httpFetch } = await import('../src/transport.js');
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Native networking must not use WebView fetch'); };
mockIPC((command, args) => {
  if (command === 'backend_request') {
    assert.equal(args.request.url, 'http://192.168.1.4:3450/health/ready');
    assert.equal(args.request.method, 'GET');
    return { status: 200, body: '{"status":"ok"}' };
  }
  throw new Error(`Unexpected native HTTP command: ${command}`);
});
try { assert.deepEqual(await (await httpFetch('http://192.168.1.4:3450/health/ready', {})).json(), { status: 'ok' }); }
finally { globalThis.fetch = originalFetch; }
const aborted = new AbortController();
aborted.abort();
mockIPC(() => { throw new Error('An aborted request must not reach Rust'); });
await assert.rejects(httpFetch('http://192.168.1.4:3450/health/ready', { signal: aborted.signal }), { name: 'AbortError' });
const { HermesApiClient } = await import('../src/api_client.js');
const api = new HermesApiClient({ storage: null });
let nativeRequests = 0;
mockIPC((command, { request }) => {
  assert.equal(command, 'backend_request');
  nativeRequests++;
  if (request.url.endsWith('/auth/pair')) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.some(([name]) => name === 'authorization'), false);
    assert.equal(JSON.parse(request.body).pairing_code, 'A'.repeat(26));
    return { status: 200, body: JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', device_id: 'fixture-device', workspace_id: 'fixture-workspace' }) };
  }
  assert.ok(request.url.endsWith('/bootstrap'));
  assert.deepEqual(request.headers.find(([name]) => name === 'authorization'), ['authorization', 'Bearer fixture-access']);
  return { status: 200, body: '{"workspace_id":"fixture-workspace"}' };
});
await api.pair('A'.repeat(26), 'Fixture');
assert.equal((await api.getBootstrap()).workspace_id, 'fixture-workspace');
assert.equal(nativeRequests, 2);
mockIPC(() => Promise.reject({ code: 'CONNECTION_REFUSED', message: 'Safe Rust classification' }));
await assert.rejects(api.getHealth(), { code: 'CONNECTION_REFUSED', endpoint: '/health/ready' });
// Exercise the official Windows updater SDK and Android resource adapter.
const { updateService } = await import('../src/update_service.js');
for (const platform of ['windows', 'android']) {
  const commands = [];
  mockIPC((command, args) => {
    commands.push(command);
    if (command === 'plugin:updater|check' || command === 'android_update_check') return { rid: 41, version: '0.1.5+build.30.1', currentVersion: '0.1.5', body: 'fixture' };
    if (command === 'plugin:updater|download' || command === 'android_update_download') {
      assert.equal(args.rid, 41);
      args.onEvent.onmessage({ event: 'Started', data: { contentLength: 4 } });
      args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 4 } });
      args.onEvent.onmessage({ event: 'Finished' });
      return platform === 'windows' ? 42 : null;
    }
    if (command === 'plugin:updater|install') {
      assert.equal(args.updateRid, 41); assert.equal(args.bytesRid, 42); assert.equal(args.restartAfterInstall, true); return null;
    }
    if (command === 'android_update_install') { assert.equal(args.rid, 41); return { status: 'cancelled' }; }
    if (command === 'plugin:resources|close' || command === 'android_update_close') return null;
    throw new Error(`Unexpected updater command: ${command}`);
  });
  const update = await updateService.check(platform);
  assert.equal(commands.length, 1, 'Checking must not download or install.');
  const events = [];
  await update.download(event => events.push(event.event));
  assert.deepEqual(events, ['Started', 'Progress', 'Finished']);
  const result = await update.install({ restartAfterInstall: true });
  if (platform === 'android') assert.equal(result.status, 'cancelled');
  await update.close();
}
clearMocks();
delete globalThis.isTauri;
console.log('PASS: native clipboard/runtime, HTTP, WebSocket, and Windows/Android updater adapters (mocked)');
