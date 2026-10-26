import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gt, valid } from 'semver';
import { updaterVersion, validateUpdateFeed } from './update-feed.mjs';

export function releaseMetadata(env, version) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)) throw new Error('Invalid package version');
  if (!/^[a-f\d]{40}$/i.test(env.GITHUB_SHA || '')) throw new Error('Missing source commit');
  const isTag = (env.GITHUB_REF || '').startsWith('refs/tags/');
  const tag = isTag ? env.GITHUB_REF.slice('refs/tags/'.length) : null;
  if (isTag && tag !== `v${version}`) throw new Error(`Version tag must match package.json: v${version}`);
  for (const key of ['GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT']) if (!/^\d+$/.test(env[key] || '')) throw new Error(`Missing ${key}`);
  return {
    tag: tag || `build-${env.GITHUB_RUN_NUMBER}-${env.GITHUB_SHA.slice(0, 12)}-${env.GITHUB_RUN_ATTEMPT}`,
    title: isTag ? `Hermes Cockpit ${version}` : `Hermes Cockpit ${version} · build ${env.GITHUB_RUN_NUMBER}`,
    prerelease: !isTag || version.includes('-'),
    sha: env.GITHUB_SHA,
    updateVersion: updaterVersion(version, env.GITHUB_RUN_NUMBER, env.GITHUB_RUN_ATTEMPT),
    version
  };
}

export function prepareArtifacts(directory, { includeFeed = false } = {}) {
  const primary = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(msi|exe|apk)$/i.test(entry.name)).map(entry => entry.name).sort();
  const signatures = primary.map(name => `${name}.sig`).filter(name => { try { return statSync(path.join(directory, name)).isFile(); } catch { return false; } });
  if (signatures.length && signatures.length !== primary.length) throw new Error('Updater signatures are incomplete; every installer and APK must be signed together.');
  const names = [...primary, ...signatures];
  for (const extension of ['.msi', '.exe', '.apk']) {
    if (!names.some(name => name.toLowerCase().endsWith(extension))) throw new Error(`Missing required release artifact: ${extension}`);
  }
  const seen = new Map();
  const assets = names.map(original => {
    if (!statSync(path.join(directory, original)).size) throw new Error(`Empty artifact: ${original}`);
    // GitHub may rename spaces/special characters during upload, and gh treats
    // '#' as a label separator. Stage safe names BEFORE checksumming/uploading.
    const name = original.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(msi|exe|apk)(?:\.sig)?$/i.test(name)) throw new Error(`Invalid artifact filename: ${original}`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Artifact filename collision after normalization: ${seen.get(key)} and ${original}`);
    seen.set(key, original);
    return { original, name };
  });
  for (const extension of ['.exe', '.msi', '.apk']) {
    if (primary.filter(name => name.toLowerCase().endsWith(extension)).length !== 1) throw new Error(`Expected exactly one ${extension} artifact`);
  }
  const staging = mkdtempSync(path.join(directory, '.publish-'));
  const files = assets.map(({ original, name }) => {
    const file = path.join(staging, name);
    copyFileSync(path.join(directory, original), file);
    return file;
  });
  if (includeFeed) files.push(path.join(directory, 'latest.json'));
  const sums = files.map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${path.basename(file)}\n`).join('');
  writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums);
  return [...files, path.join(directory, 'SHA256SUMS.txt')];
}

const defaultGh = args => spawnSync('gh', args, { encoding: 'utf8' });
const resolveGitTag = tag => {
  const result = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot verify the source commit of an existing release tag');
  return result.stdout.trim();
};

function checksumEntries(text) {
  const entries = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f\d]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (!match || entries.has(match[2])) throw new Error('Published checksums are invalid');
    entries.set(match[2], match[1]);
  }
  return entries;
}
function completeAssets(files, remote, exactSize = true) {
  const problems = [];
  for (const file of files) {
    const name = path.basename(file), asset = remote.find(entry => entry.name === name);
    if (!asset) problems.push(`missing ${JSON.stringify(name)}`);
    else if (asset.state !== 'uploaded') problems.push(`${JSON.stringify(name)} state=${JSON.stringify(asset.state)}`);
    else if (!asset.size || exactSize && asset.size !== statSync(file).size) problems.push(`${JSON.stringify(name)} size=${asset.size}, expected ${statSync(file).size}`);
  }
  if (problems.length) throw new Error(`Release is incomplete; refusing publication: ${problems.join('; ')}`);
}

