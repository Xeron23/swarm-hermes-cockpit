import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validateTestManifest } from './test-windows-native.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const base = await json('src-tauri/tauri.conf.json');
const schema = await json('node_modules/@tauri-apps/cli/config.schema.json');
const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false, unicodeRegExp: false }).compile(schema);
validateTestManifest(await readFile(path.join(root, 'src-tauri/windows-test.manifest')));

function merge(baseValue, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const result = { ...baseValue };
  for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
  return result;
}

for (const name of ['base', 'android', 'windows']) {
  const config = name === 'base' ? base : merge(base, await json(`src-tauri/tauri.${name}.conf.json`));
  assert.ok(validate(config), `${name} config: ${JSON.stringify(validate.errors, null, 2)}`);
}

assert.equal(base.build.frontendDist, '../dist');
assert.equal(base.build.devUrl, 'http://localhost:1420');
assert.ok(base.app.security.csp.includes("script-src 'self'"));
assert.ok(!base.app.security.csp.includes('unsafe-eval'));
const capabilities = await json('src-tauri/capabilities/default.json');
assert.deepEqual(capabilities.windows, ['main']);
assert.ok(capabilities.permissions.includes('core:default'));
assert.ok(capabilities.permissions.includes('clipboard-manager:allow-write-text'));
assert.ok(capabilities.permissions.includes('websocket:default'));
assert.ok(capabilities.permissions.includes('allow-backend-request'));
assert.ok(capabilities.permissions.includes('allow-runtime-info'));
const updater = await json('src-tauri/updater.json');
assert.equal(base.plugins.updater.pubkey, updater.publicKey);
assert.deepEqual(base.plugins.updater.endpoints, updater.endpoints);
assert.equal(base.plugins.updater.requireSignedVersion, true);
assert.equal(base.plugins.updater.allowDowngrades, false);
assert.equal('channelTag' in updater, false);
assert.deepEqual(updater.endpoints, [`https://github.com/${updater.repository}/releases/latest/download/latest.json`]);
assert.deepEqual((await json('src-tauri/capabilities/windows-updater.json')).platforms, ['windows']);
assert.deepEqual((await json('src-tauri/capabilities/android-updater.json')).platforms, ['android']);

for (const filename of base.bundle.icon) await access(path.join(root, 'src-tauri', filename));
for (const filename of await readdir(path.join(root, 'src'))) {
  if (!filename.endsWith('.js')) continue;
  const check = spawnSync(process.execPath, ['--check', path.join(root, 'src', filename)], { encoding: 'utf8' });
  assert.equal(check.status, 0, `${filename}: ${check.stderr}`);
}
const pkg = await json('package.json');
assert.equal(pkg.version, base.version);
const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
const packageSection = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.equal(cargoVersion, pkg.version, 'Cargo, Tauri, and npm application versions must match');
assert.ok(pkg.dependencies['@tauri-apps/api'].startsWith('2.'));
assert.ok(pkg.devDependencies['@tauri-apps/cli'].startsWith('2.'));
console.log('PASS: Tauri v2 config schema (base, Android, Windows)');
console.log('PASS: local assets, JS syntax, native permissions, and version consistency');
console.log('PASS: Windows test assembly definition and Common Controls v6 dependency');
console.log('Native compilation is a separate check: npm run build / npm run android:build (bootstrap or persistent APK signing)');
