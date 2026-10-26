import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preparePublicUpdate, runPublicRelease } from './publish-public.mjs';
import { releaseMetadata, publishRelease } from './release.mjs';
import { updaterVersion, validateUpdateFeed } from './update-feed.mjs';
import { verifyPublicRelease } from './verify-release-feed.mjs';
import { maintainSigning } from './android-signing.mjs';

const signature = version => Buffer.from(`untrusted comment: fixture\nfixture\ntrusted comment: timestamp:0\tfile:fixture\tversion:${version}\nfixture`).toString('base64');
function fixture(t, { signed = true, tagged = true, oldTag = 'v0.1.4', incomplete = false, privateRepo = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes-version-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { repository: 'owner/public', endpoints: ['https://github.com/owner/public/releases/latest/download/latest.json'] };
  const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: tagged ? 'refs/tags/v0.1.5' : 'refs/heads/main', GITHUB_RUN_NUMBER: '30', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: config.repository };
  const f = { directory, config, env, metadata: releaseMetadata(env, '0.1.5'), calls: [], releases: new Map(), latest: oldTag };
  f.sign = version => {
    for (const name of ['Setup Windows.exe', 'Setup Windows.msi', 'android.apk']) {
      writeFileSync(path.join(directory, name), `fixture ${name}`);
      if (signed) writeFileSync(path.join(directory, `${name}.sig`), signature(version));
    }
  };
  f.sign(f.metadata.updateVersion);
  f.prepare = extra => preparePublicUpdate({ directory, metadata: f.metadata, config, run: env.GITHUB_RUN_NUMBER, attempt: env.GITHUB_RUN_ATTEMPT, notes: 'User-visible changelog', ...extra });
  f.gh = args => {
    f.calls.push(args);
    const ok = object => ({ status: 0, stdout: typeof object === 'string' ? object : JSON.stringify(object) });
    const missing = () => ({ status: 1, stderr: 'HTTP 404: release not found' });
    if (args[0] === 'repo') return ok({ isPrivate: privateRepo });
    if (args[0] === 'api') return f.latest ? ok({ tag_name: f.latest, draft: false, prerelease: false }) : missing();
    const [, command, tag] = args;
    if (command === 'view') return f.releases.has(tag) ? ok(f.releases.get(tag)) : missing();
    if (command === 'download') {
      const release = f.releases.get(tag); if (!release) return missing();
      const dest = args[args.indexOf('--dir') + 1]; mkdirSync(dest, { recursive: true });
      for (const [name, bytes] of release.bytes) if (name === 'latest.json' || name === 'SHA256SUMS.txt' || name.endsWith('.sig')) writeFileSync(path.join(dest, name), bytes);
      return ok('');
    }
    if (command === 'create' || command === 'upload') {
      const release = f.releases.get(tag) || { isDraft: true, assets: [], bytes: new Map(), targetCommitish: f.metadata.sha, tagName: tag, url: `https://github.com/${config.repository}/releases/tag/${tag}` };
      const end = args.findIndex((value, i) => i > 2 && value.startsWith('--'));
      for (const file of args.slice(3, end)) {
        const name = path.basename(file);
        if (incomplete && name === 'latest.json') continue;
        release.bytes.set(name, readFileSync(file));
        release.assets = release.assets.filter(asset => asset.name !== name);
        release.assets.push({ name, state: 'uploaded', size: statSync(file).size });
      }
      f.releases.set(tag, release); return ok('');
    }
    if (command === 'edit') {
      const release = f.releases.get(tag); release.isDraft = false;
      release.isPrerelease = args.includes('--prerelease=true');
      if (args.includes('--latest=true')) f.latest = tag;
      return ok('');
    }
    throw new Error(`Unexpected GitHub operation: ${args}`);
  };
  f.publish = extra => publishRelease({ directory, metadata: f.metadata, repository: config.repository, gh: f.gh, resolveTag: () => env.GITHUB_SHA, ...extra });
  return f;
}

