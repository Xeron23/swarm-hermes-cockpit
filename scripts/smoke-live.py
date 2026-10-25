"""Browser integration checks against contract fixtures, never the user's nodes.

Run with Python Playwright installed, while Vite/preview is running:
    python3 scripts/smoke-live.py http://127.0.0.1:1420/
"""
import json
import os
import shutil
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = 'http://192.168.1.4:3450'
PAGE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:1420/'


class BackendFixture:
    def __init__(self):
        self.missions = []
        self.messages = []
        self.requests = []
        self.sockets = []
        self.seq = 104
        self.health = True
        self.pair_failure = False
        self.ticket_failure = False
        self.approvals = [{'id': 'fixture-approval', 'title': 'Fixture command', 'request_hash': 'fixture-hash-1', 'request': {'command': 'fixture-only'}}]
        self.nodes = [
            {'id': 'vps', 'name': 'Fixture server', 'os': 'linux', 'lan_ip': '192.168.1.4', 'status': 'online', 'accepting_tasks': True, 'effective_capabilities': ['exec', 'fs'], 'metrics': None, 'metrics_stale': True, 'last_seen_at': '2026-10-25T07:00:00Z', 'active_tools': 0, 'max_parallel_tools': 4, 'wake_supported': False},
            {'id': 'pc', 'name': 'Fixture Windows', 'os': 'windows', 'lan_ip': '192.168.1.26', 'status': 'offline', 'accepting_tasks': False, 'effective_capabilities': [], 'metrics': None, 'metrics_stale': True, 'last_seen_at': None, 'active_tools': 0, 'max_parallel_tools': 2, 'wake_supported': False},
        ]

    def handle(self, route):
        request = route.request
        path = urlparse(request.url).path
        body = request.post_data_json if request.post_data else None
        self.requests.append((request.method, path, body))
        status = 200
        if path == '/health/ready':
            assert request.headers.get('authorization') is None
            status = 200 if self.health else 503
            value = {'status': 'ok', 'service': 'api', 'version': '1.0.0'} if self.health else {'error': {'code': 'NOT_READY', 'message': 'Fixture backend unavailable', 'retryable': True}}
        elif path == '/api/v1/auth/pair':
            assert body['pairing_code'] == 'A' * 26
            assert request.headers.get('authorization') is None
            value = {'access_token': 'fixture-access', 'refresh_token': 'fixture-refresh', 'workspace_id': 'fixture-workspace', 'device_id': 'fixture-device', 'expires_in': 900}
            if self.pair_failure:
                status = 400
                value = {'error': {'code': 'INVALID_PAIRING_CODE', 'message': f"Code {body['pairing_code']} expired", 'retryable': False}}
        else:
            assert request.headers.get('authorization') == 'Bearer fixture-access', path
            if path == '/api/v1/bootstrap':
                value = {'workspace_id': 'fixture-workspace', 'device_id': 'fixture-device', 'last_event_seq': str(self.seq), 'agents': [{'id': 'main', 'name': 'Fixture orchestrator', 'role': 'Planner', 'status': 'idle', 'tools': ['terminal'], 'node_affinity': 'auto', 'instructions': 'Fixture instructions', 'active_direct_session_id': 'fixture-session'}], 'nodes': self.nodes, 'active_missions': self.missions, 'features': {'real_mode': True, 'runtime_ready': True, 'wake_supported': False, 'approvals': True}}
            elif path == '/api/v1/auth/ws-ticket':
                value = {'ticket': f'fixture-ticket-{len(self.sockets)}', 'subprotocol': 'hermes.telemetry.v1', 'expires_at': '2026-10-25T12:00:00Z'}
                if self.ticket_failure:
                    status = 403
                    value = {'error': {'code': 'TICKET_DENIED', 'message': 'Fixture telemetry ticket denied', 'retryable': False}}
            elif path == '/api/v1/sessions':
                value = {'items': []} if request.method == 'GET' else {'id': 'fixture-session', 'agent_id': 'main'}
            elif path == '/api/v1/sessions/fixture-session/messages':
                if request.method == 'POST':
                    assert body['execution']['target_node'] == 'auto'
                    value = {'id': 'fixture-user-message', 'session_id': 'fixture-session', 'seq_no': '1', 'sender_kind': 'user', 'sender_id': 'user', 'message_type': 'chat', 'content': body['content'], 'status': 'complete', 'created_at': '2026-10-25T07:00:00Z'}
                    self.messages.append(value)
                else:
                    value = {'items': self.messages}
            elif path == '/api/v1/missions':
                if request.method == 'POST':
                    assert body['execution']['target_node'] == 'auto'
                    value = {'id': 'fixture-mission', 'title': body['title'], 'prompt': body['prompt'], 'status': 'queued', 'progress_percent': 0}
                    self.missions.append(value)
                else:
                    value = {'items': self.missions}
            elif path == '/api/v1/approvals':
                value = {'items': self.approvals}
            elif path == '/api/v1/approvals/fixture-approval/decision':
                assert body['request_hash'] == 'fixture-hash-2'
                assert body['decision'] == 'approved'
                self.approvals = []
                value = {'status': 'approved'}
            elif path == '/api/v1/questions':
                value = {'items': []}
            elif path == '/api/v1/tasks/fixture-task/traces':
                value = {'items': [{'id': 'fixture-trace', 'tool_name': 'terminal', 'status': 'succeeded'}]}
            elif path == '/api/v1/traces/fixture-trace/logs':
                value = {'trace_id': 'fixture-trace', 'chunks': [{'stream': 'stdout', 'content': 'Output recorded by fixture worker\n', 'seq': 1}], 'truncated': False}
            else:
                raise AssertionError(f'Unexpected backend operation: {request.method} {path}')
        route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(value))

    def socket(self, ws):
        assert 'after_seq=' in ws.url and 'ticket=' in ws.url
        self.sockets.append(ws)
        ws.on_message(lambda message: ws.send('pong') if message == 'ping' else None)

    def event(self, event_type, payload, event_id=None):
        self.seq += 1
        event = {'schema_version': '1.0', 'event_id': event_id or f'fixture-event-{self.seq}', 'seq': str(self.seq), 'timestamp': '2026-10-25T07:01:00Z', 'workspace_id': 'fixture-workspace', 'event_type': event_type, 'sender': 'agent:main', 'payload': payload}
        self.sockets[-1].send(json.dumps(event))
        return event


