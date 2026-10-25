import { hermesApi as api, items } from './api_client.js';
import { Workspace, metricRows } from './workspace.js';
import { $, esc } from './ui.js';
import { render, connectionBody, actionButton, time, stageText } from './views.js';
import { formatApiError } from './diagnostics.js';
import { BUILD_INFO } from './build_info.js';
import { normalizePairingInput } from './pairing.js';
import { AppUpdater } from './app_updater.js';
import { updateBody, updateFooter } from './update_views.js';
import { themeManager } from './theme_manager.js';

const workspace = new Workspace(api);
const updater = new AppUpdater();
const ui = { page: 'overview', agentId: null, sessionId: null, agentFilter: 'all', eventFilter: 'all', target: 'auto', draft: '', error: '', pending: new Set(), logTraceId: null, connectionDiagnostic: '', themePanelOpen: false, missionDetailId: null };
let logTimer;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function paint() {
  const focus = document.activeElement;
  const id = focus?.id;
  const selection = focus?.selectionStart;
  const chat = $('#chat-messages');
  const follow = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  const scroll = chat?.scrollTop;
  document.body.classList.toggle('chat-mode', ui.page === 'chat');
  $('#app').innerHTML = render(workspace.state, ui, api, workspace.writable);
  const replacement = id ? document.getElementById(id) : null;
  if (replacement && !replacement.disabled) {
    replacement.focus({ preventScroll: true });
    if (typeof selection === 'number' && replacement.setSelectionRange) replacement.setSelectionRange(selection, selection);
  }
  const nextChat = $('#chat-messages');
  if (nextChat) nextChat.scrollTop = follow ? nextChat.scrollHeight : scroll || 0;
  window.HermesUI.paint({ page: ui.page, agent: ui.agentId, messageCount: workspace.state.messages[ui.sessionId]?.length || 0, feedId: workspace.state.events[0]?.event_id || '' });
}
function close() { ui.logTraceId = null; clearTimeout(logTimer); window.HermesUI.closeSheet(); }
function sheet(title, description, body, footer = '', wide = false) {
  ui.logTraceId = null;
  window.HermesUI.openSheet({ title: esc(title), subtitle: esc(description), body, footer, wide, onDismiss: () => { ui.logTraceId = null; } });
}
async function run(key, task) {
  if (ui.pending.has(key)) return;
  ui.pending.add(key);
  ui.error = '';
  paint();
  try { await task(); } catch (error) {
    ui.error = formatApiError(error);
    notify(ui.error);
    if ($('#connection-diagnostics')) {
      ui.connectionDiagnostic = ui.error;
      $('#connection-diagnostics').textContent = ui.error;
    }
  } finally { ui.pending.delete(key); paint(); }
}
function connection() {
  const footer = api.accessToken && workspace.state.status !== 'auth_required'
    ? `${actionButton('reconnect', 'Hubungkan ulang')}${actionButton('revoke-confirm', 'Cabut akses perangkat')}${actionButton('forget-confirm', 'Hapus sesi lokal')}`
    : '<button class="primary-button" type="submit" form="pair-form">Pasangkan perangkat</button>';
  const diagnostic = [...new Set([ui.connectionDiagnostic, workspace.state.error].filter(Boolean))].join('\n');
  sheet('Server & jaringan', 'LAN langsung atau subnet Tailscale melalui Proxmox', connectionBody(api, workspace.state, diagnostic), `${actionButton('test-connection', 'Uji API tanpa pairing')}${actionButton('copy-connection', 'Salin laporan koneksi')}${footer}`);
  window.HermesNative.getRuntimeInfo().then(info => {
    const element = $('#native-build-info');
    if (element) element.textContent = `${info.platform} · ${info.version} · ${info.commit || 'commit tidak tersedia'} · build ${info.build_run || 'tidak tersedia'}`;
    const versionMismatch = info.version && BUILD_INFO.version !== 'development' && info.version !== BUILD_INFO.version;
    const commitMismatch = info.commit && info.commit !== 'local' && BUILD_INFO.commit !== 'local' && info.commit !== BUILD_INFO.commit;
    if ((versionMismatch || commitMismatch) && $('#connection-diagnostics')) {
      ui.connectionDiagnostic = 'Identitas frontend dan runtime berbeda. Tutup aplikasi dan pasang installer dari build yang sama.';
      $('#connection-diagnostics').textContent = ui.connectionDiagnostic;
    }
  }).catch(() => { if ($('#native-build-info')) $('#native-build-info').textContent = 'Identitas runtime belum dapat dibaca.'; });
}
function appUpdates() {
  sheet('Pembaruan aplikasi', 'Release resmi Hermes Cockpit', updateBody(updater.state), updateFooter(updater.state));
}
let updatePaint;
updater.subscribe(state => {
  ui.updateReady = ['available', 'ready'].includes(state.status);
  if (!updatePaint) updatePaint = setTimeout(() => {
    updatePaint = null;
    paint();
    if ($('#updates-panel')) {
      document.querySelector('.sheet-body').innerHTML = updateBody(updater.state);
      document.querySelector('.sheet-footer').innerHTML = updateFooter(updater.state);
    }
  }, 100);
});
function nodeDetail(id) {
  const node = workspace.state.nodes.find(n => n.id === id);
  if (!node) return;
  const metrics = metricRows(node);
  const offline = node.status === 'offline';
  const rows = metrics.map(([key, value]) => `<div class="metric-line"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`).join('');
  const powers = node.os === 'windows' ? `<div class="sheet-section-title">Daya perangkat</div><div class="live-actions">${['sleep', 'shutdown', 'reboot'].map(command => actionButton('power-confirm', command, `data-id="${esc(id)}" data-command="${command}"`, !workspace.writable || offline)).join('')}</div><p class="muted">Perintah mengikuti otorisasi dan persetujuan backend. Status berubah setelah laporan worker. ${node.wake_supported ? 'Kemampuan wake dilaporkan server; tindakan wake belum tersedia pada kontrak client ini.' : 'Wake-on-LAN belum tersedia.'}</p>` : '';
  sheet(node.name || node.id, `${node.lan_ip || ''} · ${node.status || 'Tidak diketahui'}`, `<div class="notice">${metrics.length ? node.metrics_stale || workspace.state.status !== 'connected' ? 'Metrik terakhir · data lama' : 'Metrik yang dilaporkan perangkat' : offline ? 'No signal / Offline · worker belum mengirim metrik.' : 'Belum ada metrik · collector perangkat belum mengirim data hardware.'}</div>${rows}<p>Terakhir terlihat: ${esc(time(node.last_seen_at))}</p><p>Tools aktif: ${esc(node.active_tools ?? '—')} / ${esc(node.max_parallel_tools ?? '—')}</p><div class="sheet-section-title">Kemampuan dari backend</div><div class="tool-tags">${(node.effective_capabilities || []).map(c => `<span>${esc(c)}</span>`).join('') || '<span>Belum dilaporkan</span>'}</div>${powers}`, actionButton('diagnostics', 'Jalankan diagnostik', `data-id="${esc(id)}"`, !workspace.writable || offline));
}
function newMission() {
  workspace.requireOnline();
  sheet('New mission', 'Misi dijadwalkan oleh backend Hermes.', `<form id="mission-form"><label class="field"><span class="field-label">Nama misi</span><input name="title" id="mission-title" required maxlength="90"></label><label class="field"><span class="field-label">Tujuan dan kriteria hasil</span><textarea name="prompt" id="mission-prompt" required maxlength="3000"></textarea></label><label class="field"><span class="field-label">Target eksekusi</span><select name="target"><option value="auto">Auto · dipilih backend</option>${workspace.state.nodes.map(n => `<option value="${esc(n.id)}" ${n.status === 'offline' || !n.accepting_tasks ? 'disabled' : ''}>${esc(n.name || n.id)} · ${esc(n.status)}</option>`).join('')}</select></label></form>`, '<button class="primary-button" type="submit" form="mission-form">Buat misi</button>');
}
function inbox() {
  const s = workspace.state;
  sheet('Persetujuan & pertanyaan', 'Tanggapan Anda diteruskan ke backend.', `<h3>Persetujuan</h3>${s.sectionErrors.approvals ? `<p class="notice">${esc(s.sectionErrors.approvals)}</p>` : ''}${s.approvals.map(a => `<div class="interaction-card"><strong>${esc(a.title || a.action || 'Persetujuan tindakan')}</strong><pre>${esc(JSON.stringify(a.request || a.payload || a, null, 2))}</pre>${actionButton('approval', 'Tinjau', `data-id="${esc(a.interaction_id || a.id)}"`, !a.request_hash || !workspace.writable)}</div>`).join('') || '<p>Belum ada persetujuan menunggu.</p>'}<h3>Pertanyaan</h3>${s.sectionErrors.questions ? `<p class="notice">${esc(s.sectionErrors.questions)}</p>` : ''}${s.questions.map(q => `<div class="interaction-card"><p>${esc(q.question || q.prompt || q.title || 'Pertanyaan agen')}</p>${actionButton('question', 'Jawab', `data-id="${esc(q.interaction_id || q.id)}"`, !q.request_hash || !workspace.writable)}</div>`).join('') || '<p>Belum ada pertanyaan menunggu.</p>'}`);
}
async function loadLogs(id) {
  const logs = await api.getLogs(id);
  if (ui.logTraceId !== id) return;
  const text = items(logs?.chunks).slice().sort((a, b) => a.seq - b.seq).map(chunk => `[${chunk.stream}] ${chunk.content}`).join('');
  const pre = $('#log-content');
  if (pre) pre.textContent = text || 'Belum ada log dari backend.';
  const status = $('#log-status');
  if (status) status.textContent = logs.truncated ? 'Log dipotong oleh backend.' : 'Log dari backend.';
}
workspace.subscribe(() => {
  paint();
  if ($('#connection-stage')) $('#connection-stage').textContent = stageText(workspace.state.connectionStage);
  if ($('#connection-diagnostics') && workspace.state.error) {
    $('#connection-diagnostics').textContent = [...new Set([ui.connectionDiagnostic, workspace.state.error].filter(Boolean))].join('\n');
  }
  const event = workspace.state.events[0];
  if (ui.logTraceId && event?.event_type === 'TOOL_LOG_CHUNK' && event.payload?.trace_id === ui.logTraceId) {
    clearTimeout(logTimer);
    logTimer = setTimeout(() => loadLogs(ui.logTraceId).catch(error => notify(error.message)), 200);
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'pair-code') normalizePairingInput(event.target);
  if (event.target.id === 'chat-input') ui.draft = event.target.value;
});
document.addEventListener('change', event => {
  if (event.target.id === 'pair-code') normalizePairingInput(event.target);
  if (event.target.id === 'chat-route') ui.target = event.target.value;
});
document.addEventListener('click', event => {
  if (event.target.id === 'overlay-backdrop') { close(); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, command } = button.dataset;
  if (action === 'close') { close(); return; }
  if (action === 'dismiss-error') { ui.error = ''; paint(); return; }
  if (action === 'navigate') { close(); ui.page = button.dataset.page; paint(); window.scrollTo(0, 0); return; }
  if (action === 'connection') { connection(); return; }
  if (action === 'app-updates') { appUpdates(); return; }
  if (action === 'inbox') { inbox(); return; }
  if (action === 'theme-panel') { ui.themePanelOpen = true; paint(); return; }
  if (action === 'theme-dismiss') { ui.themePanelOpen = false; paint(); return; }
  if (action === 'theme-select') { const themeId = button.dataset.themeId; if (themeId) themeManager.setTheme(themeId); paint(); return; }
  if (action === 'theme-reset') { themeManager.setTheme('ocean-mist'); paint(); return; }
  if (action === 'sheet-dismiss') { if (ui.missionDetailId) { ui.missionDetailId = null; paint(); return; } }
  if (action === 'mission-detail') {
    const missionId = button.dataset.missionId || id;
    ui.missionDetailId = missionId;
    paint();
    if (api.getMission) {
      api.getMission(missionId).then(detail => {
        if (detail && ui.missionDetailId === missionId) {
          workspace.state.missionDetailsById[missionId] = detail;
          paint();
        }
      }).catch(() => {});
    }
    return;
  }
  if (action === 'agent-filter') { ui.agentFilter = button.dataset.filter; paint(); return; }
  if (action === 'event-filter') { ui.eventFilter = button.dataset.filter; paint(); return; }
  run(action, async () => {
    if (action === 'update-check') await updater.check();
    if (action === 'update-download') await updater.download();
    if (action === 'update-confirm') sheet('Pasang pembaruan?', updater.state.version || '', `<p>${updater.state.platform === 'android' ? 'Android akan meminta konfirmasi untuk memperbarui aplikasi.' : 'Aplikasi akan ditutup sebentar, diperbarui, lalu dibuka kembali.'}</p>${ui.draft ? '<p>Pesan yang belum dikirim akan hilang saat aplikasi ditutup.</p>' : ''}`, actionButton('update-install', 'Pasang sekarang'));
    if (action === 'update-install') { appUpdates(); await updater.install(); }
    if (action === 'test-connection') {
      if ($('#connection-diagnostics')) $('#connection-diagnostics').textContent = 'Memeriksa GET /health/ready tanpa mengirim kode pairing…';
      const health = await api.getHealth();
      ui.connectionDiagnostic = health?.status === 'ok'
        ? `API dapat dijangkau. Status: ok; service: ${health.service || 'tidak dilaporkan'}; versi backend: ${health.version || 'tidak dilaporkan'}. [GET /health/ready]`
        : 'API merespons, tetapi format/status health belum menunjukkan siap. [GET /health/ready]';
      if ($('#connection-diagnostics')) $('#connection-diagnostics').textContent = [ui.connectionDiagnostic, workspace.state.error].filter(Boolean).join('\n');
    }
    if (action === 'copy-connection') {
      const info = await window.HermesNative.getRuntimeInfo();
      const text = [
        `Client: ${BUILD_INFO.version} ${BUILD_INFO.commit} build ${BUILD_INFO.run || 'local'}`,
        `Runtime: ${info.platform} ${info.version} ${info.commit || 'unknown'} build ${info.build_run || 'local'}`,
        `API: ${api.baseUrl}`,
        `Status: ${workspace.state.status}; tahap: ${stageText(workspace.state.connectionStage)}`,
        `Pairing tersimpan: ${Boolean(api.accessToken)}`,
        $('#connection-diagnostics')?.textContent || 'Belum ada hasil diagnostik.'
      ].join('\n');
      await window.HermesNative.copyText(text);
      notify('Laporan koneksi disalin tanpa kode pairing atau token.');
    }
    if (action === 'refresh') { await workspace.refresh(); notify('Snapshot diperbarui dari backend.'); }
    if (action === 'reconnect') { close(); await workspace.connect(); }
    if (action === 'node-detail') nodeDetail(id);
    if (action === 'new-mission') newMission();
    if (action === 'agent-profile') {
      const agent = workspace.state.agents.find(a => a.id === id);
      if (agent) sheet(agent.name || agent.id, agent.role || '', `<p class="profile-instructions">${esc(agent.instructions || 'Instruksi belum tersedia.')}</p><p>Node affinity: ${esc(agent.node_affinity || 'Tidak dilaporkan')}</p>`);
    }
    if (action === 'chat') {
      close();
      ui.page = 'chat'; ui.agentId = id; ui.sessionId = null; ui.loadingChat = true; ui.draft = '';
      paint();
      try {
        const sessionId = await workspace.session(id);
        if (ui.agentId === id && ui.page === 'chat') ui.sessionId = sessionId;
      } finally { ui.loadingChat = false; }
    }
    if (action === 'revoke-confirm') sheet('Cabut akses perangkat?', 'Sesi perangkat ini akan dicabut di server.', '<p>Perangkat ini perlu dipasangkan kembali setelah pencabutan berhasil.</p>', actionButton('revoke', 'Cabut akses'));
    if (action === 'revoke') { await api.revoke(); workspace.disconnect(); close(); ui.page = 'overview'; ui.sessionId = null; ui.draft = ''; }
    if (action === 'forget-confirm') sheet('Hapus sesi lokal?', 'Akses pada server tidak dicabut oleh tindakan ini.', '<p>Hanya kredensial pada aplikasi ini yang dihapus. Gunakan pencabutan akses jika server dapat dijangkau.</p>', actionButton('forget', 'Hapus sesi lokal'));
    if (action === 'forget') { api.clearTokens(); workspace.disconnect(); close(); ui.page = 'overview'; ui.sessionId = null; ui.draft = ''; }
    if (action === 'mission-action' || action === 'mission-cancel-execute') {
      workspace.requireOnline();
      await api.missionAction(id, action === 'mission-cancel-execute' ? 'cancel' : command);
      close(); await workspace.refresh(); notify('Perubahan misi dikirim ke backend.');
    }
    if (action === 'mission-cancel') sheet('Batalkan misi?', 'Tindakan dikirim ke scheduler backend.', '<p>Tugas yang sedang berjalan akan mengikuti kebijakan pembatalan backend.</p>', actionButton('mission-cancel-execute', 'Batalkan misi', `data-id="${esc(id)}"`));
    if (action === 'diagnostics') {
      workspace.requireOnline();
      const result = await api.diagnostics(id);
      sheet('Diagnostik perangkat', 'Respons backend; hasil tidak disimulasikan.', `<pre>${esc(JSON.stringify(result, null, 2))}</pre>`);
      await workspace.refresh();
    }
    if (action === 'power-confirm') {
      workspace.requireOnline();
      sheet(`Konfirmasi ${command}`, 'Perintah akan dikirim ke PC Windows.', `<form id="power-form" data-id="${esc(id)}" data-command="${esc(command)}"><p>Backend akan menunggu tugas selesai (drain) dan menerapkan persetujuan yang diperlukan.</p><label class="field"><span class="field-label">Ketik ${esc(command.toUpperCase())} untuk melanjutkan</span><input name="proof" required pattern="${esc(command.toUpperCase())}" autocomplete="off"></label><label class="field"><span class="field-label">Alasan</span><input name="reason" required maxlength="500"></label></form>`, '<button class="primary-button" type="submit" form="power-form">Kirim permintaan</button>');
    }
    if (action === 'event') {
      const record = workspace.state.events.find(e => e.event_id === id);
      if (!record) return;
      const task = record.payload?.task_id || record.payload?.task?.id;
      sheet(record.event_type, time(record.timestamp), `<pre>${esc(JSON.stringify(record, null, 2))}</pre>`, `${actionButton('copy-event', 'Salin payload', `data-id="${esc(id)}"`)}${task ? actionButton('traces', 'Lihat traces', `data-id="${esc(task)}"`) : ''}`, true);
    }
    if (action === 'copy-event') {
      const record = workspace.state.events.find(e => e.event_id === id);
      if (record) { await window.HermesNative.copyText(JSON.stringify(record, null, 2)); notify('Payload disalin.'); }
    }
    if (action === 'traces') {
      const traces = items(await api.getTraces(id));
      sheet('Tool traces', `Task ${id}`, traces.map(t => `<div class="interaction-card"><strong>${esc(t.tool_name || t.name || t.id)}</strong><p>${esc(t.status || '')}</p>${actionButton('logs', 'Lihat log', `data-id="${esc(t.id || t.trace_id)}"`)}</div>`).join('') || '<p>Belum ada trace dari backend.</p>', '', true);
    }
    if (action === 'logs') {
      sheet('Execution logs', `Trace ${id}`, '<p id="log-status">Memuat log…</p><pre id="log-content"></pre>', actionButton('refresh-logs', 'Perbarui log', `data-id="${esc(id)}"`), true);
      ui.logTraceId = id; await loadLogs(id);
    }
    if (action === 'refresh-logs') await loadLogs(id);
    if (action === 'approval') {
      const record = workspace.state.approvals.find(a => (a.interaction_id || a.id) === id);
      if (!record?.request_hash) throw new Error('Proof permintaan tidak tersedia. Sinkronkan ulang sebelum memutuskan.');
      sheet('Tinjau persetujuan', 'Keputusan terikat pada request hash dari backend.', `<pre>${esc(JSON.stringify(record.request || record.payload || record, null, 2))}</pre><form id="approval-form" data-id="${esc(id)}" data-request-hash="${esc(record.request_hash)}"><label class="field"><span class="field-label">Keputusan</span><select name="decision"><option value="rejected">Tolak</option><option value="approved">Setujui</option></select></label><label class="field"><span class="field-label">Alasan</span><input name="reason" required maxlength="500"></label></form>`, '<button class="primary-button" type="submit" form="approval-form">Kirim keputusan</button>', true);
    }
    if (action === 'question') {
      const record = workspace.state.questions.find(q => (q.interaction_id || q.id) === id);
      if (!record?.request_hash) throw new Error('Proof pertanyaan tidak tersedia. Sinkronkan ulang sebelum menjawab.');
      sheet('Pertanyaan agen', '', `<p>${esc(record.question || record.prompt || record.title)}</p><form id="question-form" data-id="${esc(id)}" data-request-hash="${esc(record.request_hash)}"><label class="field"><span class="field-label">Jawaban</span><textarea name="answer" required maxlength="3000"></textarea></label></form>`, '<button class="primary-button" type="submit" form="question-form">Kirim jawaban</button>');
    }
  });
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!['pair-form', 'chat-form', 'mission-form', 'power-form', 'approval-form', 'question-form'].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  const id = form.dataset.id;
  // Disable modal submit immediately; app repaint does not replace the dialog.
  const submit = document.querySelector(`button[form="${form.id}"]`);
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  run(form.id === 'chat-form' ? 'send' : form.id, async () => {
    try {
      if (form.id === 'pair-form') {
        if ($('#connection-diagnostics')) $('#connection-diagnostics').textContent = 'Mengirim pairing ke API…';
        await api.pair(data.get('code'), data.get('device'));
        ui.connectionDiagnostic = 'Pairing diterima backend. Memeriksa workspace dan telemetry…';
        form.reset();
        await workspace.connect();
        if (workspace.state.status === 'connected') { ui.connectionDiagnostic = ''; close(); }
        else { ui.connectionDiagnostic = 'Pairing diterima backend; koneksi workspace/telemetry belum selesai.'; connection(); }
      } else {
        workspace.requireOnline();
        if (form.id === 'chat-form') {
          const text = String(data.get('content') || '').trim();
          if (!text) return;
          await workspace.send(ui.sessionId, text, String(data.get('target')));
          ui.draft = '';
        }
        if (form.id === 'mission-form') {
          await api.createMission(String(data.get('title')).trim(), String(data.get('prompt')).trim(), String(data.get('target')));
          close(); await workspace.refresh(); notify('Misi diterima backend.');
        }
        if (form.id === 'power-form') {
          if (data.get('proof') !== form.dataset.command.toUpperCase()) throw new Error('Konfirmasi tindakan belum sesuai.');
          await api.power(id, form.dataset.command, String(data.get('reason')));
          close(); await workspace.refresh(); notify('Permintaan daya dikirim. Tunggu persetujuan atau laporan worker.');
        }
        if (form.id === 'approval-form') {
          const record = workspace.state.approvals.find(a => (a.interaction_id || a.id) === id);
          if (!record?.request_hash || record.request_hash !== form.dataset.requestHash) throw new Error('Permintaan sudah berubah; tutup dialog dan tinjau ulang.');
          await api.decide(id, record.request_hash, String(data.get('decision')), String(data.get('reason')));
          close(); await workspace.refresh();
        }
        if (form.id === 'question-form') {
          const record = workspace.state.questions.find(q => (q.interaction_id || q.id) === id);
          if (!record?.request_hash || record.request_hash !== form.dataset.requestHash) throw new Error('Pertanyaan sudah berubah; tutup dialog dan tinjau ulang.');
          await api.answer(id, record.request_hash, String(data.get('answer')));
          close(); await workspace.refresh();
        }
      }
    } finally { if (submit?.isConnected) submit.disabled = false; }
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') close();
  const dialog = document.querySelector('[role="dialog"]');
  if (event.key === 'Tab' && dialog) {
    const focusable = [...dialog.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length && !el.closest('[inert]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('online', () => { if (api.accessToken) workspace.connect(); });
window.addEventListener('online', () => updater.check());
window.addEventListener('beforeunload', () => updater.dispose());
window.addEventListener('offline', () => { workspace.state.status = 'offline'; workspace.state.error = 'Perangkat tidak memiliki koneksi jaringan.'; workspace.emit(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && api.accessToken) workspace.connect(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!updater.state.checkedAt || Date.now() - new Date(updater.state.checkedAt).getTime() > updater.interval)) updater.check();
});
updater.start();
paint();
workspace.connect();