test('one complete signed version release contains every package, signature and feed before latest promotion', t => {
  const f = fixture(t); f.prepare(); const result = f.publish();
  assert.equal(result.latest, true); assert.equal(f.latest, 'v0.1.5'); assert.equal(f.releases.size, 1);
  const record = f.releases.get('v0.1.5');
  assert.equal(record.isPrerelease, false);
  assert.deepEqual(record.assets.map(a => a.name).sort(), ['Setup-Windows.exe', 'Setup-Windows.exe.sig', 'Setup-Windows.msi', 'Setup-Windows.msi.sig', 'android.apk', 'android.apk.sig', 'latest.json', 'SHA256SUMS.txt'].sort());
  const feed = JSON.parse(record.bytes.get('latest.json'));
  assert.equal(feed.version, '0.1.5+build.30.1'); assert.equal(feed.notes, 'User-visible changelog');
  assert.match(feed.platforms['android-aarch64'].url, /releases\/download\/v0.1.5\/android.apk$/);
  const edit = f.calls.findIndex(args => args[1] === 'edit');
  assert.ok(f.calls.slice(0, edit).some(args => args.includes('isDraft,assets')));
  assert.equal(f.calls.some(args => args[2] === 'updates'), false);
});

test('a missing uploaded manifest prevents publication and latest remains unchanged', t => {
  const f = fixture(t, { incomplete: true }); f.prepare();
  assert.throws(f.publish, /incomplete/); assert.equal(f.latest, 'v0.1.4');
  assert.equal(f.calls.some(args => args[1] === 'edit'), false);
});

test('signed main builds remain prereleases and never replace stable latest', t => {
  const f = fixture(t, { tagged: false }); f.prepare(); const result = f.publish();
  assert.equal(result.latest, false); assert.equal(f.releases.get(f.metadata.tag).isPrerelease, true); assert.equal(f.latest, 'v0.1.4');
});

test('unsigned tagged bootstrap remains publishable as a prerelease without disrupting the stable feed', t => {
  const f = fixture(t, { signed: false }); writeFileSync(path.join(f.directory, 'latest.json'), '{"stale":true}');
  assert.equal(f.prepare().signed, false); assert.equal(existsSync(path.join(f.directory, 'latest.json')), false);
  const result = f.publish(); assert.equal(result.signed, false); assert.equal(result.latest, false);
  assert.equal(f.releases.get(f.metadata.tag).isPrerelease, true); assert.equal(f.latest, 'v0.1.4');
});

test('required/partial/orphan signatures fail before publication', t => {
  const unsigned = fixture(t, { signed: false }); assert.throws(() => unsigned.prepare({ requireSigned: true }), /complete signed/);
  const f = fixture(t); rmSync(path.join(f.directory, 'android.apk.sig')); assert.throws(f.prepare, /incomplete/);
  writeFileSync(path.join(f.directory, 'orphan.exe.sig'), 'broken'); assert.throws(f.prepare, /no matching package/);
});

test('wrong version binding and foreign package URLs are rejected', t => {
  const f = fixture(t); f.sign('0.1.5+build.31.1'); assert.throws(f.prepare, /version\/build binding/);
  f.sign(f.metadata.updateVersion); const { feed } = f.prepare(); feed.platforms['android-aarch64'].url = 'https://github.com/other/repo/releases/download/v0.1.5/a.apk';
  assert.throws(() => validateUpdateFeed(feed, { metadata: f.metadata, repository: f.config.repository }), /Invalid update package/);
});

test('staged signatures must agree with prepared feed before the first GitHub request', t => {
  const f = fixture(t); f.prepare(); writeFileSync(path.join(f.directory, 'android.apk.sig'), signature('0.1.5+build.32.1'));
  assert.throws(f.publish, /staged package\/signature/); assert.equal(f.calls.length, 0);
});

test('an older stable tag may publish but cannot replace a newer stable release', t => {
  const f = fixture(t, { oldTag: 'v0.1.6' }); f.prepare();
  assert.equal(f.publish().latest, false); assert.equal(f.latest, 'v0.1.6');
});

