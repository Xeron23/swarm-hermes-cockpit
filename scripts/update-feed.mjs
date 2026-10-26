import { readFileSync } from 'node:fs';
import path from 'node:path';
import { valid } from 'semver';

export const updaterVersion = (version, run, attempt) => `${version.split('+')[0]}+build.${run}.${attempt}`;
const platforms = { 'windows-x86_64': '.exe', 'windows-x86_64-nsis': '.exe', 'windows-x86_64-msi': '.msi', 'android-aarch64': '.apk' };
export function signedVersion(signature) {
  if (typeof signature !== 'string' || signature.length > 16384) throw new Error('Invalid updater signature');
  const encoded = signature.trim();
  const bytes = Buffer.from(encoded, 'base64');
  if (!encoded || bytes.toString('base64') !== encoded) throw new Error('Invalid updater signature encoding');
  const comments = bytes.toString('utf8').split(/\r?\n/).filter(line => line.startsWith('trusted comment: '));
  const versions = comments.flatMap(line => line.slice(17).split('\t').filter(field => field.startsWith('version:')).map(field => field.slice(8)));
  if (versions.length !== 1 || !valid(versions[0])) throw new Error('Updater signature has no exact signed version');
  return versions[0];
}
export function validateUpdateFeed(feed, { metadata, repository, expectedVersion } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !valid(feed?.version) || feed.source_sha !== metadata.sha
    || feed.version.split('+')[0] !== metadata.version.split('+')[0] || expectedVersion && feed.version !== expectedVersion
    || typeof feed.notes !== 'string' || !Number.isFinite(Date.parse(feed.pub_date))) {
    throw new Error('Update feed identity/version is invalid');
  }
  const prefix = `https://github.com/${repository}/releases/download/${encodeURIComponent(metadata.tag)}/`;
  for (const [platform, extension] of Object.entries(platforms)) {
    const entry = feed.platforms?.[platform];
    const name = typeof entry?.url === 'string' && entry.url.startsWith(prefix) ? entry.url.slice(prefix.length) : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || !name.toLowerCase().endsWith(extension)
      || signedVersion(entry.signature) !== feed.version) throw new Error(`Invalid update package/version binding: ${platform}`);
  }
  if (feed.platforms['windows-x86_64'].url !== feed.platforms['windows-x86_64-nsis'].url) throw new Error('Windows NSIS aliases disagree');
  return feed;
}
export function createUpdateFeed({ files, metadata, repository, run, attempt, notes, date = new Date().toISOString() }) {
  const version = updaterVersion(metadata.version, run, attempt);
  const packages = files.filter(filename => /\.(exe|msi|apk)$/i.test(filename));
  const artifact = extension => {
    const matches = packages.filter(filename => filename.toLowerCase().endsWith(extension));
    if (matches.length !== 1) throw new Error(`Expected one ${extension} updater package`);
    const filename = matches[0];
    const signature = readFileSync(`${filename}.sig`, 'utf8').trim();
    if (signedVersion(signature) !== version) throw new Error('Updater signature is missing the exact version/build binding');
    return { url: `https://github.com/${repository}/releases/download/${encodeURIComponent(metadata.tag)}/${encodeURIComponent(path.basename(filename))}`, signature };
  };
  const nsis = artifact('.exe');
  return validateUpdateFeed({ version,
    notes: (notes?.trim() || `Hermes Cockpit ${metadata.version} · build ${run}\nSource: ${metadata.sha}`).slice(0, 32000),
    pub_date: date, source_sha: metadata.sha,
    platforms: { 'windows-x86_64': nsis, 'windows-x86_64-nsis': nsis, 'windows-x86_64-msi': artifact('.msi'), 'android-aarch64': artifact('.apk') }
  }, { metadata, repository, expectedVersion: version });
}
