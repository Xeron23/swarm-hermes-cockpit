import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { compareBuild, valid } from 'semver';
import { prepareArtifacts, releaseMetadata } from './release.mjs';

export const updaterVersion = (version, run, attempt) => `${version.split('+')[0]}+build.${run}.${attempt}`;
const missing = result => /HTTP 404|not found|no assets match/i.test(`${result.stderr || ''} ${result.stdout || ''}`);

export function createUpdateFeed({ files, metadata, repository, run, attempt, date = new Date().toISOString() }) {
  const packages = files.filter(filename => /\.(exe|msi|apk)$/i.test(filename));
  const version = updaterVersion(metadata.version, run, attempt);
  if (!valid(version)) throw new Error('Invalid updater version');
  const artifact = extension => {
    const matches = packages.filter(filename => filename.toLowerCase().endsWith(extension));
    if (matches.length !== 1) throw new Error(`Expected one ${extension} updater package`);
    const filename = matches[0];
    const signature = readFileSync(`${filename}.sig`, 'utf8').trim();
    const text = Buffer.from(signature, 'base64').toString('utf8');
    const signedVersion = text.split(/\r?\n/).find(line => line.startsWith('trusted comment: '))?.slice(17).split('\t').find(field => field.startsWith('version:'))?.slice(8);
    if (signedVersion !== version) throw new Error('Updater signature is missing the exact version/build binding');
    return { url: `https://github.com/${repository}/releases/download/${encodeURIComponent(metadata.tag)}/${encodeURIComponent(path.basename(filename))}`, signature };
  };
  const nsis = artifact('.exe');
  return {
    version, notes: `Hermes Cockpit ${metadata.version} · build ${run}\nSource: ${metadata.sha}`,
    pub_date: date, source_sha: metadata.sha,
    platforms: { 'windows-x86_64': nsis, 'windows-x86_64-nsis': nsis, 'windows-x86_64-msi': artifact('.msi'), 'android-aarch64': artifact('.apk') }
  };
}

export function selectReleaseToken(env, repository) {
  const sameRepository = env.GITHUB_REPOSITORY?.toLowerCase() === repository.toLowerCase();
  const token = sameRepository
    ? env.GH_TOKEN || env.GITHUB_TOKEN
    : env.PUBLIC_RELEASE_TOKEN;
  if (!token) throw new Error(sameRepository
    ? 'Missing GH_TOKEN/GITHUB_TOKEN for same-repository update publication.'
    : 'Missing PUBLIC_RELEASE_TOKEN for cross-repository update publication.');
  return token;
}

function updateInputs({ directory, requireSigned = false }) {
  // prepareArtifacts still rejects missing platforms, empty files and partial signatures.
  const orphan = readdirSync(directory).find(name => /\.(exe|msi|apk)\.sig$/i.test(name)
    && !existsSync(path.join(directory, name.slice(0, -4))));
  if (orphan) throw new Error(`Updater signature has no matching package: ${orphan}`);
  const files = prepareArtifacts(directory);
  const packages = files.filter(filename => /\.(exe|msi|apk)$/i.test(filename));
  const signed = packages.length > 0 && packages.every(filename => files.includes(`${filename}.sig`));
  if (requireSigned && !signed) {
    throw new Error('Signing was enabled for this run, but complete signed packages are missing.');
  }
  return { files, signed };
}

export function preparePublicUpdate(options) {
  const { directory, metadata, config, run, attempt } = options;
  // Never let an old feed turn an unsigned version release into an advertised update.
  const filename = path.join(directory, 'latest.json');
  rmSync(filename, { force: true });
  const { files, signed } = updateInputs(options);
  if (!signed) return { signed: false, reason: 'signing_not_configured' };
  const feed = createUpdateFeed({ files, metadata, repository: config.repository, run, attempt });
  writeFileSync(filename, JSON.stringify(feed, null, 2) + '\n');
  return { signed: true, feed };
}

