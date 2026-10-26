import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signingInputs, decodeKeystore, versionCode, configureGradle, prepareBootstrapKeystore, verificationConfig } from './android-release.mjs';

const config = JSON.parse(readFileSync(new URL('../src-tauri/android-release.json', import.meta.url)));
test('no-secrets bootstrap plans a debug identity without requiring Base64', () => {
  const input = signingInputs({});
  assert.equal(input.mode, 'bootstrap-debug');
  assert.equal(input.base64, undefined);
  assert.equal(input.alias, 'androiddebugkey');
});
test('configured signing takes priority and partial configuration never falls back', () => {
  const identity = signingInputs({ ANDROID_DEBUG_KEYSTORE_BASE64: 'YQ==' });
  assert.equal(identity.mode, 'legacy-secret');
  assert.equal(identity.alias, 'androiddebugkey');
  assert.equal(identity.storePassword, 'android');
  assert.throws(() => signingInputs({ ANDROID_RELEASE_KEYSTORE_BASE64: 'YQ==', ANDROID_DEBUG_KEYSTORE_BASE64: 'YQ==' }), /cannot fall back/);
  assert.throws(() => signingInputs({ ANDROID_RELEASE_KEY_ALIAS: 'partial' }), /cannot fall back/);
  const release = signingInputs({ ANDROID_RELEASE_KEYSTORE_BASE64: 'YQ==', ANDROID_RELEASE_STORE_PASSWORD: 'fixture', ANDROID_RELEASE_KEY_ALIAS: 'fixture', ANDROID_RELEASE_KEY_PASSWORD: 'fixture', ANDROID_DEBUG_KEYSTORE_BASE64: 'other' });
  assert.equal(release.mode, 'release-secret');
});
test('signed updater cannot use an unpinned bootstrap fallback', () => {
  assert.throws(() => signingInputs({ TAURI_SIGNING_PRIVATE_KEY: 'fixture' }), /persistent Android/);
  assert.throws(() => signingInputs({ HERMES_UPDATER_SIGNING_REQUIRED: 'true' }), /persistent Android/);
  assert.equal(signingInputs({ HERMES_UPDATER_SIGNING_REQUIRED: 'false' }).mode, 'bootstrap-debug');
});
test('only bootstrap uses a runtime certificate; secret modes retain the historical pin', () => {
  const fingerprint = 'a'.repeat(64);
  const before = JSON.stringify(config);
  assert.equal(verificationConfig(config, signingInputs({}), fingerprint).certificateSha256, fingerprint);
  assert.equal(JSON.stringify(config), before);
  for (const mode of ['release-secret', 'legacy-secret']) {
    assert.throws(() => verificationConfig(config, { mode }, fingerprint), /differs/);
    assert.equal(verificationConfig(config, { mode }, config.certificateSha256).certificateSha256, config.certificateSha256);
  }
  assert.throws(() => verificationConfig(config, { mode: 'unknown' }, fingerprint), /policy/);
});
test('real JDK creates bootstrap identity once, reuses bytes and never replaces a corrupt key', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes-bootstrap-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'debug.keystore');
  const first = prepareBootstrapKeystore({ filename });
  const bytes = readFileSync(filename);
  const second = prepareBootstrapKeystore({ filename });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(readFileSync(filename), bytes);
  const other = prepareBootstrapKeystore({ filename: path.join(directory, 'other.keystore') });
  assert.notEqual(other.fingerprint, first.fingerprint);
  writeFileSync(filename, 'corrupt identity');
  assert.throws(() => prepareBootstrapKeystore({ filename }), /never overwritten/);
  assert.equal(readFileSync(filename, 'utf8'), 'corrupt identity');
});
test('keystore decoding rejects damaged input rather than silently replacing the identity', () => {
  assert.equal(decodeKeystore('YQ==\n').toString(), 'a');
  for (const value of ['', 'a', '%%%%', 'YQ=!', 'YR==']) assert.throws(() => decodeKeystore(value));
});
test('Android versionCode advances between main builds and reruns and exceeds old semver-derived codes', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_NUMBER: '26', GITHUB_RUN_ATTEMPT: '1' };
  const first = versionCode(env, config);
  assert.ok(first > 1005);
  assert.ok(versionCode({ ...env, GITHUB_RUN_ATTEMPT: '2' }, config) > first);
  assert.ok(versionCode({ ...env, GITHUB_RUN_NUMBER: '27' }, config) > versionCode({ ...env, GITHUB_RUN_ATTEMPT: '99' }, config));
  assert.throws(() => versionCode({ ...env, GITHUB_RUN_ATTEMPT: '100' }, config));
  assert.throws(() => versionCode({ ANDROID_VERSION_CODE: '1005' }, config));
  assert.throws(() => versionCode({ ANDROID_VERSION_CODE: '2100000001' }, config));
  assert.equal(versionCode({ ANDROID_VERSION_CODE: '1002701' }, config), 1002701);
});
test('generated Gradle policy is idempotent, preserves release R8 and contains no signing secrets', () => {
  const template = 'android { buildTypes { getByName("release") { optimization { enable = true } } } }\n';
  const once = configureGradle(template, 1002701);
  assert.equal(configureGradle(once, 1002701), once);
  const next = configureGradle(once, 1002702);
  assert.equal(next.split('BEGIN HERMES ANDROID RELEASE').length, 2);
  assert.match(next, /versionCode = 1002702/);
  assert.match(next, /signingConfig = null/);
  assert.match(next, /isDebuggable = false/);
  assert.match(next, /usesCleartextTraffic.*true/);
  assert.doesNotMatch(next, /storePassword|keyPassword|base64/);
  assert.throws(() => configureGradle('android {}', 1002701), /Unexpected Tauri/);
  assert.throws(() => configureGradle(once.replace('// END HERMES ANDROID RELEASE', ''), 1002701), /Incomplete/);
});
test('APK binary inspection and release rejection cases', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['scripts/android-apk.test.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
