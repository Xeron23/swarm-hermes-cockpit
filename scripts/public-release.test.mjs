import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishPublicRelease, createUpdateFeed, preparePublicUpdate, runPublicRelease } from './publish-public.mjs';
import { prepareArtifacts, publishRelease } from './release.mjs';
import { maintainSigning } from './android-signing.mjs';

function fixture(t, { signed = true, oldVersion, incomplete = false, privateRepo = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes-public-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ['Setup Windows.exe', 'Setup Windows.msi', 'android.apk']) {
    writeFileSync(path.join(directory, name), `fixture ${name}`);
    if (signed) writeFileSync(path.join(directory, `${name}.sig`), Buffer.from('untrusted comment: fixture\nfixture\ntrusted comment: timestamp:0\tfile:fixture\tversion:0.1.5+build.30.1\nfixture').toString('base64'));
  }
  const config = { repository: 'owner/public-releases', channelTag: 'updates' };
  const metadata = { version: '0.1.5', tag: 'build-30-abcdef-1', sha: 'a'.repeat(40), title: 'Fixture build', prerelease: true };
  const calls = [], releases = new Map();
  if (oldVersion) releases.set('updates', { isDraft: false, assets: [], feed: { version: oldVersion } });
  const gh = args => {
    calls.push(args);
    const ok = object => ({ status: 0, stdout: typeof object === 'string' ? object : JSON.stringify(object) });
    const missing = () => ({ status: 1, stderr: 'HTTP 404: release not found' });
    if (args[0] === 'repo') return ok({ isPrivate: privateRepo, defaultBranchRef: { name: 'public-main' } });
    const [ , command, tag ] = args;
    if (command === 'view') return releases.has(tag) ? ok(releases.get(tag)) : missing();
    if (command === 'download') {
      const release = releases.get(tag);
      if (!release?.feed) return missing();
      writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'latest.json'), JSON.stringify(release.feed));
      return ok('');
    }
    if (command === 'create' || command === 'upload') {
      const release = releases.get(tag) || { isDraft: true, assets: [], body: `Source: ${metadata.sha}`, tagName: tag, isPrerelease: metadata.prerelease, url: `https://github.com/${config.repository}/releases/tag/${tag}` };
      const end = args.findIndex((value, i) => i > 2 && value.startsWith('--'));
      for (const filename of args.slice(3, end < 0 ? args.length : end)) {
        const name = path.basename(filename);
        if (incomplete && name.endsWith('.apk.sig')) continue;
        release.assets = release.assets.filter(asset => asset.name !== name);
        release.assets.push({ name, size: statSync(filename).size, state: 'uploaded' });
        if (name === 'latest.json') release.feed = JSON.parse(readFileSync(filename));
      }
      releases.set(tag, release); return ok('');
    }
    if (command === 'edit') { releases.get(tag).isDraft = false; return ok(''); }
    throw new Error(`Unexpected mock command ${args}`);
  };
  const publish = () => publishPublicRelease({ directory, metadata, config, run: '30', attempt: '1', gh });
  return { directory, config, metadata, calls, releases, publish, gh };
}

test('public channel is promoted only after a complete immutable signed release', t => {
  const f = fixture(t); assert.deepEqual(f.publish(), { signed: true, promoted: true });
  const feed = f.releases.get('updates').feed;
  assert.equal(feed.version, '0.1.5+build.30.1');
  assert.equal(feed.source_sha, f.metadata.sha);
  assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64', 'windows-x86_64-nsis', 'windows-x86_64-msi', 'android-aarch64']);
  assert.match(feed.platforms['windows-x86_64'].url, /Setup-Windows.exe$/);
  const publish = f.calls.findIndex(args => args[1] === 'edit' && args[2] === f.metadata.tag);
  const channel = f.calls.findIndex(args => args[1] === 'create' && args[2] === 'updates');
  assert.ok(publish >= 0 && channel > publish);
  assert.ok(f.calls.filter(args => args[1] === 'create').every(args => args[args.indexOf('--target') + 1] === 'public-main'));
});

test('partial uploads never publish an update channel', t => {
  const f = fixture(t, { incomplete: true }); assert.throws(f.publish, /incomplete/);
  assert.equal(f.calls.some(args => args[1] === 'edit'), false);
  assert.equal(f.releases.has('updates'), false);
});

test('a rerun reuses the published immutable package/metadata pair', t => {
  const f = fixture(t); f.publish(); const before = f.calls.length;
  assert.deepEqual(f.publish(), { signed: true, promoted: false });
  assert.equal(f.calls.slice(before).some(args => ['create', 'upload', 'edit'].includes(args[1])), false);
});

test('a published release with a deleted installer cannot be promoted on rerun', t => {
  const f = fixture(t); f.publish();
  f.releases.get(f.metadata.tag).assets = f.releases.get(f.metadata.tag).assets.filter(asset => !asset.name.endsWith('.apk'));
  assert.throws(f.publish, /missing packages/);
});

test('older builds and reruns cannot downgrade or unnecessarily replace channel metadata', t => {
  for (const oldVersion of ['0.1.5+build.30.1', '0.1.5+build.31.1', '0.1.6+build.1.1']) {
    const f = fixture(t, { oldVersion }); assert.deepEqual(f.publish(), { signed: true, promoted: false });
    assert.equal(f.releases.get('updates').feed.version, oldVersion);
  }
});

