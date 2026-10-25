import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppUpdater, updateError } from '../src/app_updater.js';
import { encryptKeystore, decryptKeystore } from './android-signing.mjs';

function fixture(platform = 'windows') {
  const calls = [];
  const update = {
    version: '0.1.5+build.30.1', body: 'A release',
    async download(callback) { calls.push('download'); callback({ event: 'Started', data: { contentLength: 4 } }); callback({ event: 'Progress', data: { chunkLength: 4 } }); callback({ event: 'Finished' }); },
    async install(options) { calls.push(['install', options]); return { status: 'installed' }; },
    async close() { calls.push('close'); }
  };
  const service = { async platform() { return platform; }, async check(actual) { calls.push(['check', actual]); return update; } };
  return { controller: new AppUpdater({ service }), service, update, calls };
}

for (const platform of ['windows', 'android']) test(`${platform}: startup only checks; download and install require separate requests`, async t => {
  const { controller, calls } = fixture(platform);
  t.after(() => controller.dispose());
  await controller.start();
  assert.deepEqual(calls, [['check', platform]]);
  assert.equal(controller.state.status, 'available');
  await controller.install();
  assert.equal(calls.length, 1);
  const states = [];
  controller.subscribe(state => states.push(state.status));
  await controller.download();
  assert.equal(controller.state.bytes, 4);
  assert.equal(controller.state.status, 'ready');
  assert.ok(states.includes('verifying'));
  assert.equal(calls.includes('install'), false);
  await controller.check(); // A ready package must not be discarded by the automatic timer.
  await controller.install();
  assert.deepEqual(calls, [['check', platform], 'download', ['install', { restartAfterInstall: true }]]);
});

test('browser and other unsupported platforms never contact update servers', async () => {
  for (const platform of ['browser', 'linux']) {
    const { controller, calls } = fixture(platform);
    await controller.start(); await controller.check(); await controller.download(); await controller.install();
    assert.equal(controller.state.status, 'unsupported'); assert.deepEqual(calls, []);
    await controller.dispose();
  }
});

test('a completed transfer with a rejected signature is never installable', async t => {
  const { controller, update, calls } = fixture(); t.after(() => controller.dispose());
  update.download = async callback => { callback({ event: 'Finished' }); throw new Error('signature verification failed'); };
  await controller.start(); await controller.download(); await controller.install();
  assert.equal(controller.state.status, 'error');
  assert.match(controller.state.error, /Tanda tangan/);
  assert.deepEqual(calls, [['check', 'windows']]);
});

test('repeated clicks cannot launch overlapping downloads or installation', async t => {
  const { controller, update } = fixture(); t.after(() => controller.dispose());
  let complete, downloads = 0;
  update.download = () => { downloads++; return new Promise(resolve => { complete = resolve; }); };
  await controller.start(); const pending = controller.download(); await controller.download(); await controller.install();
  assert.equal(downloads, 1); assert.equal(controller.state.status, 'downloading');
  complete(); await pending; assert.equal(controller.state.status, 'ready');
});

test('Android cancellation, missing permission, and installer failure retain the verified package', async t => {
  const { controller, update } = fixture('android'); t.after(() => controller.dispose());
  await controller.start(); await controller.download();
  for (const status of ['cancelled', 'permission_required']) {
    update.install = async () => ({ status }); await controller.install();
    assert.equal(controller.state.status, 'ready'); assert.ok(controller.state.notice);
  }
  update.install = async () => { throw { code: 'UPDATE_CERTIFICATE_MISMATCH' }; };
  await controller.install(); assert.equal(controller.state.status, 'ready'); assert.match(controller.state.error, /Sertifikat/);
});

test('checking again releases the previous native resource without downloading', async t => {
  const { controller, calls, service } = fixture(); t.after(() => controller.dispose());
  await controller.start(); service.check = async () => null; await controller.check();
  assert.equal(controller.state.status, 'current'); assert.equal(controller.update, null);
  assert.deepEqual(calls, [['check', 'windows'], 'close']);
});

test('update errors never expose request credentials or internal messages', () => {
  assert.doesNotMatch(updateError(new Error('https://user:secret@example.invalid?token=private')), /secret|private|example/);
});

test('durable Android identity is encrypted, authenticated, and bound to the private signing key', () => {
  const bytes = Buffer.from('fixture APK certificate private key');
  const secret = 'fixture updater private key';
  const encrypted = encryptKeystore(bytes, secret);
  assert.ok(!JSON.stringify(encrypted).includes(bytes.toString()));
  assert.deepEqual(decryptKeystore(encrypted, secret), bytes);
  assert.throws(() => decryptKeystore(encrypted, 'other key'));
  assert.throws(() => decryptKeystore({ ...encrypted, data: Buffer.alloc(bytes.length).toString('base64') }, secret));
});
