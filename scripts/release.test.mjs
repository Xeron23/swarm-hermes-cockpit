import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareArtifacts, publishRelease, releaseMetadata } from './release.mjs';

const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '42', GITHUB_RUN_ATTEMPT: '1' };
const metadata = releaseMetadata(env, '0.1.1');
function artifacts(t, extensions = ['exe', 'msi', 'apk']) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const extension of extensions) writeFileSync(path.join(directory, `fixture.${extension}`), `fixture-${extension}`);
  return directory;
}
function uploadedAssets(directory, names = ['fixture.exe', 'fixture.msi', 'fixture.apk', 'SHA256SUMS.txt']) {
  return names.map(name => ({ name, state: 'uploaded', size: statSync(path.join(directory, name)).size }));
}
test('main pushes receive unique prerelease tags per run and rerun without overwriting a version release', () => {
  assert.equal(metadata.tag, 'build-42-aaaaaaaaaaaa-1');
  assert.equal(metadata.prerelease, true);
  assert.notEqual(releaseMetadata({ ...env, GITHUB_RUN_ATTEMPT: '2' }, '0.1.1').tag, metadata.tag);
  assert.notEqual(releaseMetadata({ ...env, GITHUB_SHA: 'b'.repeat(40) }, '0.1.1').tag, metadata.tag);
});
test('version tags must agree with application version and prerelease versions remain prereleases', () => {
  assert.equal(releaseMetadata({ ...env, GITHUB_REF: 'refs/tags/v0.1.1' }, '0.1.1').prerelease, false);
  assert.equal(releaseMetadata({ ...env, GITHUB_REF: 'refs/tags/v0.2.0-rc.1' }, '0.2.0-rc.1').prerelease, true);
  assert.throws(() => releaseMetadata({ ...env, GITHUB_REF: 'refs/tags/v0.2.0' }, '0.1.1'), /must match/);
});
test('missing or empty platform artifacts stop publication before GitHub is contacted', t => {
  const directory = artifacts(t, ['apk']);
  assert.throws(() => publishRelease({ directory, metadata, repository: 'owner/repo', gh: () => assert.fail('Must not contact GitHub') }), /Missing/);
  writeFileSync(path.join(directory, 'fixture.exe'), 'exe');
  writeFileSync(path.join(directory, 'fixture.msi'), '');
  assert.throws(() => prepareArtifacts(directory), /Empty/);
});
test('all verified artifacts are uploaded in a draft before a main prerelease is published', t => {
  const directory = artifacts(t);
  const calls = [];
  let draftExists = false;
  const gh = args => {
    calls.push(args);
    if (args[1] === 'view' && !draftExists) return { status: 1, stderr: 'release not found' };
    if (args[1] === 'create') { assert.ok(args.includes('--draft')); draftExists = true; return { status: 0 }; }
    if (args[1] === 'view' && args.includes('isDraft,assets')) return { status: 0, stdout: JSON.stringify({ isDraft: true, assets: uploadedAssets(directory) }) };
    if (args[1] === 'edit') { assert.ok(args.includes('--prerelease=true')); assert.ok(args.includes('--latest=false')); return { status: 0 }; }
    return { status: 0, stdout: JSON.stringify({ isDraft: false, isPrerelease: true, tagName: metadata.tag, url: 'https://github.com/owner/repo/releases/tag/build' }) };
  };
  assert.equal(publishRelease({ directory, metadata, repository: 'owner/repo', gh }).existing, false);
  assert.ok(calls.findIndex(args => args[1] === 'create') < calls.findIndex(args => args[1] === 'edit'));
  assert.match(readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), /^[a-f\d]{64}  fixture\.apk/m);
});
test('an incomplete uploaded draft is never made public', t => {
  const directory = artifacts(t);
  let views = 0;
  const gh = args => {
    if (args[1] === 'edit') assert.fail('Incomplete draft must stay private');
    if (args[1] === 'view') {
      views++;
      return views === 1 ? { status: 1, stderr: 'release not found' } : { status: 0, stdout: JSON.stringify({ isDraft: true, assets: uploadedAssets(directory, ['fixture.apk']) }) };
    }
    return { status: 0 };
  };
  assert.throws(() => publishRelease({ directory, metadata, repository: 'owner/repo', gh }), /incomplete/);
});
test('Windows installer names remain verifiable when GitHub normalizes spaces in uploaded filenames', t => {
  const directory = artifacts(t, []);
  const names = ['Hermes Cockpit_0.1.1_x64-setup.exe', 'Hermes Cockpit_0.1.1_x64_en-US.msi', 'hermes-cockpit-android-arm64-debug.apk'];
  for (const name of names) writeFileSync(path.join(directory, name), `fixture bytes for ${name}`);
  let uploaded;
  let published = false;
  const gh = args => {
    if (args[1] === 'view' && !uploaded) return { status: 1, stderr: 'release not found' };
    if (args[1] === 'create') {
      const files = args.slice(3, args.indexOf('--draft'));
      uploaded = files.map(file => ({ name: path.basename(file).replaceAll(' ', '.'), size: statSync(file).size, state: 'uploaded' }));
      return { status: 0 };
    }
    if (args[1] === 'view' && args.includes('isDraft,assets')) return { status: 0, stdout: JSON.stringify({ isDraft: true, assets: uploaded }) };
    if (args[1] === 'edit') { published = true; return { status: 0 }; }
    return { status: 0, stdout: JSON.stringify({ isDraft: false, isPrerelease: true, tagName: metadata.tag, url: 'https://github.com/owner/repo/releases/tag/build' }) };
  };
  publishRelease({ directory, metadata, repository: 'owner/repo', gh });
  assert.equal(published, true);
  const sums = readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
  for (const asset of uploaded.filter(asset => asset.name !== 'SHA256SUMS.txt')) assert.ok(sums.includes(`  ${asset.name}\n`), 'Checksums must use the downloadable asset name');
  for (const name of names) assert.equal(readFileSync(path.join(directory, name), 'utf8'), `fixture bytes for ${name}`, 'Original build files must stay unchanged');
  const repeated = prepareArtifacts(directory).map(file => path.basename(file));
  assert.deepEqual(repeated, uploaded.map(asset => asset.name), 'Preparing the same build again must keep the same downloadable names');
});
test('a GitHub access denial is not mistaken for a nonexistent release', t => {
  const directory = artifacts(t);
  let calls = 0;
  assert.throws(() => publishRelease({ directory, metadata, repository: 'owner/repo', gh: () => { calls++; return { status: 1, stderr: 'HTTP 403 Forbidden' }; } }), /403/);
  assert.equal(calls, 1);
});
test('normalization collisions are rejected before any GitHub request', t => {
  const directory = artifacts(t, ['msi', 'apk']);
  writeFileSync(path.join(directory, 'Hermes Cockpit.exe'), 'first installer');
  writeFileSync(path.join(directory, 'Hermes-Cockpit.exe'), 'different installer');
  assert.throws(() => publishRelease({ directory, metadata, repository: 'owner/repo', gh: () => assert.fail('Must not upload colliding artifacts') }), /filename collision/);
});
for (const defect of ['starter', 'size']) {
  test(`a ${defect} asset fails verification with its filename and is never published`, t => {
    const directory = artifacts(t);
    let draftExists = false;
    const gh = args => {
      if (args[1] === 'view' && !draftExists) return { status: 1, stderr: 'release not found' };
      if (args[1] === 'create') { draftExists = true; return { status: 0 }; }
      if (args[1] === 'edit') assert.fail('Incomplete upload must not be published');
      const assets = uploadedAssets(directory);
      if (defect === 'starter') assets[0].state = 'starter';
      else assets[0].size = 1;
      return { status: 0, stdout: JSON.stringify({ isDraft: true, assets }) };
    };
    assert.throws(() => publishRelease({ directory, metadata, repository: 'owner/repo', gh }), error => error.message.includes('fixture.exe') && error.message.includes(defect === 'starter' ? 'state="starter"' : 'expected'));
  });
}
test('an existing published version is left intact and its source commit is checked', t => {
  const directory = artifacts(t);
  const tagged = releaseMetadata({ ...env, GITHUB_REF: 'refs/tags/v0.1.1' }, '0.1.1');
  const gh = args => {
    assert.equal(args[1], 'view');
    return { status: 0, stdout: JSON.stringify({ isDraft: false }) };
  };
  assert.equal(publishRelease({ directory, metadata: tagged, repository: 'owner/repo', gh, resolveTag: () => env.GITHUB_SHA }).existing, true);
  assert.throws(() => publishRelease({ directory, metadata: tagged, repository: 'owner/repo', gh, resolveTag: () => 'b'.repeat(40) }), /another commit/);
});
