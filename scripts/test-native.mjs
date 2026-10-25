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
  if (command === 'runtime_info') return { app: 'Hermes Cockpit', version: '0.1.2', platform: 'android', mode: 'live', commit: 'fixture-commit', build_run: '14' };
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
let bodyRead = false;
globalThis.fetch = () => { throw new Error('Native networking must not use WebView fetch'); };
mockIPC((command, args) => {
  if (command === 'plugin:http|fetch') {
    assert.equal(args.clientConfig.url, 'http://192.168.1.4:3450/health/ready');
    assert.equal(args.clientConfig.method, 'GET');
    assert.equal(args.clientConfig.maxRedirections, 0);
    return 31;
  }
  if (command === 'plugin:http|fetch_send') return { status: 200, statusText: 'OK', url: 'http://192.168.1.4:3450/health/ready', headers: [['content-type', 'application/json']], rid: 32 };
  if (command === 'plugin:http|fetch_read_body') {
    if (bodyRead) return [1];
    bodyRead = true;
    return [...new TextEncoder().encode('{"status":"ok"}'), 0];
  }
  if (command === 'plugin:http|fetch_cancel_body') return null;
  throw new Error(`Unexpected native HTTP command: ${command}`);
});
try { assert.deepEqual(await (await httpFetch('http://192.168.1.4:3450/health/ready', {})).json(), { status: 'ok' }); }
finally { globalThis.fetch = originalFetch; }
clearMocks();
delete globalThis.isTauri;
console.log('PASS: clipboard/runtime, native HTTP without WebView fetch, and native WebSocket lifecycle (mocked)');
