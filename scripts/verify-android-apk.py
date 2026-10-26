#!/usr/bin/env python3
"""Inspect the final APK bytes; validate release properties before publication."""
import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import zipfile
from pathlib import Path


def android_manifest(data):
    """Read the string pool and typed attributes in Android binary XML."""
    if len(data) < 8 or struct.unpack_from('<H', data)[0] != 3:
        raise ValueError('AndroidManifest.xml is not binary XML')
    if struct.unpack_from('<I', data, 4)[0] != len(data):
        raise ValueError('Invalid binary XML length')
    strings, result, offset = [], {'permissions': []}, 8

    def u32(pos):
        return struct.unpack_from('<I', data, pos)[0]

    def pool_string(pos, utf8):
        def length(width):
            nonlocal pos
            fmt, flag, shift = ('B', 128, 8) if width == 1 else ('H', 32768, 16)
            value = struct.unpack_from('<' + fmt, data, pos)[0]
            pos += width
            if value & flag:
                value = ((value & (flag - 1)) << shift) | struct.unpack_from('<' + fmt, data, pos)[0]
                pos += width
            return value
        if utf8:
            length(1)
            count = length(1)
            return data[pos:pos + count].decode('utf-8')
        count = length(2)
        return data[pos:pos + count * 2].decode('utf-16le')

    while offset < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, offset)
        if size < header or header < 8 or offset + size > len(data):
            raise ValueError('Invalid binary XML chunk')
        if kind == 1:
            count, _, flags, start, _ = struct.unpack_from('<IIIII', data, offset + 8)
            if header + count * 4 > size:
                raise ValueError('Invalid XML string pool')
            strings = [pool_string(offset + start + u32(offset + header + i * 4), bool(flags & 256)) for i in range(count)]
        elif kind == 0x102:
            _, name, attr_start, attr_size, count = struct.unpack_from('<IIHHH', data, offset + 16)
            if attr_size < 20 or 16 + attr_start + count * attr_size > size:
                raise ValueError('Invalid XML attribute list')
            attrs = {}
            for i in range(count):
                pos = offset + 16 + attr_start + i * attr_size
                _, attr_name, raw = struct.unpack_from('<III', data, pos)
                value_type, value = data[pos + 15], u32(pos + 16)
                attrs[strings[attr_name]] = (
                    strings[raw] if raw != 0xffffffff else
                    strings[value] if value_type == 3 else
                    bool(value) if value_type == 18 else value
                )
            tag = strings[name]
            if tag in ('manifest', 'application', 'uses-sdk'):
                result[tag] = attrs
            elif tag == 'uses-permission':
                result['permissions'].append(attrs.get('name'))
        offset += size
    return result


def elf_info(data):
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Native library must be little-endian ELF64')
    elf_type, machine = struct.unpack_from('<HH', data, 16)
    program_offset, section_offset = struct.unpack_from('<QQ', data, 32)
    program_size, program_count, section_size, section_count, names_index = struct.unpack_from('<HHHHH', data, 54)
    if section_size != 64 or program_size != 56 or not 0 < names_index < section_count:
        raise ValueError('Unsupported ELF headers')
    if section_offset + section_count * section_size > len(data) or program_offset + program_count * program_size > len(data):
        raise ValueError('Truncated ELF headers')
    sections = [struct.unpack_from('<IIQQQQIIQQ', data, section_offset + i * section_size) for i in range(section_count)]
    names_header = sections[names_index]
    names = data[names_header[4]:names_header[4] + names_header[5]]
    sizes = {}
    for section in sections:
        if section[0] >= len(names):
            raise ValueError('Invalid ELF section name')
        name = names[section[0]:].split(b'\0', 1)[0].decode('ascii')
        sizes[name] = section[5]
    loads = []
    for i in range(program_count):
        segment = struct.unpack_from('<IIQQQQQQ', data, program_offset + i * program_size)
        if segment[0] == 1:
            loads.append({'offset': segment[2], 'address': segment[3], 'alignment': segment[7]})
    debug = {name: size for name, size in sizes.items() if name.startswith(('.debug_', '.zdebug_'))}
    return {
        'bytes': len(data), 'machine': machine, 'type': elf_type,
        'debugSections': debug, 'debugBytes': sum(debug.values()),
        'hasSymtab': '.symtab' in sizes, 'hasDynsym': '.dynsym' in sizes,
        'loadSegments': loads,
    }