test('published reruns reuse and verify immutable metadata without rewriting it', t => {
  const f = fixture(t); f.prepare(); f.publish();
  const bytes = Buffer.from(f.releases.get(f.metadata.tag).bytes.get('latest.json'));
  f.env.GITHUB_RUN_ATTEMPT = '2'; f.metadata = releaseMetadata(f.env, '0.1.5'); f.sign(f.metadata.updateVersion); f.prepare();
  const before = f.calls.length; const result = f.publish();
  assert.equal(result.existing, true); assert.equal(result.latest, true);
  assert.deepEqual(f.releases.get(f.metadata.tag).bytes.get('latest.json'), bytes);
  assert.equal(f.calls.slice(before).some(args => ['create', 'upload', 'edit'].includes(args[1])), false);
});

test('deleted remote installers or changed immutable checksums are not reported as successful reruns', t => {
  for (const corrupt of [false, true]) {
    const f = fixture(t); f.prepare(); f.publish(); const record = f.releases.get(f.metadata.tag);
    if (corrupt) record.bytes.set('latest.json', Buffer.from(JSON.stringify({ ...JSON.parse(record.bytes.get('latest.json')), notes: 'changed' })));
    else record.assets = record.assets.filter(asset => asset.name !== 'android.apk');
    assert.throws(f.publish, /incomplete|checksum mismatch/);
  }
});

test('private update repositories and GitHub authorization failures block publication', t => {
  const f = fixture(t, { privateRepo: true }); f.prepare(); assert.throws(f.publish, /must be public/);
  const g = fixture(t); g.prepare(); assert.throws(() => g.publish({ gh: () => ({ status: 1, stderr: 'HTTP 403' }) }), /403/);
});

test('a stale signed feed in an unsigned draft cannot be accidentally published', t => {
  const f = fixture(t, { signed: false }); f.prepare();
  f.releases.set(f.metadata.tag, { isDraft: true, targetCommitish: f.metadata.sha, assets: [{ name: 'latest.json' }] });
  assert.throws(f.publish, /stale update feed/);
});

test('CLI prepares without GH_TOKEN and removes the old channel-promotion command', t => {
  const f = fixture(t); const output = path.join(f.directory, 'github-output');
  runPublicRelease({ args: ['prepare', f.directory], env: { ...f.env, GITHUB_OUTPUT: output }, config: f.config, version: '0.1.5', log() {} });
  assert.match(readFileSync(output, 'utf8'), /signed=true\nmode=signed/);
  assert.throws(() => runPublicRelease({ args: [f.directory], env: f.env, config: f.config, version: '0.1.5' }), /Usage/);
  assert.equal(updaterVersion('0.1.5', '30', '1'), '0.1.5+build.30.1');
});

test('anonymous direct and latest checks retry propagation without sending credentials', async t => {
  const f = fixture(t); const { feed } = f.prepare(); let calls = 0, pauses = 0;
  const result = await verifyPublicRelease({ repository: f.config.repository, metadata: f.metadata, latest: true,
    pause: async () => { pauses++; }, fetcher: async (url, options) => {
      calls++; assert.equal(options.headers?.Authorization, undefined);
      return { ok: true, json: async () => calls === 1 ? { invalid: true } : feed };
    } });
  assert.equal(result.urls.length, 2); assert.equal(calls, 3); assert.equal(pauses, 1);
});

test('anonymous feed 404 remains a failing verification for a claimed signed release', async t => {
  const f = fixture(t); await assert.rejects(verifyPublicRelease({ repository: f.config.repository, metadata: f.metadata, attempts: 1,
    fetcher: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
});

test('Android signing backup remains private and separate from public release assets', () => {
  assert.deepEqual(maintainSigning({ mode: 'restore' }), { configured: false });
  assert.throws(() => maintainSigning({ mode: 'save', secret: 'fixture', repository: 'owner/public', gh: () => ({ status: 0, stdout: '{"isPrivate":false}' }) }), /private source repository/);
});