with sync_playwright() as p:
    executable = os.environ.get('HERMES_TEST_CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser')
    browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    for mobile in [False, True]:
        context = browser.new_context(viewport={'width': 430 if mobile else 1360, 'height': 900 if mobile else 860}, has_touch=mobile, permissions=['clipboard-read', 'clipboard-write'])
        page = context.new_page()
        backend = BackendFixture()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route(f'{BASE}/**', backend.handle)
        page.route_web_socket('ws://192.168.1.4:3450/**', backend.socket)
        page.goto(PAGE, wait_until='networkidle')
        expect(page.get_by_label('Backend status')).to_have_text('Belum dipasangkan')
        expect(page.locator('.node-card')).to_have_count(0)
        expect(page.locator('.mission-card')).to_have_count(0)
        assert not backend.requests, 'Unpaired client must not authenticate with old/demo credentials'
        page.get_by_label('Backend status').click()
        expect(page.get_by_role('dialog')).to_contain_text('0.1.5')
        expect(page.get_by_role('dialog')).to_contain_text('Browser fetch + WebSocket')
        page.get_by_role('button', name='Uji API tanpa pairing').click()
        expect(page.locator('#connection-diagnostics')).to_contain_text('API dapat dijangkau')
        expect(page.locator('#connection-diagnostics')).to_contain_text('1.0.0')
        assert backend.requests == [('GET', '/health/ready', None)]
        backend.pair_failure = True

        def paste_code(value):
            page.locator('#pair-code').fill('')
            page.evaluate('(text) => navigator.clipboard.writeText(text)', value)
            page.locator('#pair-code').click()
            page.keyboard.press('Control+V')

        for raw in ['A' * 26, '  ' + 'a' * 26 + '\u00a0\n', '\u2066\u200b' + 'A' * 13 + '\u200d' + 'A' * 13 + '\u2069']:
            paste_code(raw)
            expect(page.locator('#pair-code')).to_have_value('A' * 26)
            assert page.locator('#pair-code').evaluate('(el) => el.checkValidity()')
        for invalid in ['A' * 27, '8' * 26, 'A' * 25 + '-']:
            paste_code(invalid)
            expect(page.locator('#pair-code')).to_have_value(invalid)
            page.locator('button[form="pair-form"]').click()
            assert not page.locator('#pair-code').evaluate('(el) => el.checkValidity()')
            assert backend.requests == [('GET', '/health/ready', None)], 'Invalid input must not consume a pairing attempt'

        paste_code('  ' + 'a' * 26 + '\u200b\u00a0')
        expect(page.locator('#pair-code')).to_have_value('A' * 26)
        page.locator('#device-name').fill('Fixture client')
        page.locator('button[form="pair-form"]').click()
        expect(page.locator('#connection-diagnostics')).to_contain_text('HTTP 400')
        expect(page.locator('#connection-diagnostics')).to_contain_text('INVALID_PAIRING_CODE')
        expect(page.locator('#connection-diagnostics')).to_contain_text('POST /api/v1/auth/pair')
        assert 'A' * 26 not in page.locator('#connection-diagnostics').inner_text()
        page.get_by_label('Close dialog', exact=True).click()
        page.get_by_label('Backend status').click()
        expect(page.locator('#connection-diagnostics')).to_contain_text('HTTP 400')
        backend.pair_failure = False
        backend.ticket_failure = True
        page.locator('#pair-code').fill('A' * 26)
        page.locator('#device-name').fill('Fixture client')
        page.locator('button[form="pair-form"]').click()
        expect(page.get_by_role('dialog')).to_contain_text('Pairing diterima backend; koneksi workspace/telemetry belum selesai.')
        expect(page.locator('#connection-diagnostics')).to_contain_text('HTTP 403')
        expect(page.locator('#connection-stage')).to_have_text('Tiket WebSocket')
        page.get_by_role('button', name='Uji API tanpa pairing').click()
        expect(page.locator('#connection-diagnostics')).to_contain_text('API dapat dijangkau')
        expect(page.locator('#connection-diagnostics')).to_contain_text('HTTP 403')
        page.get_by_role('button', name='Salin laporan koneksi').click()
        expect(page.locator('#toast')).to_contain_text('Laporan koneksi disalin')
        report = page.evaluate('navigator.clipboard.readText()')
        assert 'HTTP 403' in report and 'fixture-access' not in report and 'fixture-refresh' not in report and 'A' * 26 not in report
        assert len([r for r in backend.requests if r[1] == '/api/v1/auth/pair']) == 2
        backend.ticket_failure = False
        page.get_by_role('button', name='Hubungkan ulang').click()
        expect(page.get_by_label('Backend status')).to_have_text('Terhubung', timeout=10000)

        # A changed request hash must never be approved using a modal that
        # showed the previous action, even if polling refreshed the list.
        page.get_by_label('Approvals and questions').click()
        page.locator('[data-action="approval"]').click()
        backend.approvals[0]['request_hash'] = 'fixture-hash-2'
        with page.expect_response(lambda response: response.url.endswith('/api/v1/approvals')) as synced:
            backend.event('APPROVAL_REQUESTED', {'interaction_id': 'fixture-approval'})
        assert synced.value.json()['items'][0]['request_hash'] == 'fixture-hash-2'
        page.locator('#approval-form select').select_option('approved')
        page.locator('#approval-form input[name="reason"]').fill('Fixture approval')
        page.locator('button[form="approval-form"]').click()
        expect(page.locator('#toast')).to_contain_text('Permintaan sudah berubah')
        assert not any('/decision' in path for _, path, _ in backend.requests)
        page.get_by_label('Close dialog', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_label('Approvals and questions').click()
        page.locator('[data-action="approval"]').click()
        page.locator('#approval-form select').select_option('approved')
        page.locator('#approval-form input[name="reason"]').fill('Reviewed updated fixture action')
        page.locator('button[form="approval-form"]').click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert any('/decision' in path for _, path, _ in backend.requests)

        def navigate(name):
            if mobile and page.locator('body').evaluate("el => el.classList.contains('chat-mode')"):
                page.get_by_label('Back to agents').click()
            nav = '.bottom-nav' if mobile else '.side-nav'
            page.locator(f'{nav} [data-page="{name}"]').first.click()

        navigate('nodes')
        expect(page.locator('.node-card')).to_have_count(2)
        expect(page.locator('.signal-note', has_text='Belum ada metrik')).to_have_count(2)
        pc = page.locator('.node-card[data-id="pc"]')
        expect(pc).to_contain_text('offline')
        pc.click()
        expect(page.get_by_role('dialog')).to_contain_text('No signal / Offline')
        expect(page.locator('[data-action="power-confirm"][data-command="shutdown"]')).to_be_disabled()
        page.get_by_label('Close dialog', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)

        navigate('agents')
        expect(page.locator('.agent-card')).to_have_count(1)
        filter_button = page.locator('[data-action="agent-filter"][data-filter="busy"]')
        filter_button.tap() if mobile else filter_button.click()
        expect(page.locator('.agent-card')).to_have_count(0)
        page.locator('[data-action="agent-filter"][data-filter="idle"]').click()
        expect(page.locator('.agent-card')).to_have_count(1)
        page.locator('[data-action="chat"]').click()
        expect(page.get_by_label('Send message')).to_be_enabled()
        page.locator('#chat-input').fill('Compile di PC, biarkan backend memilih target')
        page.get_by_label('Send message').click()
        expect(page.locator('.message')).to_have_count(1)
        backend.event('MESSAGE_DELTA', {'session_id': 'fixture-session', 'message_id': 'fixture-reply', 'delta': 'Jawaban '})
        expect(page.locator('.message').last).to_contain_text('Jawaban')
        backend.messages.append({'id': 'fixture-reply', 'session_id': 'fixture-session', 'seq_no': '2', 'sender_kind': 'agent', 'sender_id': 'main', 'content': 'Jawaban dari backend fixture', 'status': 'complete', 'created_at': '2026-10-25T07:01:00Z'})
        backend.event('MESSAGE_FINAL', {'session_id': 'fixture-session', 'message_id': 'fixture-reply'})
        expect(page.locator('.message').last).to_contain_text('Jawaban dari backend fixture')
        expect(page.locator('.message')).to_have_count(2)

        navigate('overview')
        page.get_by_label('Create new mission').click()
        page.locator('#mission-title').fill('Fixture mission')
        page.locator('#mission-prompt').fill('Compile di PC sesuai scheduler')
        page.locator('button[form="mission-form"]').click()
        expect(page.locator('.mission-card h2')).to_have_text('Fixture mission')

        backend.event('TOOL_EXEC', {'task_id': 'fixture-task', 'content': '<script>window.fixtureInjected=true</script>'}, 'fixture-trace-event')
        navigate('swarm')
        page.locator('[data-action="event-filter"][data-filter="TOOL"]').click()
        expect(page.locator('.feed-item')).to_have_count(1)
        page.locator('[data-action="event"][data-id="fixture-trace-event"]').click()
        expect(page.get_by_role('dialog')).to_contain_text('<script>window.fixtureInjected=true</script>')
        assert page.evaluate('window.fixtureInjected') is None
        page.locator('[data-action="traces"]').click()
        page.locator('[data-action="logs"]').click()
        expect(page.locator('#log-content')).to_contain_text('Output recorded by fixture worker')
        page.get_by_label('Close dialog', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)

        navigate('nodes')
        backend.nodes[1].update({'status': 'online', 'accepting_tasks': True, 'metrics': {'cpu_percent': 73}, 'metrics_stale': False, 'last_seen_at': '2026-10-25T07:01:00Z'})
        backend.event('NODE_HEALTH', {'node_id': 'pc'})
        expect(pc).to_contain_text('73')
        expect(pc).to_contain_text('online')
        backend.health = False
        backend.sockets[-1].close()
        expect(page.get_by_label('Backend status')).not_to_have_text('Terhubung')
        expect(page.locator('.stale-note')).to_be_visible()
        expect(page.locator('.node-card')).to_have_count(2)
        assert not errors, errors
        assert not any('/power' in path for _, path, _ in backend.requests), 'No power operation should have been sent'
        print(f'PASS {"Android viewport/touch" if mobile else "Windows viewport"}: clipboard pairing normalization without truncation, invalid input blocked, build identity, health probe, persistent pairing/telemetry errors, pairing, null metrics/offline PC, filters, chat, missions, escaped payload, traces/logs, metric updates, stale state')
        context.close()
    browser.close()
