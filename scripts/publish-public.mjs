// Prepare metadata only. scripts/release.mjs is the sole GitHub publisher.
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareArtifacts, releaseMetadata } from './release.mjs';
import { createUpdateFeed } from './update-feed.mjs';
export { createUpdateFeed, updaterVersion } from './update-feed.mjs';

export function preparePublicUpdate({ directory, metadata, config, run, attempt, requireSigned = false, notes } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository || '')
    || JSON.stringify(config.endpoints) !== JSON.stringify([`https://github.com/${config.repository}/releases/latest/download/latest.json`])) {
    throw new Error('Updater configuration must use the same version-release latest endpoint');
  }
  const filename = path.join(directory, 'latest.json');
  rmSync(filename, { force: true });
  const orphan = readdirSync(directory).find(name => /\.(exe|msi|apk)\.sig$/i.test(name) && !existsSync(path.join(directory, name.slice(0, -4))));
  if (orphan) throw new Error(`Updater signature has no matching package: ${orphan}`);
  const files = prepareArtifacts(directory);
  const packages = files.filter(file => /\.(exe|msi|apk)$/i.test(file));
  const signed = packages.every(file => files.includes(`${file}.sig`));
  if (!signed) {
    if (requireSigned) throw new Error('Signing was enabled for this run, but complete signed packages are missing.');
    return { signed: false, reason: 'signing_not_configured' };
  }
  const feed = createUpdateFeed({ files, metadata, repository: config.repository, run, attempt, notes });
  writeFileSync(filename, JSON.stringify(feed, null, 2) + '\n');
  return { signed: true, feed };
}

export function runPublicRelease({ args = process.argv.slice(2), env = process.env,
  version = JSON.parse(readFileSync('package.json', 'utf8')).version,
  config = JSON.parse(readFileSync('src-tauri/updater.json', 'utf8')),
  prepare = preparePublicUpdate, log = console.log } = {}) {
  if (args[0] !== 'prepare') throw new Error('Usage: node scripts/publish-public.mjs prepare [artifact-directory]; publish with scripts/release.mjs');
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== config.repository) throw new Error('Release repository differs from updater configuration');
  const result = prepare({ directory: args[1] || 'release-assets', metadata: releaseMetadata(env, version), config,
    run: env.GITHUB_RUN_NUMBER, attempt: env.GITHUB_RUN_ATTEMPT, requireSigned: env.HERMES_UPDATER_SIGNING_REQUIRED === 'true',
    notes: existsSync('RELEASE_NOTES.md') ? readFileSync('RELEASE_NOTES.md', 'utf8') : undefined });
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `signed=${result.signed}\nmode=${result.signed ? 'signed' : 'bootstrap'}\n`);
  log(result.signed ? 'Prepared latest.json for the same immutable version release.' : 'Bootstrap installers: no feed, no stable latest promotion.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPublicRelease();