def inspect_apk(filename):
    filename = Path(filename)
    with zipfile.ZipFile(filename) as apk:
        entries = apk.infolist()
        if len({item.filename for item in entries}) != len(entries):
            raise ValueError('Duplicate ZIP entries')
        corrupt = apk.testzip()
        if corrupt:
            raise ValueError('Corrupt APK ZIP entry')
        native = {}
        for item in entries:
            if item.filename.startswith('lib/') and item.filename.endswith('.so'):
                native[item.filename] = {
                    **elf_info(apk.read(item)), 'zipBytes': item.compress_size,
                    'zipMethod': item.compress_type,
                }
        return {
            'file': filename.name, 'bytes': filename.stat().st_size,
            'sha256': hashlib.sha256(filename.read_bytes()).hexdigest(),
            'abis': sorted({name.split('/')[1] for name in native}),
            'manifest': android_manifest(apk.read('AndroidManifest.xml')),
            'native': native,
            'largestEntries': [{'name': item.filename, 'bytes': item.file_size, 'zipBytes': item.compress_size}
                               for item in sorted(entries, key=lambda item: item.file_size, reverse=True)[:10]],
        }


def release_errors(report, config, code, version):
    errors = []
    manifest = report['manifest']
    app = manifest.get('application', {})
    identity = manifest.get('manifest', {})
    if report['bytes'] > config['maxApkBytes']:
        errors.append('APK exceeds the committed size budget')
    if report['abis'] != [config['abi']]:
        errors.append('APK must contain only arm64-v8a')
    if identity.get('package') != config['applicationId']:
        errors.append('APK application ID differs from the distribution identity')
    if identity.get('versionCode') != code or code <= config['minimumPreviousVersionCode']:
        errors.append('APK versionCode is incorrect or cannot upgrade the migration baseline')
    if identity.get('versionName') != version:
        errors.append('APK versionName differs from package.json')
    if app.get('debuggable', False) or app.get('testOnly', False):
        errors.append('Debuggable/testOnly APK cannot be released')
    if app.get('usesCleartextTraffic') is not True:
        errors.append('LAN HTTP/WebSocket access must remain available in this release')
    if manifest.get('uses-sdk', {}).get('minSdkVersion') != 24:
        errors.append('Unexpected minimum Android API level')
    for permission in ['android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES']:
        if permission not in manifest.get('permissions', []):
            errors.append('Missing required permission: ' + permission)
    expected = 'lib/arm64-v8a/libhermes_cockpit_lib.so'
    if expected not in report['native']:
        errors.append('Missing Hermes ARM64 library')
    for name, native in report['native'].items():
        if native['machine'] != 183 or native['type'] != 3:
            errors.append('Invalid AArch64 shared library: ' + name)
        if native['debugSections'] or native['hasSymtab'] or not native['hasDynsym']:
            errors.append('Native library is not stripped correctly: ' + name)
        if not native['loadSegments'] or any(
            segment['alignment'] < 16384 or (segment['offset'] - segment['address']) % 16384
            for segment in native['loadSegments']
        ):
            errors.append('Native library lacks 16 KiB ELF alignment: ' + name)
    return errors


def signing_certificate(output, expected_certificate):
    # Build Tools 37 uses "V2 Signer:"; older versions use "Signer #1".
    certificates = re.findall(r'^(?:Signer #\d+|V[\d.]+ Signer):?\s+certificate SHA-256 digest:\s*([0-9a-fA-F]+)\s*$', output, re.MULTILINE)
    count = re.search(r'^Number of signers:\s*(\d+)\s*$', output, re.MULTILINE)
    if not count or count[1] != '1' or {value.lower() for value in certificates} != {expected_certificate}:
        raise ValueError('APK signing certificate does not match the pinned distribution identity')
    return expected_certificate


def verify_sdk(filename, build_tools, expected_certificate):
    tools = Path(build_tools)
    signer = subprocess.run(['java', '-jar', str(tools / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(filename)], capture_output=True, text=True)
    if signer.returncode:
        raise ValueError('APK cryptographic signature verification failed')
    certificate = signing_certificate(signer.stdout, expected_certificate)
    aligner = subprocess.run([str(tools / ('zipalign.exe' if sys.platform == 'win32' else 'zipalign')), '-c', '-P', '16', '4', str(filename)], capture_output=True, text=True)
    if aligner.returncode:
        raise ValueError('APK ZIP alignment verification failed')
    return certificate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', type=Path)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--config', type=Path, default=Path('src-tauri/android-release.json'))
    parser.add_argument('--version-code', type=int)
    parser.add_argument('--version-name')
    parser.add_argument('--build-tools', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = inspect_apk(args.apk)
    errors = []
    if not args.inspect:
        if args.version_code is None or not args.version_name or not args.build_tools:
            parser.error('Release verification requires version-code, version-name and build-tools')
        config = json.loads(args.config.read_text())
        errors = release_errors(report, config, args.version_code, args.version_name)
        try:
            report['certificateSha256'] = verify_sdk(args.apk, args.build_tools, config['certificateSha256'])
        except ValueError as exc:
            errors.append(str(exc))
    report['errors'] = errors
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    if errors:
        raise SystemExit('\n'.join(errors))
    print(json.dumps(report, indent=2) if args.inspect else
          f"PASS: release APK {report['bytes']} bytes; ARM64, stripped, signed, non-debug, 16 KiB aligned")


if __name__ == '__main__':
    main()
