import { SERVER_URL, httpFetch, openSocket } from './transport.js';
import { isTauri } from '@tauri-apps/api/core';
import { transportFailure, redactDiagnostic } from './diagnostics.js';
import { normalizePairingCode, pairingCodeError } from './pairing.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', retryable = false, details = {}, endpoint, method } = {}) {
    super(message);
    Object.assign(this, { name: 'ApiError', status, code, retryable, details, endpoint, method });
  }
}
const AUTH_KEY = 'hermes_auth_v2';
export const items = value => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  throw new ApiError('Format daftar dari backend tidak sesuai kontrak.', { code: 'INVALID_RESPONSE' });
};
export const sequence = value => typeof value === 'string' && /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : null;
export const compareSequence = (a, b) => {
  const x = sequence(a), y = sequence(b);
  if (x === null || y === null) throw new Error('Invalid event sequence');
  return x.length === y.length ? (x < y ? -1 : x > y ? 1 : 0) : (x.length < y.length ? -1 : 1);
};

export class HermesApiClient {
  constructor({ baseUrl = SERVER_URL, storage = globalThis.localStorage, fetcher = httpFetch, socketFactory = openSocket, timeout = 12000, retryDelay = 1000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    Object.assign(this, { storage, fetcher, socketFactory, timeout, retryDelay });
    this.auth = null;
    this.lastEventSeq = '0';
    this.generation = 0;
    this.authEpoch = 0;
    this.seen = new Set();
    try {
      const saved = JSON.parse(storage?.getItem(AUTH_KEY) || 'null');
      if (saved?.server === this.baseUrl && saved.access_token && saved.refresh_token) this.auth = saved;
    } catch { /* Old demo caches are not workspace snapshots. */ }
  }
  get accessToken() { return this.auth?.access_token || null; }
  get workspaceId() { return this.auth?.workspace_id || null; }
  get deviceId() { return this.auth?.device_id || null; }
  setTokens(value) {
    if (!value?.access_token || !value?.refresh_token || !value?.workspace_id || !value?.device_id) {
      throw new ApiError('Respons autentikasi tidak lengkap.', { code: 'INVALID_RESPONSE' });
    }
    this.auth = { ...value, server: this.baseUrl };
    try { this.storage?.setItem(AUTH_KEY, JSON.stringify(this.auth)); } catch { /* Current session still works. */ }
  }
  clearTokens() {
    this.authEpoch++;
    this.stopTelemetry();
    this.auth = null;
    this.lastEventSeq = '0';
    this.seen.clear();
    try {
      this.storage?.removeItem(AUTH_KEY);
      for (const name of ['hermes_access_token', 'hermes_refresh_token', 'hermes_workspace_id', 'hermes_device_id']) this.storage?.removeItem(name);
    } catch { /* Memory is already cleared. */ }
  }
  async raw(endpoint, options = {}, authenticated = true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    if (authenticated && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    try {
      const response = await this.fetcher(`${this.baseUrl}${endpoint}`, { ...options, headers, signal: controller.signal });
      const text = await response.text();
      let value = null;
      try { value = text ? JSON.parse(text) : null; } catch {
        throw new ApiError('Server tidak mengembalikan JSON Hermes.', { status: response.status, code: 'INVALID_RESPONSE' });
      }
      if (!response.ok) throw new ApiError(value?.error?.message || `Permintaan gagal (HTTP ${response.status}).`, {
        status: response.status, code: value?.error?.code || 'HTTP_ERROR', retryable: value?.error?.retryable === true, details: value?.error?.details || {}
      });
      return value;
    } catch (error) {
      const mutation = options.method && !['GET', 'HEAD'].includes(options.method);
      const diagnostic = error instanceof ApiError ? error : (() => {
        const value = transportFailure(error, { timedOut: controller.signal.aborted, mutation, native: isTauri() });
        return new ApiError(value.message, value);
      })();
      let body;
      try { body = JSON.parse(options.body || '{}'); } catch { body = {}; }
      diagnostic.message = redactDiagnostic(diagnostic.message, [this.accessToken, this.auth?.refresh_token, body.pairing_code, body.refresh_token, body.access_token]);
      diagnostic.endpoint = endpoint.split('?')[0];
      diagnostic.method = options.method || 'GET';
      throw diagnostic;
    } finally { clearTimeout(timer); }
  }
  async request(endpoint, options = {}) {
    const tokenUsed = this.accessToken;
    try { return await this.raw(endpoint, options); } catch (error) {
      if (error.status !== 401 || !this.auth?.refresh_token) throw error;
      // Parallel 401s share one rotating refresh; late responses reuse its result.
      if (this.accessToken === tokenUsed) await this.refreshToken();
      try { return await this.raw(endpoint, options); } catch (retried) {
        if (retried.status === 401) this.clearTokens();
        throw retried;
      }
    }
  }
  async refreshToken() {
    if (this.refreshing) return this.refreshing;
    if (!this.auth?.refresh_token) throw new ApiError('Pasangkan perangkat terlebih dahulu.', { status: 401, code: 'UNPAIRED' });
    if (this.auth.refresh_uncertain) throw new ApiError('Hasil rotasi token sebelumnya belum diketahui. Pasangkan ulang perangkat agar token lama tidak dipakai kembali.', { code: 'REFRESH_UNCERTAIN' });
    const refreshToken = this.auth.refresh_token;
    const epoch = this.authEpoch;
    this.refreshing = (async () => {
      try {
        const value = await this.raw('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false);
        if (epoch !== this.authEpoch) throw new ApiError('Sesi sudah ditutup.', { code: 'SESSION_CLOSED' });
        this.setTokens(value);
      } catch (error) {
        if (epoch !== this.authEpoch) throw error;
        if ([400, 401, 403].includes(error.status) || error.code === 'TOKEN_REUSE_DETECTED') this.clearTokens();
        else if ((error.status === 0 || error.code === 'INVALID_RESPONSE') && this.auth) {
          this.auth.refresh_uncertain = true;
          try { this.storage?.setItem(AUTH_KEY, JSON.stringify(this.auth)); } catch { /* Keep uncertainty in memory. */ }
        }
        throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async pair(pairingCode, deviceName) {
    const code = normalizePairingCode(pairingCode);
    const invalid = pairingCodeError(code);
    if (invalid) throw new ApiError(invalid, { code: 'INVALID_PAIRING_CODE' });
    const name = deviceName.trim();
    if (!name || name.length > 100) throw new ApiError('Nama perangkat harus berisi 1–100 karakter.', { code: 'INVALID_DEVICE_NAME' });
    this.stopTelemetry();
    const epoch = ++this.authEpoch;
    const value = await this.raw('/api/v1/auth/pair', { method: 'POST', body: JSON.stringify({ pairing_code: code, device_name: name }) }, false);
    if (epoch !== this.authEpoch) throw new ApiError('Pairing dibatalkan.', { code: 'SESSION_CLOSED' });
    this.setTokens(value);
  }
  async revoke() {
    await this.request('/api/v1/auth/revoke', { method: 'POST', body: '{}' });
    this.clearTokens();
  }
  getHealth() { return this.raw('/health/ready', {}, false); }
  getBootstrap() { return this.request('/api/v1/bootstrap'); }
  getNodes() { return this.request('/api/v1/nodes'); }
  getNode(id) { return this.request(`/api/v1/nodes/${encodeURIComponent(id)}`); }
  getSessions() { return this.request('/api/v1/sessions'); }
  createSession(agentId, title = 'Direct chat') { return this.request('/api/v1/sessions', { method: 'POST', body: JSON.stringify({ agent_id: agentId, title, reuse_active: true }) }); }
  getMessages(id) { return this.request(`/api/v1/sessions/${encodeURIComponent(id)}/messages`); }
  sendMessage(id, content, target) { return this.request(`/api/v1/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content, execution: { target_node: target } }) }); }
  getMissions() { return this.request('/api/v1/missions'); }
  createMission(title, prompt, target) { return this.request('/api/v1/missions', { method: 'POST', body: JSON.stringify({ title, prompt, project_id: null, execution: { target_node: target }, token_budget: 200000 }) }); }
  missionAction(id, action) {
    if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('Invalid mission action');
    return this.request(`/api/v1/missions/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
  }
  diagnostics(id) { return this.request(`/api/v1/nodes/${encodeURIComponent(id)}/diagnostics`, { method: 'POST', body: '{}' }); }
  power(id, action, reason) {
    if (!['sleep', 'shutdown', 'reboot'].includes(action)) throw new Error('Invalid power action');
    return this.request(`/api/v1/nodes/${encodeURIComponent(id)}/power`, { method: 'POST', body: JSON.stringify({ action, drain: true, reason }) });
  }
  getTraces(id) { return this.request(`/api/v1/tasks/${encodeURIComponent(id)}/traces`); }
  getLogs(id) { return this.request(`/api/v1/traces/${encodeURIComponent(id)}/logs`); }
  getApprovals() { return this.request('/api/v1/approvals'); }
  getQuestions() { return this.request('/api/v1/questions'); }
  decide(id, hash, decision, reason) { return this.request(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, request_hash: hash, reason }) }); }
  answer(id, hash, answer) { return this.request(`/api/v1/questions/${encodeURIComponent(id)}/answer`, { method: 'POST', body: JSON.stringify({ request_hash: hash, answer }) }); }

  stopTelemetry() {
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) Promise.resolve(socket.close()).catch(() => {});
  }
  startTelemetry({ onEvent, onStatus, beforeConnect = async () => {}, onStage = () => {} }) {
    this.stopTelemetry();
    const generation = this.generation;
    let attempts = 0;
    let connectionEpoch = 0;
    const current = () => generation === this.generation && Boolean(this.accessToken);
    const reconnect = () => {
      if (!current() || this.reconnectTimer) return;
      connectionEpoch++;
      clearInterval(this.pingTimer);
      const previous = this.socket;
      this.socket = null;
      onStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        connect();
      }, Math.min(this.retryDelay * 2 ** Math.min(attempts++, 5), 30000));
      if (previous) Promise.resolve(previous.close()).catch(() => {});
    };
    const connect = async () => {
      if (!current()) return;
      const attempt = ++connectionEpoch;
      try {
        await beforeConnect();
        if (!current()) { if (!this.accessToken) onStatus('auth_required'); return; }
        onStage('ticket');
        const ticket = await this.request('/api/v1/auth/ws-ticket', { method: 'POST', body: '{}' });
        if (typeof ticket?.ticket !== 'string' || ticket.subprotocol !== 'hermes.telemetry.v1') throw new ApiError('Tiket telemetry tidak valid.', { code: 'INVALID_RESPONSE', endpoint: '/api/v1/auth/ws-ticket', method: 'POST' });
        if (!current()) { if (!this.accessToken) onStatus('auth_required'); return; }
        const url = `${this.baseUrl.replace(/^http/, 'ws')}/ws/telemetry?ticket=${encodeURIComponent(ticket.ticket)}&after_seq=${encodeURIComponent(this.lastEventSeq)}`;
        let closed = false;
        onStage('telemetry');
        const socket = await this.socketFactory(url, ticket.subprotocol, {
          close: () => { closed = true; if (attempt === connectionEpoch) reconnect(); },
          message: text => {
            if (!current() || attempt !== connectionEpoch || text === 'pong') return;
            let event;
            try { event = JSON.parse(text); } catch { return; }
            const seq = sequence(event.seq);
            if (event.workspace_id !== this.workspaceId || typeof event.event_id !== 'string' || typeof event.event_type !== 'string' || event.schema_version !== '1.0' || seq === null) return;
            if (compareSequence(seq, this.lastEventSeq) <= 0 || this.seen.has(event.event_id)) return;
            this.lastEventSeq = event.seq;
            this.seen.add(event.event_id);
            if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
            onEvent(event);
          }
        }).catch(error => {
          const failure = transportFailure(error, { native: isTauri(), websocket: true });
          throw new ApiError(`Telemetry: ${failure.message}`, { ...failure, code: failure.code === 'NETWORK_ERROR' ? 'WS_HANDSHAKE_FAILED' : failure.code, endpoint: '/ws/telemetry', method: 'GET' });
        });
        if (!current() || attempt !== connectionEpoch || closed) { await socket.close(); return; }
        this.socket = socket;
        attempts = 0;
        onStatus('connected');
        this.pingTimer = setInterval(() => { Promise.resolve(socket.send('ping')).catch(reconnect); }, 15000);
      } catch (error) {
        if (!this.accessToken || error.code === 'REFRESH_UNCERTAIN') { onStatus('auth_required', error); return; }
        if (generation !== this.generation) return;
        onStatus('offline', error);
        reconnect();
      }
    };
    return connect();
  }
}
export const hermesApi = new HermesApiClient();
