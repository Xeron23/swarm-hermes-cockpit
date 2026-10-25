import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findManifestTool, hasCommonControlsV6, testWindowsNative } from './test-windows-native.mjs';

const manifestSource = fileURLToPath(new URL('../src-tauri/windows-test.manifest', import.meta.url));
function fixture(t, { buildStatus = 0, embedStatus = 0, testsStatus = 0, validExtraction = true, artifacts = true } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'hermes windows ci '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, 'src-tauri'));
  copyFileSync(manifestSource, path.join(cwd, 'src-tauri/windows-test.manifest'));
  const executable = path.join(cwd, 'native unit tests.exe');
  writeFileSync(executable, 'fixture executable');
  const mt = path.join(cwd, 'Windows SDK/mt.exe');
  // This is the target.kind emitted by this Tauri crate, not just ["lib"].
  const artifact = { reason: 'compiler-artifact', profile: { test: true }, target: { kind: ['staticlib', 'cdylib', 'rlib'] }, executable };
  const calls = [], logs = [];
  const env = { HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' };
  const run = (command, args, options) => {
    assert.equal(options.env, env);
    calls.push({ command, args });
    if (command === 'cargo') {
      assert.ok(args.includes('--no-run'));
      assert.ok(args.includes('--offline') && args.includes('--locked'));
      return { status: buildStatus, stdout: [
        JSON.stringify({ ...artifact, profile: { test: false }, executable: 'application.exe' }),
        JSON.stringify({ ...artifact, target: { kind: ['bin'] }, executable: 'other.exe' }),
        ...(artifacts ? [JSON.stringify(artifact), JSON.stringify(artifact)] : [])
      ].join('\n') };
    }
    if (command === mt) {
      if (args.includes('-validate_manifest')) return { status: 0 };
      if (args.includes(`-outputresource:${executable};#1`)) return { status: embedStatus };
      assert.ok(args.includes(`-inputresource:${executable};#1`));
      const output = args.find(value => value.startsWith('-out:')).slice(5);
      const source = readFileSync(manifestSource, 'utf8');
      writeFileSync(output, validExtraction ? source : source.replace('version="6.0.0.0"', 'version="5.0.0.0"'));
      return { status: 0 };
    }
    assert.equal(command, executable);
    assert.deepEqual(args, ['--nocapture']);
    assert.ok(calls.some(call => call.args.includes(`-inputresource:${executable};#1`)), 'Verify the embedded manifest before starting the EXE');
    return { status: testsStatus };
  };
  return { cwd, mt, executable, calls, logs, execute: () => testWindowsNative({ cwd, env, run, manifestTool: mt, log: value => logs.push(value) }) };
}

test('native unit test EXEs receive and verify Common Controls v6 before execution, including paths with spaces', t => {
  const f = fixture(t);
  f.execute();
  assert.equal(f.calls.filter(call => call.command === f.executable).length, 1, 'Duplicate Cargo artifact events must not run tests twice');
  assert.equal(f.calls.length, 5);
  assert.match(f.logs.join(''), /Common Controls v6/);
});
test('native test compilation failures stop before patching or executing an EXE', t => {
  const f = fixture(t, { buildStatus: 101 });
  assert.throws(f.execute, /compilation failed/);
  assert.equal(f.calls.length, 1);
});
test('missing Cargo library test artifacts are never treated as successful validation', t => {
  const f = fixture(t, { artifacts: false });
  assert.throws(f.execute, /did not produce/);
  assert.equal(f.calls.length, 1);
});
test('a failed manifest embedding stops native test execution', t => {
  const f = fixture(t, { embedStatus: 1 });
  assert.throws(f.execute, /Could not embed/);
  assert.equal(f.calls.filter(call => call.command === f.executable).length, 0);
});
test('a missing Common Controls v6 dependency in the embedded manifest stops native test execution', t => {
  const f = fixture(t, { validExtraction: false });
  assert.throws(f.execute, /missing the verified/);
  assert.equal(f.calls.filter(call => call.command === f.executable).length, 0);
});
test('native test crashes keep their Windows NTSTATUS and remain fatal to publication', t => {
  const f = fixture(t, { testsStatus: -1073741511 });
  assert.throws(f.execute, /0xc0000139/);
});
test('manifest verification handles SDK UTF-16 output and ignores commented declarations', () => {
  const source = readFileSync(manifestSource);
  assert.equal(hasCommonControlsV6(source), true);
  assert.equal(hasCommonControlsV6(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source.toString(), 'utf16le')])), true);
  assert.equal(hasCommonControlsV6(Buffer.from(`<!--${source.toString()}-->`)), false);
});
test('SDK tool discovery honors PATH and otherwise selects the newest installed x64 SDK', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes sdk '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'PATH/mt.exe');
  const older = path.join(directory, 'SDK/bin/10.0.22621.0/x64/mt.exe');
  const newer = path.join(directory, 'SDK/bin/10.0.26100.0/x64/mt.exe');
  for (const filename of [first, older, newer]) { mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, 'fixture'); }
  assert.equal(findManifestTool({ Path: path.dirname(first), WindowsSdkDir: path.join(directory, 'SDK') }), first);
  assert.equal(findManifestTool({ WindowsSdkDir: path.join(directory, 'SDK') }), newer);
  assert.throws(() => findManifestTool({}), /mt.exe was not found/);
});
