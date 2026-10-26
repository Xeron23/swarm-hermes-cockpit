import importlib.util
import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('apk_check', Path(__file__).with_name('verify-android-apk.py'))
apk_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apk_check)
CONFIG = json.loads((Path(__file__).resolve().parent.parent / 'src-tauri/android-release.json').read_text())


def binary_manifest():
    names = ['manifest', 'package', 'app.hermes.cockpit', 'versionCode', 'versionName', '0.1.5',
             'application', 'debuggable', 'usesCleartextTraffic', 'uses-sdk', 'minSdkVersion',
             'uses-permission', 'name', 'android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES']
    pool, offsets = b'', []
    for text in names:
        value = text.encode()
        offsets.append(len(pool))
        pool += bytes([len(text), len(value)]) + value + b'\0'
    pool += b'\0' * (-len(pool) % 4)
    start = 28 + len(names) * 4
    strings = struct.pack('<HHIIIIII', 1, 28, start + len(pool), len(names), 0, 256, start, 0)
    strings += struct.pack('<' + 'I' * len(offsets), *offsets) + pool

    def node(tag, attrs):
        attributes = b''
        for key, value in attrs.items():
            kind, encoded = (3, names.index(value)) if isinstance(value, str) else (18, int(value)) if isinstance(value, bool) else (16, value)
            attributes += struct.pack('<IIIHBBI', 0xffffffff, names.index(key), 0xffffffff, 8, 0, kind, encoded)
        size = 36 + len(attributes)
        return struct.pack('<HHIII', 0x102, 16, size, 1, 0xffffffff) + struct.pack('<IIHHHHHH', 0xffffffff, names.index(tag), 20, 20, len(attrs), 0, 0, 0) + attributes
    body = strings + node('manifest', {'package': 'app.hermes.cockpit', 'versionCode': 1002701, 'versionName': '0.1.5'})
    body += node('application', {'debuggable': False, 'usesCleartextTraffic': True})
    body += node('uses-sdk', {'minSdkVersion': 24})
    body += node('uses-permission', {'name': 'android.permission.INTERNET'})
    body += node('uses-permission', {'name': 'android.permission.REQUEST_INSTALL_PACKAGES'})
    return struct.pack('<HHI', 3, 8, len(body) + 8) + body


def elf_fixture():
    names = b'\0.shstrtab\0.dynsym\0'
    content = bytearray(120 + len(names) + 3 * 64)
    content[:16] = b'\x7fELF\x02\x01\x01' + b'\0' * 9
    struct.pack_into('<HHIQQQIHHHHHH', content, 16, 3, 183, 1, 0, 64, 120 + len(names), 0, 64, 56, 1, 64, 3, 1)
    struct.pack_into('<IIQQQQQQ', content, 64, 1, 5, 0, 0, 0, 120, 120, 16384)
    content[120:120 + len(names)] = names
    struct.pack_into('<IIQQQQIIQQ', content, 120 + len(names) + 64, 1, 3, 0, 0, 120, len(names), 0, 0, 1, 0)
    struct.pack_into('<IIQQQQIIQQ', content, 120 + len(names) + 128, 11, 11, 2, 0, 0, 0, 0, 0, 8, 24)
    return content


class ApkPolicyTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / 'release.apk'
        with zipfile.ZipFile(self.apk, 'w') as archive:
            archive.writestr('AndroidManifest.xml', binary_manifest())
            archive.writestr('lib/arm64-v8a/libhermes_cockpit_lib.so', elf_fixture())
        self.report = apk_check.inspect_apk(self.apk)

    def errors(self):
        return apk_check.release_errors(self.report, CONFIG, 1002701, '0.1.5')

    def test_binary_manifest_elf_and_valid_release(self):
        self.assertEqual(self.errors(), [])
        self.assertEqual(self.report['manifest']['application']['debuggable'], False)

    def test_debug_testonly_and_lan_regression_rejected(self):
        app = self.report['manifest']['application']
        app.update(debuggable=True, testOnly=True, usesCleartextTraffic=False)
        self.assertEqual(len(self.errors()), 2)

    def test_multiple_abis_rejected(self):
        self.report['abis'].append('x86_64')
        self.assertTrue(any('only arm64' in error for error in self.errors()))

    def test_wrong_identity_and_version_rejected(self):
        self.report['manifest']['manifest'].update(package='other.app', versionCode=1005, versionName='old')
        self.assertEqual(len(self.errors()), 3)

    def test_debug_symbols_and_bad_alignment_rejected(self):
        native = next(iter(self.report['native'].values()))
        native.update(debugSections={'.debug_info': 100}, hasSymtab=True)
        native['loadSegments'][0]['alignment'] = 4096
        self.assertEqual(len(self.errors()), 2)

    def test_size_budget_rejected(self):
        self.report['bytes'] = CONFIG['maxApkBytes'] + 1
        self.assertTrue(any('size budget' in error for error in self.errors()))

    def test_missing_permission_rejected(self):
        self.report['manifest']['permissions'].remove('android.permission.REQUEST_INSTALL_PACKAGES')
        self.assertTrue(any('Missing required permission' in error for error in self.errors()))

    def test_truncated_binary_formats_rejected(self):
        for parser, value in [(apk_check.android_manifest, b'broken'), (apk_check.elf_info, b'broken')]:
            with self.assertRaises(ValueError):
                parser(value)

    def test_sdk_old_and_new_certificate_output_formats(self):
        fingerprint = CONFIG['certificateSha256']
        for label in ['Signer #1', 'V2 Signer:', 'V3.1 Signer:']:
            output = f'Number of signers: 1\n{label} certificate SHA-256 digest: {fingerprint}\n'
            self.assertEqual(apk_check.signing_certificate(output, fingerprint), fingerprint)

    def test_wrong_or_multiple_signing_certificates_rejected(self):
        for output in ['Number of signers: 1\nV2 Signer: certificate SHA-256 digest: deadbeef\n',
                       'Number of signers: 2\nV2 Signer: certificate SHA-256 digest: ' + CONFIG['certificateSha256'] + '\n']:
            with self.assertRaises(ValueError):
                apk_check.signing_certificate(output, CONFIG['certificateSha256'])


if __name__ == '__main__':
    unittest.main()
