import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function findManifestTool(env = process.env) {
  const searchPath = env.PATH || env.Path || '';
  for (const directory of searchPath.split(';').filter(Boolean)) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), 'mt.exe');
    if (existsSync(candidate)) return candidate;
  }
  const roots = [env.WindowsSdkDir, env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Windows Kits', '10')].filter(Boolean);
  for (const root of roots) {
    const bin = path.join(root, 'bin');
    if (!existsSync(bin)) continue;
    const versions = readdirSync(bin, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
      .map(entry => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of [...versions, '']) {
      const candidate = path.join(bin, version, 'x64', 'mt.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Windows SDK mt.exe was not found; a manifest is required before native unit tests can start.');
}

export function hasCommonControlsV6(bytes) {
  const xml = (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8')).replace(/<!--[\s\S]*?-->/g, '');
  return (xml.match(/<(?:[\w.-]+:)?assemblyIdentity\b[^>]*>/g) || []).some(identity =>
    /\bname\s*=\s*(["'])Microsoft\.Windows\.Common-Controls\1/.test(identity)
    && /\bversion\s*=\s*(["'])6\.0\.0\.0\1/.test(identity));
}

export function testWindowsNative({ cwd = process.cwd(), env = process.env, run = spawnSync, manifestTool, log = text => process.stdout.write(text) } = {}) {
  const invoke = (command, args, capture = false) => {
    const result = run(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (result.error) throw result.error;
    return result;
  };
  const build = invoke('cargo', ['test', '--release', '--lib', '--manifest-path', 'src-tauri/Cargo.toml', '--offline', '--locked', '--no-run', '--message-format=json'], true);
  const executables = new Set();
  for (const line of (build.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.reason === 'compiler-message' && event.message?.rendered) log(event.message.rendered);
    const library = event.target?.kind?.some(kind => ['lib', 'rlib', 'staticlib', 'cdylib', 'dylib'].includes(kind));
    if (event.reason === 'compiler-artifact' && event.profile?.test && library && event.executable) executables.add(event.executable);
  }
  if (build.status !== 0) throw new Error(`Native test compilation failed (exit ${build.status}).`);
  if (!executables.size) throw new Error('Cargo did not produce a library unit test executable; refusing to skip native tests.');
  const manifest = path.join(cwd, 'src-tauri/windows-test.manifest');
  if (!hasCommonControlsV6(readFileSync(manifest))) throw new Error('Native test manifest must request Common Controls v6.');
  const mt = manifestTool || findManifestTool(env);
  const validate = invoke(mt, ['-nologo', '-manifest', manifest, '-validate_manifest']);
  if (validate.status !== 0) throw new Error('Windows SDK rejected the native test manifest.');
  const directory = mkdtempSync(path.join(tmpdir(), 'hermes-native-test-manifests-'));
  try {
    let index = 0;
    for (const executable of executables) {
      if (!existsSync(executable) || !executable.toLowerCase().endsWith('.exe')) throw new Error(`Missing native unit test executable: ${executable}`);
      // tauri-build/embed-resource links its resource only to application bins.
      // Library unit test EXEs need their own activation context for comctl32 v6.
      const embed = invoke(mt, ['-nologo', '-manifest', manifest, `-outputresource:${executable};#1`]);
      if (embed.status !== 0) throw new Error('Could not embed the native test manifest.');
      const extracted = path.join(directory, `${index++}.manifest`);
      const extract = invoke(mt, ['-nologo', `-inputresource:${executable};#1`, `-out:${extracted}`]);
      if (extract.status !== 0 || !existsSync(extracted) || !hasCommonControlsV6(readFileSync(extracted))) {
        throw new Error('Native test EXE is missing the verified Common Controls v6 manifest.');
      }
      log(`Running native tests with Common Controls v6: ${path.basename(executable)}\n`);
      const tests = invoke(executable, ['--nocapture']);
      if (tests.status !== 0) {
        const code = tests.status === null ? tests.signal || 'unknown' : `0x${(tests.status >>> 0).toString(16).padStart(8, '0')}`;
        throw new Error(`Native unit tests failed (${code}): ${executable}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'win32') throw new Error('Native Windows tests require Windows and its SDK.');
  testWindowsNative({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
}