export function publishPublicRelease({ directory, metadata, config, run, attempt, requireSigned = false, gh = args => spawnSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: selectReleaseToken(process.env, config.repository) } }) }) {
  const repository = config.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || config.channelTag !== 'updates') throw new Error('Invalid public updater repository/channel');
  const inputs = updateInputs({ directory, requireSigned });
  let files = inputs.files;
  const signed = inputs.signed;
  if (!signed) return { signed: false };
  let feed = signed ? createUpdateFeed({ files, metadata, repository, run, attempt }) : null;
  const invoke = args => {
    const result = gh(args);
    if (result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || 'Public release operation failed');
    return result.stdout?.trim() || '';
  };
  const repo = JSON.parse(invoke(['repo', 'view', repository, '--json', 'isPrivate,defaultBranchRef']));
  if (repo.isPrivate !== false) throw new Error('The updater distribution repository must be public.');
  if (!repo.defaultBranchRef?.name) throw new Error('Initialize the public release repository with a README first.');
  const release = args => invoke(['release', ...args, '--repo', repository]);
  const view = gh(['release', 'view', metadata.tag, '--repo', repository, '--json', 'isDraft,body,assets']);
  const scratch = mkdtempSync(path.join(tmpdir(), 'hermes-public-release-'));
  try {
    if (view.status === 0 && !JSON.parse(view.stdout).body?.includes(`Source: ${metadata.sha}`)) throw new Error('Existing public release belongs to another source commit.');
    if (view.status === 0 && !JSON.parse(view.stdout).isDraft) {
      // A rerun must reuse the already published package/signature pair.
      const existing = JSON.parse(view.stdout);
      if (!files.every(filename => existing.assets?.some(asset => asset.name === path.basename(filename) && asset.state === 'uploaded' && asset.size > 0))) throw new Error('Published public release is missing packages; refusing to promote it.');
      if (signed) {
        release(['download', metadata.tag, '--pattern', 'latest.json', '--dir', scratch, '--clobber']);
        feed = JSON.parse(readFileSync(path.join(scratch, 'latest.json'), 'utf8'));
        if (feed.source_sha !== metadata.sha || feed.version !== updaterVersion(metadata.version, run, attempt)) throw new Error('Existing updater feed belongs to another source commit or build.');
      }
    } else {
      if (view.status !== 0 && !missing(view)) throw new Error(view.stderr || 'Cannot inspect public release');
      if (feed) {
        const filename = path.join(directory, 'latest.json');
        writeFileSync(filename, JSON.stringify(feed, null, 2) + '\n');
        files = [...files, filename];
        const checksums = files.filter(name => path.basename(name) !== 'SHA256SUMS.txt').map(filename => `${createHash('sha256').update(readFileSync(filename)).digest('hex')}  ${path.basename(filename)}\n`).join('');
        writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums);
      }
      if (view.status === 0) release(['upload', metadata.tag, ...files, '--clobber']);
      else {
        const notes = path.join(scratch, 'notes.md');
        writeFileSync(notes, `Source: ${metadata.sha}\n\nHermes Cockpit ${metadata.version}. Application source remains private.\n${feed ? 'Signed in-app updates are available for Windows and Android.' : 'Bootstrap installers. The update channel will be enabled once signing is configured.'}\n`);
        release(['create', metadata.tag, ...files, '--draft', '--target', repo.defaultBranchRef.name, '--title', metadata.title, '--notes-file', notes]);
      }
      const uploaded = JSON.parse(release(['view', metadata.tag, '--json', 'isDraft,assets']));
      if (!uploaded.isDraft || !files.every(filename => uploaded.assets?.some(asset => asset.name === path.basename(filename) && asset.state === 'uploaded' && asset.size === statSync(filename).size))) throw new Error('Public draft is incomplete; refusing to publish.');
      release(['edit', metadata.tag, '--draft=false', `--prerelease=${metadata.prerelease}`, `--latest=${!metadata.prerelease}`]);
    }
    if (!feed) return { signed: false };
    const channel = gh(['release', 'view', config.channelTag, '--repo', repository, '--json', 'isDraft']);
    if (channel.status !== 0 && !missing(channel)) throw new Error(channel.stderr || 'Cannot inspect updater channel');
    if (channel.status === 0) {
      const old = gh(['release', 'download', config.channelTag, '--repo', repository, '--pattern', 'latest.json', '--dir', scratch, '--clobber']);
      if (old.status !== 0 && !missing(old)) throw new Error(old.stderr || 'Cannot read updater channel');
      if (old.status === 0) {
        const previous = JSON.parse(readFileSync(path.join(scratch, 'latest.json'), 'utf8'));
        if (!valid(previous.version)) throw new Error('Existing updater channel has an invalid version.');
        if (compareBuild(feed.version, previous.version) <= 0) return { signed: true, promoted: false };
      }
    } else release(['create', config.channelTag, '--draft', '--target', repo.defaultBranchRef.name, '--title', 'Hermes Cockpit update channel', '--notes', 'Signed update metadata. Installers are stored in versioned releases.']);
    const filename = path.join(scratch, 'latest.json');
    writeFileSync(filename, JSON.stringify(feed, null, 2) + '\n');
    release(['upload', config.channelTag, filename, '--clobber']);
    const uploaded = JSON.parse(release(['view', config.channelTag, '--json', 'assets']));
    if (!uploaded.assets?.some(asset => asset.name === 'latest.json' && asset.state === 'uploaded' && asset.size === statSync(filename).size)) throw new Error('Updater channel upload is incomplete.');
    release(['edit', config.channelTag, '--draft=false', '--prerelease=true', '--latest=false']);
    return { signed: true, promoted: true };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function runPublicRelease({ args = process.argv.slice(2), env = process.env,
  version = JSON.parse(readFileSync('package.json', 'utf8')).version,
  config = JSON.parse(readFileSync('src-tauri/updater.json', 'utf8')),
  publish = publishPublicRelease, prepare = preparePublicUpdate, log = console.log } = {}) {
  const preparing = args[0] === 'prepare';
  const options = {
    directory: args[preparing ? 1 : 0] || 'release-assets',
    metadata: releaseMetadata(env, version), config,
    run: env.GITHUB_RUN_NUMBER, attempt: env.GITHUB_RUN_ATTEMPT,
    requireSigned: env.HERMES_UPDATER_SIGNING_REQUIRED === 'true'
  };
  if (preparing) {
    const result = prepare(options);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `signed=${result.signed}\nmode=${result.signed ? 'signed' : 'bootstrap'}\n`);
    log(result.signed ? 'Prepared signed latest.json before version release publication.'
      : 'Bootstrap release: no updater signatures; installer publication continues without a feed.');
    return result;
  }
  if (!updateInputs(options).signed) {
    log('Bootstrap release: update channel promotion skipped; existing channel is unchanged.');
    return { signed: false };
  }
  const token = selectReleaseToken(env, config.repository);
  const gh = args => spawnSync('gh', args, { encoding: 'utf8', env: { ...env, GH_TOKEN: token } });
  const result = publish({ ...options, gh });
  if (!result.signed) throw new Error('No signed update feed was published.');
  log(`Signed update channel: ${result.promoted ? 'promoted' : 'already current'}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPublicRelease();
