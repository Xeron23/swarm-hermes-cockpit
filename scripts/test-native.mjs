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
  if (command === 'runtime_info') return { app: 'Hermes Cockpit', version: '0.1.0', platform: 'android', mode: 'demo' };
  if (command === 'plugin:clipboard-manager|write_text') return null;
  throw new Error(`Unexpected native command: ${command}`);
});
await window.HermesNative.copyText('native payload');
assert.equal(nativeCalls[0].command, 'plugin:clipboard-manager|write_text');
assert.equal(nativeCalls[0].args.text, 'native payload');
assert.equal((await window.HermesNative.getRuntimeInfo()).platform, 'android');
assert.equal(webWrites.length, 1, 'Native mode must not use the browser clipboard fallback.');
assert.ok(nativeCalls.every(c => !c.command.includes('read_text')), 'No clipboard reads are needed.');
clearMocks();
delete globalThis.isTauri;
console.log('PASS: browser clipboard fallback, native clipboard routing, and runtime-info IPC (mocked)');
