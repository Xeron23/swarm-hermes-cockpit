import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const base = await json('src-tauri/tauri.conf.json');
const schema = await json('node_modules/@tauri-apps/cli/config.schema.json');
const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false, unicodeRegExp: false }).compile(schema);

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
assert.deepEqual(capabilities.permissions.find(p => p.identifier === 'http:default').allow, [{ url: 'http://192.168.1.4:3450/**' }]);

for (const filename of base.bundle.icon) await access(path.join(root, 'src-tauri', filename));
for (const filename of await readdir(path.join(root, 'src'))) {
  if (!filename.endsWith('.js')) continue;
  const check = spawnSync(process.execPath, ['--check', path.join(root, 'src', filename)], { encoding: 'utf8' });
  assert.equal(check.status, 0, `${filename}: ${check.stderr}`);
}
const pkg = await json('package.json');
assert.equal(pkg.version, base.version);
assert.ok(pkg.dependencies['@tauri-apps/api'].startsWith('2.'));
assert.ok(pkg.devDependencies['@tauri-apps/cli'].startsWith('2.'));
console.log('PASS: Tauri v2 config schema (base, Android, Windows)');
console.log('PASS: local assets, JS syntax, native permissions, and version consistency');
console.log('Native compilation is a separate check: npm run build / npm run android:build:debug');
