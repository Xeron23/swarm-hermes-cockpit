import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseMetadata } from './release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  if (process.env.HERMES_UPDATER_SIGNING_REQUIRED === 'true') {
    throw new Error('Signing is required for this run, but TAURI_SIGNING_PRIVATE_KEY is unavailable in the build job.');
  }
  console.log('Updater signing is not configured; publishing bootstrap installers without an update feed.');
  process.exit(0);
}
const directory = process.argv[2] || 'release-assets';
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const metadata = releaseMetadata(process.env, version);
const signedVersion = `${version.split('+')[0]}+build.${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT}`;
const files = readdirSync(directory).filter(name => /\.(exe|msi|apk)$/i.test(name)).map(name => path.resolve(directory, name));
if (!files.length) throw new Error('No updater packages were built.');
const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' };
for (const filename of files) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--app-version', signedVersion, filename], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`Updater signing failed for ${path.basename(filename)}; check the signing secret.`);
}
const verifyEnv = { ...env };
delete verifyEnv.TAURI_SIGNING_PRIVATE_KEY;
delete verifyEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
const verify = spawnSync('cargo', ['run', '--release', '--locked', '--manifest-path', 'scripts/updater-verifier/Cargo.toml', '--', 'src-tauri/updater.json', signedVersion, ...files], { cwd: root, env: verifyEnv, stdio: 'inherit' });
if (verify.status !== 0) throw new Error('Updater package verification failed; refusing to upload mismatched signatures.');
console.log(`Signed updater packages for ${metadata.tag}, version ${signedVersion}`);
