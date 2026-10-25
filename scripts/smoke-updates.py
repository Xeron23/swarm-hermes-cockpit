"""Production UI + mocked native updater IPC. No real download or installation."""
import json
import os
import shutil
import sys
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1421/'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), headless=True)
    for platform in ['windows', 'android']:
        context = browser.new_context(viewport={'width': 430 if platform == 'android' else 1360, 'height': 900})
        context.add_init_script('window.fixturePlatform = ' + json.dumps(platform) + ';' + r'''
          window.isTauri = true;
          window.fixtureCalls = [];
          window.fixtureResult = 'cancelled';
          window.__TAURI_INTERNALS__ = {
            transformCallback: () => 1, unregisterCallback: () => {},
            invoke: async (command, args) => {
              window.fixtureCalls.push(command);
              if (command === 'runtime_info') return { app: 'Hermes Cockpit', version: '0.1.5', platform: window.fixturePlatform, mode: 'live', commit: 'fixture', build_run: '29' };
              if (command === 'plugin:updater|check' || command === 'android_update_check') return { rid: 41, currentVersion: '0.1.5', version: '0.1.5+build.30.1', body: '<script>window.fixtureUnsafe=true</script>' };
              if (command === 'plugin:updater|download' || command === 'android_update_download') {
                args.onEvent.onmessage({ event: 'Started', data: { contentLength: 1024 } });
                args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 1024 } });
                args.onEvent.onmessage({ event: 'Finished' });
                await new Promise(resolve => setTimeout(resolve, 200));
                if (window.fixtureBadSignature) throw { code: 'UPDATE_VERIFICATION_FAILED' };
                return 42;
              }
              if (command === 'android_update_install') return { status: window.fixtureResult };
              if (command === 'plugin:updater|install' || command === 'plugin:resources|close' || command === 'android_update_close') return null;
              throw new Error('Unexpected fixture IPC: ' + command);
            }
          };
        ''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL, wait_until='networkidle')
        page.locator('[data-action="app-updates"]').filter(visible=True).first.click()
        expect(page.locator('#updates-panel')).to_contain_text('Pembaruan tersedia')
        assert not page.evaluate('window.fixtureCalls.some(c => c.includes("download") || c.endsWith("install"))')
        expect(page.locator('#updates-panel pre')).to_contain_text('<script>')
        assert not page.evaluate('window.fixtureUnsafe')
        page.evaluate('window.fixtureBadSignature = true')
        page.get_by_role('button', name='Unduh pembaruan').click()
        expect(page.locator('#updates-panel')).to_contain_text('Tanda tangan paket tidak sesuai')
        expect(page.locator('[data-action="update-confirm"]')).to_have_count(0)
        page.evaluate('window.fixtureBadSignature = false')
        page.get_by_role('button', name='Unduh pembaruan').click()
        expect(page.locator('#updates-panel')).to_contain_text('Pembaruan siap dipasang')
        assert not page.evaluate('window.fixtureCalls.some(c => c.endsWith("install"))')
        page.locator('[data-action="update-confirm"]').click()
        expect(page.get_by_role('dialog')).to_contain_text('Pasang pembaruan?')
        assert not page.evaluate('window.fixtureCalls.some(c => c.endsWith("install"))')
        page.get_by_role('button', name='Pasang sekarang').click()
        expect(page.locator('#updates-panel')).to_contain_text('Pemasangan dibatalkan' if platform == 'android' else 'Pembaruan terpasang')
        if platform == 'android':
            page.evaluate('window.fixtureResult = "permission_required"')
            page.locator('[data-action="update-confirm"]').click()
            page.get_by_role('button', name='Pasang sekarang').click()
            expect(page.locator('#updates-panel')).to_contain_text('Izinkan pemasangan')
        assert not errors, errors
        print(f'PASS: {platform} production UI, automatic check, explicit download/install, invalid signature, escaped notes and cancellation')
        context.close()
    browser.close()
