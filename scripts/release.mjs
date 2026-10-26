import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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

export function publishRelease({ directory, metadata, repository, gh = defaultGh, resolveTag = resolveGitTag }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository');
  // All platforms must be present before the first network mutation.
  const feedPath = path.join(directory, 'latest.json');
  const includeFeed = existsSync(feedPath);
  if (includeFeed) {
    const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
    if (feed.source_sha !== metadata.sha || !feed.version?.startsWith(`${metadata.version}+build.`)) {
      throw new Error('Prepared update feed belongs to another source or application version.');
    }
  }
  const files = prepareArtifacts(directory, { includeFeed });
  const invoke = args => {
    const result = gh([...args, '--repo', repository]);
    if (result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || 'GitHub release operation failed');
    return result.stdout?.trim() || '';
  };
  const view = gh(['release', 'view', metadata.tag, '--repo', repository, '--json', 'isDraft,targetCommitish']);
  if (view.status === 0) {
    const existing = JSON.parse(view.stdout);
    if (!existing.isDraft) {
      if (resolveTag(metadata.tag) !== metadata.sha) throw new Error('Existing release belongs to another commit; use a new version tag');
      return { existing: true, url: `https://github.com/${repository}/releases/tag/${metadata.tag}` };
    }
    if (existing.targetCommitish !== metadata.sha && resolveTag(metadata.tag) !== metadata.sha) throw new Error('Existing draft belongs to another commit');
    invoke(['release', 'upload', metadata.tag, ...files, '--clobber']);
  } else {
    const error = `${view.stderr || ''} ${view.stdout || ''}`;
    if (!/release not found|HTTP 404|"status"\s*:\s*404/i.test(error)) throw new Error(error.trim() || 'Could not inspect existing release');
    const notes = path.join(directory, 'release-notes.md');
    writeFileSync(notes, [
      `Source: ${metadata.sha}`, '',
      metadata.prerelease ? 'Automatic development build. Device and live-network verification is still required.' : 'Version-tagged client build.', '',
      '- Windows x86_64: NSIS (.exe) and MSI installers, without a configured code-signing certificate.',
      '- Android ARM64: debug APK for device testing; this is not a Play Store signing release.',
      '- SHA256SUMS.txt contains checksums of the installers and APK.', '',
      'The client uses the real Hermes backend. Hardware metrics require the node collectors/workers to be running; missing metrics are displayed as unavailable.'
    ].join('\n'));
    invoke(['release', 'create', metadata.tag, ...files, '--draft', '--target', metadata.sha, '--title', metadata.title, '--notes-file', notes]);
  }
  const uploaded = JSON.parse(invoke(['release', 'view', metadata.tag, '--json', 'isDraft,assets']));
  if (uploaded.isDraft !== true) throw new Error(`Expected an unpublished draft for ${metadata.tag}; received isDraft=${JSON.stringify(uploaded.isDraft)}`);
  const remote = Array.isArray(uploaded.assets) ? uploaded.assets : [];
  const problems = [];
  for (const file of files) {
    const name = path.basename(file);
    const asset = remote.find(entry => entry.name === name);
    if (!asset) problems.push(`missing ${JSON.stringify(name)}`);
    else {
      if (asset.state !== 'uploaded') problems.push(`${JSON.stringify(name)} state=${JSON.stringify(asset.state)}`);
      const size = statSync(file).size;
      if (asset.size !== size) problems.push(`${JSON.stringify(name)} size=${JSON.stringify(asset.size)}, expected ${size}`);
    }
  }
  if (problems.length) {
    throw new Error(`Draft is incomplete; refusing to publish ${metadata.tag}. Problems: ${problems.join('; ')}. GitHub assets: ${JSON.stringify(remote.map(asset => ({ name: asset.name, state: asset.state, size: asset.size })))}`);
  }
  invoke(['release', 'edit', metadata.tag, '--draft=false', `--prerelease=${metadata.prerelease}`, `--latest=${!metadata.prerelease}`]);
  const published = JSON.parse(invoke(['release', 'view', metadata.tag, '--json', 'isDraft,isPrerelease,tagName,url']));
  if (published.isDraft || published.isPrerelease !== metadata.prerelease || published.tagName !== metadata.tag) throw new Error('Release publication could not be verified');
  return { existing: false, url: published.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const metadata = releaseMetadata(process.env, version);
  if (process.argv[2] === 'metadata') {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${metadata.tag}\nprerelease=${metadata.prerelease}\n`);
    console.log(`Planned ${metadata.prerelease ? 'prerelease' : 'release'}: ${metadata.tag} (${metadata.sha})`);
  } else if (process.argv[2] === 'publish') {
    const result = publishRelease({ directory: process.argv[3] || 'release-assets', metadata, repository: process.env.GITHUB_REPOSITORY });
    console.log(`${result.existing ? 'Already published' : 'Published'}: ${result.url}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Release: ${result.url}\n`);
  } else throw new Error('Usage: node scripts/release.mjs metadata|publish [artifact-directory]');
}
