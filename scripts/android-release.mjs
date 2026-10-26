import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const markerStart = '// BEGIN HERMES ANDROID RELEASE';
const markerEnd = '// END HERMES ANDROID RELEASE';
export const artifactName = 'hermes-cockpit-android-arm64-release.apk';

export function signingInputs(env) {
  const releaseFields = ['ANDROID_RELEASE_KEYSTORE_BASE64', 'ANDROID_RELEASE_STORE_PASSWORD', 'ANDROID_RELEASE_KEY_ALIAS', 'ANDROID_RELEASE_KEY_PASSWORD'];
  if (releaseFields.some(name => env[name]) && !env.ANDROID_RELEASE_KEYSTORE_BASE64) {
    throw new Error('Missing ANDROID_RELEASE_KEYSTORE_BASE64; incomplete release signing cannot fall back.');
  }
  if (env.ANDROID_RELEASE_KEYSTORE_BASE64) {
    for (const name of ['ANDROID_RELEASE_STORE_PASSWORD', 'ANDROID_RELEASE_KEY_ALIAS', 'ANDROID_RELEASE_KEY_PASSWORD']) {
      if (!env[name]) throw new Error(`Missing ${name}; a configured release identity cannot fall back to a debug key.`);
    }
    return {
      mode: 'release-secret',
      base64: env.ANDROID_RELEASE_KEYSTORE_BASE64,
      storePassword: env.ANDROID_RELEASE_STORE_PASSWORD,
      alias: env.ANDROID_RELEASE_KEY_ALIAS,
      keyPassword: env.ANDROID_RELEASE_KEY_PASSWORD,
    };
  }
  // Transitional reuse of the EXACT existing certificate, even without Minisign.
  if (env.ANDROID_DEBUG_KEYSTORE_BASE64) return {
    mode: 'legacy-secret',
    base64: env.ANDROID_DEBUG_KEYSTORE_BASE64, storePassword: 'android',
    alias: 'androiddebugkey', keyPassword: 'android',
  };
  if (env.TAURI_SIGNING_PRIVATE_KEY || env.HERMES_UPDATER_SIGNING_REQUIRED === 'true') {
    throw new Error('Signed updater requires a persistent Android keystore secret; bootstrap fallback is not eligible.');
  }
  return { mode: 'bootstrap-debug', alias: 'androiddebugkey', storePassword: 'android', keyPassword: 'android' };
}