test('unsigned bootstrap releases do not advertise an installable update', t => {
  const f = fixture(t, { signed: false }); assert.deepEqual(f.publish(), { signed: false });
  assert.equal(f.releases.has('updates'), false);
});

test('private targets and mismatched existing release commits are rejected', t => {
  const f = fixture(t, { privateRepo: true }); assert.throws(f.publish, /must be public/);
  const other = fixture(t); other.releases.set(other.metadata.tag, { isDraft: false, body: 'Source: another-commit' });
  assert.throws(other.publish, /another source commit/);
});

test('an unsigned version/build change cannot reuse another build signature', t => {
  const f = fixture(t); const files = prepareArtifacts(f.directory);
  assert.throws(() => createUpdateFeed({ files, metadata: f.metadata, repository: f.config.repository, run: 31, attempt: 1 }), /version\/build binding/);
  rmSync(path.join(f.directory, 'android.apk.sig'));
  assert.throws(() => prepareArtifacts(f.directory), /signatures are incomplete/);
});

test('Android signing backup refuses public storage and does not need API access when unconfigured', () => {
  assert.deepEqual(maintainSigning({ mode: 'restore' }), { configured: false });
  assert.throws(() => maintainSigning({ mode: 'save', secret: 'fixture', repository: 'owner/public', gh: () => ({ status: 0, stdout: '{"isPrivate":false}' }) }), /private source repository/);
});

function cliOptions(f, extra = {}) {
  return { args: ['prepare', f.directory], version: '0.1.5', config: f.config, log() {},
    env: { GITHUB_SHA: f.metadata.sha, GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '30',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: f.config.repository }, ...extra };
}

test('unsigned preparation removes a stale feed and returns bootstrap without a network call', t => {
  const f = fixture(t, { signed: false });
  writeFileSync(path.join(f.directory, 'latest.json'), '{"version":"stale"}');
  const result = preparePublicUpdate({ ...f, run: '30', attempt: '1' });
  assert.equal(result.signed, false);
  assert.equal(existsSync(path.join(f.directory, 'latest.json')), false);
  assert.equal(f.calls.length, 0);
});

test('a complete unsigned release still publishes installers and checksums without latest.json', t => {
  const f = fixture(t, { signed: false });
  preparePublicUpdate({ ...f, run: '30', attempt: '1' });
  assert.equal(publishRelease({ directory: f.directory, metadata: f.metadata,
    repository: f.config.repository, gh: f.gh }).existing, false);
  const assets = f.releases.get(f.metadata.tag).assets.map(asset => asset.name);
  for (const name of ['Setup-Windows.exe', 'Setup-Windows.msi', 'android.apk', 'SHA256SUMS.txt']) assert.ok(assets.includes(name));
  assert.equal(assets.includes('latest.json'), false);
  assert.equal(f.publish().signed, false);
  assert.equal(f.releases.has('updates'), false);
});

test('unsigned input cannot demote, overwrite or delete an existing signed update channel', t => {
  const f = fixture(t, { signed: false, oldVersion: '0.1.5+build.29.1' });
  const previous = JSON.stringify(f.releases.get('updates'));
  assert.equal(f.publish().signed, false);
  assert.equal(JSON.stringify(f.releases.get('updates')), previous);
});

test('partial or broken signing fails the prepare step explicitly', t => {
  const f = fixture(t);
  rmSync(path.join(f.directory, 'android.apk.sig'));
  assert.throws(() => preparePublicUpdate({ ...f, run: '30', attempt: '1' }), /Updater signatures are incomplete/);
  writeFileSync(path.join(f.directory, 'orphan.exe.sig'), 'dummy');
  assert.throws(() => preparePublicUpdate({ ...f, run: '30', attempt: '1' }), /no matching package/);
  const unsigned = fixture(t, { signed: false });
  assert.throws(() => preparePublicUpdate({ ...unsigned, run: '30', attempt: '1', requireSigned: true }),
    /complete signed packages are missing/);
});

test('CLI prepare emits GitHub Actions outputs for signed and bootstrap modes', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermes-cli-output-'));
  const output = path.join(dir, 'output.txt');
  const f = fixture(t);
  runPublicRelease(cliOptions(f, { env: { ...cliOptions(f).env, GITHUB_OUTPUT: output } }));
  assert.match(readFileSync(output, 'utf8'), /signed=true\nmode=signed/);
  const unsigned = fixture(t, { signed: false });
  rmSync(output);
  runPublicRelease(cliOptions(unsigned, { env: { ...cliOptions(unsigned).env, GITHUB_OUTPUT: output } }));
  assert.match(readFileSync(output, 'utf8'), /signed=false\nmode=bootstrap/);
  rmSync(dir, { recursive: true, force: true });
});

test('CLI promotion skips network mutation cleanly during bootstrap releases', t => {
  const f = fixture(t, { signed: false });
  const calls = [];
  const result = runPublicRelease({
    args: [f.directory], version: '0.1.5', config: f.config,
    env: { GITHUB_SHA: f.metadata.sha, GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '30',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: f.config.repository },
    publish: () => { calls.push('publish'); return { signed: false }; },
    log() {}
  });
  assert.equal(result.signed, false);
  assert.equal(calls.length, 0);
});
