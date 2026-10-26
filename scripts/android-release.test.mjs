import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signingInputs, decodeKeystore, versionCode, configureGradle } from './android-release.mjs';

const config = JSON.parse(readFileSync(new URL('../src-tauri/android-release.json', import.meta.url)));
test('APK signing requires a durable identity even when updater signing is optional', () => {
  assert.throws(() => signingInputs({}), /No new identity/);
  const identity = signingInputs({ ANDROID_DEBUG_KEYSTORE_BASE64: 'YQ==' });
  assert.equal(identity.alias, 'androiddebugkey');
  assert.equal(identity.storePassword, 'android');
  assert.throws(() => signingInputs({ ANDROID_RELEASE_KEYSTORE_BASE64: 'YQ==', ANDROID_DEBUG_KEYSTORE_BASE64: 'YQ==' }), /cannot fall back/);
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