export function publishRelease({ directory, metadata, repository, requireSigned = false, gh = defaultGh, resolveTag = resolveGitTag }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository');
  const includeFeed = existsSync(path.join(directory, 'latest.json'));
  if (requireSigned && !includeFeed) throw new Error('Signed release is missing prepared latest.json');
  const files = prepareArtifacts(directory, { includeFeed });
  const packages = files.filter(file => /\.(exe|msi|apk)$/i.test(file));
  if (!includeFeed && files.some(file => file.endsWith('.sig'))) throw new Error('Signed packages require prepared latest.json');
  if (includeFeed) {
    const feed = validateUpdateFeed(JSON.parse(readFileSync(path.join(directory, 'latest.json'), 'utf8')),
      { metadata, repository, expectedVersion: metadata.updateVersion });
    for (const entry of Object.values(feed.platforms)) {
      const filename = packages.find(file => path.basename(file) === entry.url.split('/').at(-1));
      if (!filename || !existsSync(`${filename}.sig`) || readFileSync(`${filename}.sig`, 'utf8').trim() !== entry.signature) {
        throw new Error('Prepared feed does not match the staged package/signature pair');
      }
    }
  }
  const invoke = args => {
    const result = gh(args);
    if (result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || 'GitHub release operation failed');
    return result.stdout?.trim() || '';
  };
  const release = args => invoke(['release', ...args, '--repo', repository]);
  const notFound = result => /release not found|HTTP 404|"status"\s*:\s*404/i.test(`${result.stderr || ''} ${result.stdout || ''}`);
  let latest = null;
  const stable = !metadata.prerelease && includeFeed;
  if (includeFeed) {
    if (JSON.parse(invoke(['repo', 'view', repository, '--json', 'isPrivate'])).isPrivate !== false) throw new Error('Updater release repository must be public');
    if (stable) {
      const current = gh(['api', `repos/${repository}/releases/latest`]);
      if (current.status === 0) {
        latest = JSON.parse(current.stdout);
        if (latest.draft || latest.prerelease || !latest.tag_name?.startsWith('v') || !valid(latest.tag_name.slice(1))) throw new Error('Latest stable release identity is invalid');
      } else if (!notFound(current)) throw new Error(current.stderr || 'Cannot inspect latest release');
    }
  }
  const view = gh(['release', 'view', metadata.tag, '--repo', repository, '--json', 'isDraft,targetCommitish,assets']);
  if (view.status === 0) {
    const existing = JSON.parse(view.stdout);
    if (!existing.isDraft) {
      if (resolveTag(metadata.tag) !== metadata.sha) throw new Error('Existing release belongs to another commit; use a new version tag');
      completeAssets(files, existing.assets || [], false);
      if (includeFeed) {
        // Rebuilds can differ. Reuse and validate the published immutable pair,
        // never replace its feed with this run's new build number/signatures.
        const scratch = mkdtempSync(path.join(directory, '.published-'));
        try {
          release(['download', metadata.tag, '--pattern', 'latest.json', '--pattern', 'SHA256SUMS.txt', '--pattern', '*.sig', '--dir', scratch]);
          const feed = validateUpdateFeed(JSON.parse(readFileSync(path.join(scratch, 'latest.json'), 'utf8')), { metadata, repository });
          const sums = checksumEntries(readFileSync(path.join(scratch, 'SHA256SUMS.txt'), 'utf8'));
          const expected = files.filter(file => path.basename(file) !== 'SHA256SUMS.txt').map(file => path.basename(file));
          if (sums.size !== expected.length || expected.some(name => !sums.has(name))) throw new Error('Published checksums omit required release files');
          for (const name of ['latest.json', ...expected.filter(name => name.endsWith('.sig'))]) {
            if (createHash('sha256').update(readFileSync(path.join(scratch, name))).digest('hex') !== sums.get(name)) throw new Error('Published metadata/checksum mismatch');
          }
          for (const entry of Object.values(feed.platforms)) {
            const name = entry.url.split('/').at(-1);
            if (!expected.includes(name) || !expected.includes(name + '.sig')) throw new Error('Published feed points outside its immutable package set');
            if (readFileSync(path.join(scratch, entry.url.split('/').at(-1) + '.sig'), 'utf8').trim() !== entry.signature) throw new Error('Published signature/feed mismatch');
          }
        } finally { rmSync(scratch, { recursive: true, force: true }); }
      }
      return { existing: true, signed: includeFeed, latest: latest?.tag_name === metadata.tag, url: `https://github.com/${repository}/releases/tag/${metadata.tag}` };
    }
    if (existing.targetCommitish !== metadata.sha && resolveTag(metadata.tag) !== metadata.sha) throw new Error('Existing draft belongs to another commit');
    if (!includeFeed && existing.assets?.some(asset => asset.name === 'latest.json')) throw new Error('Unsigned draft contains a stale update feed; do not publish it');
    release(['upload', metadata.tag, ...files, '--clobber']);
  } else {
    if (!notFound(view)) throw new Error(view.stderr || 'Could not inspect existing release');
    const notes = path.join(directory, 'release-notes.md');
    const changelog = includeFeed ? JSON.parse(readFileSync(path.join(directory, 'latest.json'), 'utf8')).notes : '';
    writeFileSync(notes, [`Source: ${metadata.sha}`, '', changelog || `Hermes Cockpit ${metadata.version}`, '',
      includeFeed ? 'Signed in-app update packages for Windows x86_64 and Android ARM64.' : 'Bootstrap installers: updater signing is not configured. This release is a prerelease and does not replace the stable updater feed.',
      'Android APK uses the existing Hermes debug signing identity; Minisign updater signing does not convert it into a Play Store release.',
      'Windows installers do not have an Authenticode certificate unless separately configured. SHA256SUMS.txt covers all release assets.'
    ].join('\n'));
    release(['create', metadata.tag, ...files, '--draft', '--target', metadata.sha, '--title', metadata.title, '--notes-file', notes]);
  }
  const uploaded = JSON.parse(release(['view', metadata.tag, '--json', 'isDraft,assets']));
  if (uploaded.isDraft !== true) throw new Error('Expected an unpublished draft');
  completeAssets(files, uploaded.assets || []);
  if (!includeFeed && uploaded.assets?.some(asset => asset.name === 'latest.json')) throw new Error('Unsigned draft contains a stale update feed');
  const promote = stable && (!latest || gt(metadata.version, latest.tag_name.slice(1)));
  const prerelease = metadata.prerelease || !includeFeed;
  release(['edit', metadata.tag, '--draft=false', `--prerelease=${prerelease}`, `--latest=${Boolean(promote)}`]);
  const published = JSON.parse(release(['view', metadata.tag, '--json', 'isDraft,isPrerelease,tagName,url']));
  if (published.isDraft || published.isPrerelease !== prerelease || published.tagName !== metadata.tag) throw new Error('Release publication could not be verified');
  return { existing: false, signed: includeFeed, latest: Boolean(promote), url: published.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const metadata = releaseMetadata(process.env, version);
  if (process.argv[2] === 'metadata') {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${metadata.tag}\nprerelease=${metadata.prerelease}\n`);
    console.log(`Planned ${metadata.prerelease ? 'prerelease' : 'release'}: ${metadata.tag} (${metadata.sha})`);
  } else if (process.argv[2] === 'publish') {
    const result = publishRelease({ directory: process.argv[3] || 'release-assets', metadata, repository: process.env.GITHUB_REPOSITORY,
      requireSigned: process.env.HERMES_UPDATER_SIGNING_REQUIRED === 'true' });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `latest=${result.latest}\nsigned=${result.signed}\n`);
    console.log(`${result.existing ? 'Already published' : 'Published'}: ${result.url}; stable latest=${result.latest}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release: ${result.url} · stable latest: ${result.latest}\n`);
  } else throw new Error('Usage: node scripts/release.mjs metadata|publish [artifact-directory]');
}
