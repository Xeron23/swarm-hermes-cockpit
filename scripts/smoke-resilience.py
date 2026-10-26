"""Production browser UI with intercepted Hermes fixtures; never contact real nodes."""
import json
import os
import shutil
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = 'http://192.168.1.4:3450'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1421/'


class Backend:
    def __init__(self, uncertain=False, proof=False):
        self.uncertain, self.proof = uncertain, proof
        self.health_failures, self.snapshot_failures = 0, 0
        self.hold, self.held = False, []
        self.calls, self.sockets, self.rotations = [], [], 0

    def snapshot(self):
        return dict(workspace_id='w', device_id='d', nodes=[], agents=[], active_missions=[],
                    last_event_seq='0', features=dict(real_mode=True, runtime_ready=True))

    def handle(self, route):
        path = urlparse(route.request.url).path
        self.calls.append(path)
        value, status = {}, 200
        if path == '/health/ready':
            if self.health_failures:
                self.health_failures -= 1
                status, value = 503, {'error': {'code': 'STARTING', 'message': 'Fixture starting'}}
            else:
                value = {'status': 'ok', 'capabilities': {'refresh_token_status_v1': self.proof}}
        elif path.endswith('/refresh-status'):
            body = route.request.post_data_json
            assert self.proof and body['refresh_token'] == 'refresh'
            assert route.request.headers.get('authorization') is None
            value = dict(request_id=body['request_id'], workspace_id='w', device_id='d', refresh_token_state='current', rotation_performed=False)
        elif path.endswith('/auth/refresh'):
            self.rotations += 1
            value = dict(access_token='next', refresh_token='next-refresh', workspace_id='w', device_id='d')
        elif path.endswith('/bootstrap'):
            if self.uncertain and route.request.headers.get('authorization') != 'Bearer next':
                status, value = 401, {'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}}
            elif self.snapshot_failures:
                self.snapshot_failures -= 1
                status, value = 503, {'error': {'code': 'STARTING', 'message': 'Fixture snapshot unavailable'}}
            elif self.hold:
                self.held.append(route)
                return
            else:
                value = self.snapshot()
        elif path.endswith('/ws-ticket'):
            value = {'ticket': 'fixture', 'subprotocol': 'hermes.telemetry.v1'}
        elif path.endswith(('/missions', '/sessions', '/approvals', '/questions')):
            value = {'items': []}
        else:
            raise AssertionError('Unexpected endpoint: ' + path)
        route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(value))

    def socket(self, ws):
        self.sockets.append(ws)
        ws.on_message(lambda value: ws.send('pong') if value == 'ping' else None)


with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    for mobile in [False, True]:
        for mode in ['normal', 'uncertain-blocked', 'uncertain-recovered']:
            backend = Backend(mode != 'normal', mode == 'uncertain-recovered')
            if mode == 'normal':
                backend.health_failures = 2
            context = browser.new_context(viewport={'width': 430 if mobile else 1360, 'height': 900}, has_touch=mobile)
            session = dict(server=BASE, workspace_id='w', device_id='d', access_token='access', refresh_token='refresh')
            if backend.uncertain:
                session['refresh_uncertain'] = True
            context.add_init_script('if (!localStorage.getItem("hermes_auth_v2")) localStorage.setItem("hermes_auth_v2", ' + json.dumps(json.dumps(session)) + ');')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route(BASE + '/**', backend.handle)
            page.route_web_socket('ws://192.168.1.4:3450/**', backend.socket)
            page.goto(URL)
            badge = page.get_by_label('Backend status')
            if mode == 'uncertain-blocked':
                expect(badge).to_have_text('Verifikasi sesi diperlukan')
                assert backend.rotations == 0
                assert page.evaluate('JSON.parse(localStorage.hermes_auth_v2).refresh_uncertain') is True
            else:
                expect(badge).to_have_text('Terhubung', timeout=10000)
                if mode == 'uncertain-recovered':
                    assert backend.rotations == 1
                    assert not page.evaluate('JSON.parse(localStorage.hermes_auth_v2).refresh_uncertain || false')
                else:
                    button = page.locator('[data-action="refresh"]')
                    backend.hold = True
                    button.click()
                    expect(button).to_have_attribute('aria-busy', 'true')
                    expect(button).to_be_disabled()
                    page.evaluate('document.querySelector("[data-action=refresh]").dispatchEvent(new MouseEvent("click", {bubbles:true}))')
                    assert len(backend.held) == 1
                    backend.hold = False
                    backend.held.pop().fulfill(status=200, content_type='application/json', body=json.dumps(backend.snapshot()))
                    expect(button).to_have_attribute('aria-busy', 'false')
                    backend.snapshot_failures = 2
                    button.click()
                    expect(page.locator('.action-error')).to_contain_text('Fixture snapshot unavailable')
                    page.evaluate('window.dispatchEvent(new Event("online"))')
                    expect(page.locator('.action-error')).to_have_count(0)
                    expect(badge).to_have_text('Terhubung')
                    before = page.evaluate('localStorage.hermes_auth_v2')
                    page.reload()
                    expect(badge).to_have_text('Terhubung')
                    assert page.evaluate('localStorage.hermes_auth_v2') == before
                    page.evaluate('window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pageshow"))')
                    expect(badge).to_have_text('Terhubung')
            assert not any(path.endswith('/auth/pair') for path in backend.calls)
            assert not errors, errors
            print(f'PASS {"mobile" if mobile else "desktop"}/{mode}')
            context.close()
    browser.close()
