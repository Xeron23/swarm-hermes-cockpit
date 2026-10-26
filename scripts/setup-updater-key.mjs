import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const filename = process.argv[2];
if (!filename || !path.isAbsolute(filename)) throw new Error('Pass an absolute private key path outside the repository.');
if (path.relative(root, filename).split(path.sep)[0] !== '..') throw new Error('Store the private signing key outside the repository.');
mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
if (!existsSync(filename)) {
  // The CLI prints key material: capture and discard its output, never log it.
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'generate', '--ci', '--password', '', '--write-keys', filename], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Signing key generation failed; no key material was printed.');
}
chmodSync(filename, 0o600);
if (!existsSync(`${filename}.pub`)) throw new Error('Existing key has no public key file; refusing to replace it.');
const publicKey = readFileSync(`${filename}.pub`, 'utf8').trim();
const configPath = path.join(root, 'src-tauri/updater.json');
const config = { ...JSON.parse(readFileSync(configPath, 'utf8')), publicKey };
writeFileSync(path.join(root, 'src-tauri/updater.json'), JSON.stringify(config, null, 2) + '\n');
const tauriPath = path.join(root, 'src-tauri/tauri.conf.json');
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
tauri.plugins = { ...tauri.plugins, updater: { pubkey: publicKey, endpoints: config.endpoints, requireSignedVersion: true, windows: { installMode: 'passive' } } };
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
console.log(`Public updater configuration written. Private key remains at ${filename}; add its contents to GitHub Actions secret TAURI_SIGNING_PRIVATE_KEY.`);