export function prepareBootstrapKeystore({ env = process.env, filename = path.join(homedir(), '.android/debug.keystore') } = {}) {
  const commandEnv = { ...env, HERMES_ANDROID_BOOTSTRAP_PASSWORD: 'android' };
  const keytool = args => {
    const result = spawnSync('keytool', args, { env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) throw new Error('Bootstrap keystore operation failed; check JDK and the existing debug keystore. Existing identities are never overwritten.');
    return result.stdout;
  };
  mkdirSync(path.dirname(filename), { recursive: true });
  let created = false;
  if (!existsSync(filename)) {
    const scratch = mkdtempSync(path.join(path.dirname(filename), 'hermes-bootstrap-'));
    try {
      const generated = path.join(scratch, 'debug.keystore');
      keytool(['-genkeypair', '-noprompt', '-keystore', generated, '-storetype', 'JKS', '-alias', 'androiddebugkey', '-storepass:env', 'HERMES_ANDROID_BOOTSTRAP_PASSWORD', '-keypass:env', 'HERMES_ANDROID_BOOTSTRAP_PASSWORD', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US']);
      try { copyFileSync(generated, filename, constants.COPYFILE_EXCL); created = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  chmodSync(filename, 0o600);
  const cert = keytool(['-exportcert', '-keystore', filename, '-storepass:env', 'HERMES_ANDROID_BOOTSTRAP_PASSWORD', '-alias', 'androiddebugkey']);
  return { filename, created, fingerprint: createHash('sha256').update(cert).digest('hex') };
}

export function verificationConfig(config, input, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !['release-secret', 'legacy-secret', 'bootstrap-debug'].includes(input.mode)) {
    throw new Error('Invalid APK signing policy.');
  }
  if (input.mode !== 'bootstrap-debug' && fingerprint !== config.certificateSha256) {
    throw new Error('Android certificate differs from android-release.json. Refusing to break updates for installed users.');
  }
  // Bootstrap checks the final APK against its actual signer, without rewriting the historical pin.
  return { ...config, certificateSha256: fingerprint };
}

export function decodeKeystore(value) {
  const compact = value.replace(/\s/g, '');
  if (!compact || compact.length > 2 * 1024 * 1024 || compact.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error('Invalid keystore Base64.');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64') !== compact) throw new Error('Non-canonical keystore Base64.');
  return bytes;
}

export function versionCode(env, config) {
  let code;
  if (env.GITHUB_ACTIONS === 'true') {
    const run = Number(env.GITHUB_RUN_NUMBER), attempt = Number(env.GITHUB_RUN_ATTEMPT);
    if (!Number.isSafeInteger(run) || run < 1 || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > 99) {
      throw new Error('Invalid Actions run/attempt for Android versionCode.');
    }
    code = config.versionCodeBase + run * 100 + attempt;
  } else {
    code = Number(env.ANDROID_VERSION_CODE);
  }
  if (!Number.isSafeInteger(code) || code <= config.minimumPreviousVersionCode || code > 2100000000) {
    throw new Error('Android versionCode must exceed the previous distributed value and remain within Android limits.');
  }
  return code;
}

export function configureGradle(text, code) {
  const start = text.indexOf(markerStart), end = text.indexOf(markerEnd);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new Error('Incomplete managed Gradle block.');
  const clean = start < 0 ? text : text.slice(0, start) + text.slice(end + markerEnd.length).trimStart();
  if (!clean.includes('getByName("release")') || !/optimization\s*\{\s*enable\s*=\s*true\s*\}/.test(clean)) {
    throw new Error('Unexpected Tauri Android template; inspect release optimization before adapting it.');
  }
  if (!Number.isSafeInteger(code)) throw new Error('Invalid Android versionCode.');
  // No passwords or key paths enter Gradle. The final APK is signed by apksigner.
  return `${clean.trimEnd()}\n\n${markerStart}\nandroid {\n    defaultConfig {\n        versionCode = ${code}\n        ndk {\n            abiFilters.clear()\n            abiFilters.add("arm64-v8a")\n        }\n    }\n    buildTypes {\n        getByName("release") {\n            isDebuggable = false\n            isJniDebuggable = false\n            signingConfig = null\n            // Hermes uses native HTTP/WebSocket transport to a user-selected LAN endpoint.\n            manifestPlaceholders["usesCleartextTraffic"] = "true"\n        }\n    }\n}\n${markerEnd}\n`;
}

function apkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? apkFiles(filename) : entry.name.endsWith('.apk') ? [filename] : [];
  });
}

export function buildAndroidRelease({ env = process.env } = {}) {
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/android-release.json')));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
  const tauri = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json')));
  if (config.applicationId !== tauri.identifier || config.abi !== 'arm64-v8a' || !/^[a-f0-9]{64}$/.test(config.certificateSha256)) {
    throw new Error('Invalid Android distribution identity.');
  }
  const input = signingInputs(env), code = versionCode(env, config);
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT is required.');
  const buildTools = path.join(sdk, 'build-tools', env.ANDROID_BUILD_TOOLS_VERSION || '37.0.0');
  const zipalign = path.join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
  const signerJar = path.join(buildTools, 'lib/apksigner.jar');
  for (const filename of [zipalign, signerJar]) if (!existsSync(filename)) throw new Error(`Missing SDK tool: ${path.basename(filename)}`);
  const gradle = path.join(root, 'src-tauri/gen/android/app/build.gradle.kts');
  if (!existsSync(gradle)) throw new Error('Run npm run android:init first.');
  const temporary = mkdtempSync(path.join(env.RUNNER_TEMP || tmpdir(), 'hermes-apk-release-'));
  const keystore = path.join(temporary, 'identity.jks');
  const signingEnv = { ...env, HERMES_ANDROID_STORE_PASSWORD: input.storePassword, HERMES_ANDROID_KEY_PASSWORD: input.keyPassword };
  const output = path.join(root, 'release-assets', artifactName);
  const invoke = (command, args, { secret = false, commandEnv = env } = {}) => {
    const result = spawnSync(command, args, { cwd: root, env: commandEnv, encoding: secret ? undefined : 'utf8', stdio: secret ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    if (result.status !== 0) throw new Error(secret ? 'Android signing operation failed. Verify keystore alias and passwords.' : `Android release command failed: ${path.basename(command)}`);
    return result.stdout;
  };
  try {
    if (input.mode === 'bootstrap-debug') {
      const bootstrap = prepareBootstrapKeystore({ env });
      copyFileSync(bootstrap.filename, keystore);
      chmodSync(keystore, 0o600);
    } else {
      writeFileSync(keystore, decodeKeystore(input.base64), { mode: 0o600 });
    }
    const cert = invoke('keytool', ['-exportcert', '-keystore', keystore, '-storepass:env', 'HERMES_ANDROID_STORE_PASSWORD', '-alias', input.alias], { secret: true, commandEnv: signingEnv });
    const fingerprint = createHash('sha256').update(cert).digest('hex');
    const effectiveConfig = verificationConfig(config, input, fingerprint);
    const verificationFile = path.join(temporary, 'verification.json');
    writeFileSync(verificationFile, JSON.stringify(effectiveConfig));
    console.log(`APK signing mode: ${input.mode}; certificate SHA-256: ${fingerprint}`);
    if (input.mode === 'bootstrap-debug') {
      console.warn('Bootstrap signing: cache reuse is best-effort; a changed certificate cannot upgrade an existing installation. No signed updater feed is enabled.');
    }
    writeFileSync(gradle, configureGradle(readFileSync(gradle, 'utf8'), code));
    // AGP 9.3 uses source-set keep rules with the new optimization DSL.
    const keep = path.join(path.dirname(gradle), 'src/main/keepRules');
    mkdirSync(keep, { recursive: true });
    writeFileSync(path.join(keep, 'hermes.keep'), readFileSync(path.join(root, 'src-tauri/android/hermes.keep')));
    rmSync(path.join(root, 'src-tauri/gen/android/app/build/outputs/apk'), { recursive: true, force: true });
    mkdirSync(path.dirname(output), { recursive: true });
    rmSync(output, { force: true });
    rmSync(`${output}.sig`, { force: true });
    const buildEnv = { ...env };
    // Secrets needed only by signing must not reach Gradle or build scripts.
    for (const key of Object.keys(buildEnv)) if (/^ANDROID_(RELEASE_|DEBUG_KEYSTORE)/.test(key) || key.startsWith('TAURI_SIGNING_PRIVATE_KEY')) delete buildEnv[key];
    invoke(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'android', 'build', '--apk', '--target', 'aarch64', '--split-per-abi', '--ci', '--', '--locked'], { commandEnv: buildEnv });
    const files = apkFiles(path.join(root, 'src-tauri/gen/android/app/build/outputs/apk'));
    if (files.length !== 1 || /debug/i.test(files[0]) || !/release/i.test(files[0])) throw new Error('Expected exactly one release APK, with no debug or extra ABI APKs.');
    const aligned = path.join(temporary, 'aligned.apk'), signed = path.join(temporary, artifactName);
    invoke(zipalign, ['-P', '16', '-f', '4', files[0], aligned]);
    invoke('java', ['-jar', signerJar, 'sign', '--ks', keystore, '--ks-key-alias', input.alias, '--ks-pass', 'env:HERMES_ANDROID_STORE_PASSWORD', '--key-pass', 'env:HERMES_ANDROID_KEY_PASSWORD', '--v4-signing-enabled', 'false', '--out', signed, aligned], { secret: true, commandEnv: signingEnv });
    mkdirSync(path.join(root, 'reports'), { recursive: true });
    copyFileSync(verificationFile, path.join(root, 'reports/android-apk-verification.json'));
    invoke(env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/verify-android-apk.py', signed, '--config', verificationFile, '--version-code', String(code), '--version-name', pkg.version, '--build-tools', buildTools, '--report', 'reports/android-apk-release.json']);
    const reportFile = path.join(root, 'reports/android-apk-release.json');
    const report = { ...JSON.parse(readFileSync(reportFile)), signingMode: input.mode, certificatePinMatched: fingerprint === config.certificateSha256 };
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `APK signing: ${input.mode}\n\nCertificate SHA-256: ${fingerprint}\n\nHistorical certificate pin matched: ${report.certificatePinMatched}\n`);
    copyFileSync(signed, output);
    console.log(`Verified Android release: ${artifactName}; versionCode=${code}`);
    return output;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'bootstrap-keystore') {
    const result = prepareBootstrapKeystore();
    console.log(`Bootstrap debug keystore ${result.created ? 'created' : 'reused'}; certificate SHA-256: ${result.fingerprint}`);
  } else if (process.argv[2] === 'build') buildAndroidRelease();
  else throw new Error('Usage: node scripts/android-release.mjs build|bootstrap-keystore');
}
