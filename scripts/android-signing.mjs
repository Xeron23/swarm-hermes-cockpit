import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const tag = 'android-signing-state';
const asset = 'android-keystore.enc.json';
const context = 'hermes-android-debug-keystore-v1';
const key = (secret, salt) => Buffer.from(hkdfSync('sha256', secret.trim(), salt, context, 32));
export function encryptKeystore(bytes, secret) {
  if (!secret) throw new Error('Missing signing secret');
  const salt = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, salt), iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptKeystore(envelope, secret) {
  if (envelope.version !== 1 || !secret) throw new Error('Invalid signing backup');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, Buffer.from(envelope.salt, 'base64')), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
}

// Only the private source repository receives this encrypted, durable identity.
export function maintainSigning({ mode, secret, repository, filename, gh = args => spawnSync('gh', args, { encoding: 'utf8' }) }) {
  if (!secret) return { configured: false };
  if (!['restore', 'save'].includes(mode) || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid signing backup configuration');
  const invoke = args => {
    const result = gh([...args, '--repo', repository]);
    if (result.status !== 0) throw new Error('Private Android signing backup operation failed. Check workflow permissions.');
    return result.stdout;
  };
  // Repository privacy is checked before uploading any signing state.
  const privacy = gh(['repo', 'view', repository, '--json', 'isPrivate']);
  if (privacy.status !== 0 || JSON.parse(privacy.stdout).isPrivate !== true) throw new Error('Android signing state must remain in the private source repository.');
  const scratch = mkdtempSync(path.join(tmpdir(), 'hermes-android-signing-'));
  try {
    const view = gh(['release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets']);
    if (view.status !== 0 && !/release not found|HTTP 404/i.test(view.stderr || '')) throw new Error('Cannot inspect Android signing backup');
    if (view.status === 0 && JSON.parse(view.stdout).isDraft !== true) throw new Error('Android signing state must remain a private draft.');
    const existing = view.status === 0 && JSON.parse(view.stdout).assets?.some(item => item.name === asset);
    if (existing) {
      invoke(['release', 'download', tag, '--pattern', asset, '--dir', scratch]);
      const bytes = decryptKeystore(JSON.parse(readFileSync(path.join(scratch, asset))), secret);
      if (mode === 'restore') {
        mkdirSync(path.dirname(filename), { recursive: true });
        writeFileSync(filename, bytes, { mode: 0o600 });
      } else if (!existsSync(filename) || !readFileSync(filename).equals(bytes)) throw new Error('Android signing identity changed; refusing to replace the original.');
      return { configured: true, restored: mode === 'restore' };
    }
    if (mode === 'restore') return { configured: true, restored: false };
    const encrypted = path.join(scratch, asset);
    writeFileSync(encrypted, JSON.stringify(encryptKeystore(readFileSync(filename), secret)), { mode: 0o600 });
    if (view.status === 0) invoke(['release', 'upload', tag, encrypted]);
    else invoke(['release', 'create', tag, encrypted, '--draft', '--title', 'Private Android signing state', '--notes', 'Encrypted APK signing identity. Keep this draft private and retain it across builds.']);
    return { configured: true, saved: true };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = maintainSigning({ mode: process.argv[2], secret: process.env.TAURI_SIGNING_PRIVATE_KEY, repository: process.env.GITHUB_REPOSITORY, filename: path.join(homedir(), '.android', 'debug.keystore') });
  console.log(!result.configured ? 'Android signing backup awaits updater signing configuration.' : result.restored || result.saved ? 'Android signing identity restored or preserved privately.' : 'Android signing backup checked; the current certificate will be preserved after the APK build.');
}
