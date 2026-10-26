import { SERVER_URL, httpFetch, openSocket } from './transport.js';
import { isBackendCredentialRejection } from './auth_policy.js';
import { isTauri } from '@tauri-apps/api/core';
import { transportFailure, redactDiagnostic } from './diagnostics.js';
import { normalizePairingCode, pairingCodeError } from './pairing.js';
import { loadSession, saveSession, clearSession, checkStorageReady, AUTH_KEY } from './session_storage.js';
import { recoveryNeeded, retryableRead, reconnectDelay, recoveryRequestId } from './connection_policy.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', retryable = false, details = {}, endpoint, method } = {}) {
    super(message);
    Object.assign(this, { name: 'ApiError', status, code, retryable, details, endpoint, method });
  }
}
export { AUTH_KEY };
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
  constructor({ baseUrl = SERVER_URL, storage = globalThis.localStorage, fetcher = httpFetch, socketFactory = openSocket, timeout = 22000, retryDelay = 1000, readRetryDelay = 400, random = Math.random, now = () => Date.now() } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    Object.assign(this, { storage, fetcher, socketFactory, timeout, retryDelay, readRetryDelay, random, now });
    this.auth = null;
    this.authRejection = null;
    this.sessionStatus = 'missing';
    this.sessionPersistence = 'unwritten';
    this.lastEventSeq = '0';
    this.generation = 0;
    this.authEpoch = 0;
    this.seen = new Set();
    const result = loadSession(this.baseUrl, this.storage);
    this.sessionStatus = result.status;
    if (result.status === 'valid' && result.session) {
      this.auth = result.session;
      this.sessionPersistence = 'saved';
    }
  }
  get authenticationRequired() { return !this.accessToken && this.authRejection !== null; }
  get accessToken() { return this.auth?.access_token || null; }
  get workspaceId() { return this.auth?.workspace_id || null; }
  get deviceId() { return this.auth?.device_id || null; }
  setTokens(value) {
    if (!value?.access_token || !value?.refresh_token || !value?.workspace_id || !value?.device_id) {
      throw new ApiError('Respons autentikasi tidak lengkap.', { code: 'INVALID_RESPONSE' });
    }
    this.authRejection = null;
    this.auth = { ...value, server: this.baseUrl };
    delete this.auth.refresh_uncertain;
    delete this.auth.refresh_attempt_id;
    const saved = saveSession(this.auth, this.storage);
    this.sessionPersistence = saved.status || (saved.ok ? 'saved' : 'write_failed');
    this.sessionStatus = saved.ok ? 'valid' : 'write_failed';
  }
  clearTokens() {
    this.authRejection = null;
    this.authEpoch++;
    this.stopTelemetry();
    this.auth = null;
    this.sessionStatus = 'missing';
    this.sessionPersistence = 'unwritten';
    this.lastEventSeq = '0';
    this.seen.clear();
    clearSession(this.storage);
  }
  rejectCredentials(error) {
    this.clearTokens();
    this.authRejection = { status: error.status, code: error.code };
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
      diagnostic.source = 'hermes-backend';
      diagnostic.backendUrl = this.baseUrl;
      diagnostic.endpoint = endpoint.split('?')[0];
      diagnostic.method = options.method || 'GET';
      throw diagnostic;
    } finally { clearTimeout(timer); }
  }
  async request(endpoint, options = {}) {
    const tokenUsed = this.accessToken;
    const epoch = this.authEpoch;
    try { return await this.readOrSend(endpoint, options); } catch (error) {
      if (epoch !== this.authEpoch) throw error;
      if (isBackendCredentialRejection(error, this.baseUrl)) {
        this.rejectCredentials(error);
        throw error;
      }
      if (error.status !== 401 || error.code === 'INVALID_RESPONSE' || !this.auth?.refresh_token) throw error;
      // Parallel 401s share one rotating refresh; late responses reuse its result.
      if (this.accessToken === tokenUsed) await this.refreshToken();
      try { return await this.raw(endpoint, options); } catch (retried) {
        if (epoch === this.authEpoch && isBackendCredentialRejection(retried, this.baseUrl, 'retry')) this.rejectCredentials(retried);
        throw retried;
      }
    }
  }
  async readOrSend(endpoint, options = {}, authenticated = true) {
    const epoch = this.authEpoch, generation = this.generation;
    try { return await this.raw(endpoint, options, authenticated); } catch (error) {
      if (!['GET', 'HEAD'].includes(options.method || 'GET') || !retryableRead(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, this.readRetryDelay));
      if (epoch !== this.authEpoch || generation !== this.generation) throw new ApiError('Permintaan sudah dihentikan.', { code: 'SESSION_CLOSED' });
      return this.raw(endpoint, options, authenticated);
    }
  }
  async recoverSession(health) {
    // A local rotating POST owns its intent until it settles. Never erase it mid-flight.
    if (this.refreshing) { try { await this.refreshing; } catch {} }
    if (!this.auth?.refresh_uncertain) return;
    if (this.recovering) return this.recovering;
    const epoch = this.authEpoch;
    this.recovering = (async () => {
      if (health?.capabilities?.refresh_token_status_v1 !== true) {
        // Verify access without invoking refresh. Health alone cannot validate credentials.
        try { await this.raw('/api/v1/bootstrap'); }
        catch (error) {
          if (epoch === this.authEpoch && isBackendCredentialRejection(error, this.baseUrl)) this.rejectCredentials(error);
          if (error.status !== 401 || this.authenticationRequired) throw error;
          throw new ApiError('Refresh token perlu diverifikasi backend. Sesi tetap disimpan; rotasi lama tidak dikirim ulang.', { code: 'REFRESH_RECOVERY_REQUIRED' });
        }
        return; // Access may still work; retain uncertainty and keep mutations disabled.
      }
      const requestId = recoveryRequestId();
      let value;
      try {
        value = await this.raw('/api/v1/auth/refresh-status', { method: 'POST', body: JSON.stringify({
          refresh_token: this.auth.refresh_token, request_id: requestId,
          workspace_id: this.workspaceId, device_id: this.deviceId
        }) }, false);
      } catch (error) {
        if (epoch === this.authEpoch && isBackendCredentialRejection(error, this.baseUrl)) this.rejectCredentials(error);
        if (error.status === 0 || [500, 502, 503, 504].includes(error.status)) {
          throw new ApiError('Verifikasi sesi backend belum selesai dan akan dicoba lagi. Refresh token tersimpan tidak dirotasi ulang.', { code: 'REFRESH_RECOVERY_REQUIRED', endpoint: '/api/v1/auth/refresh-status', method: 'POST', details: { cause: error.code } });
        }
        throw error;
      }
      if (epoch !== this.authEpoch || !this.auth) throw new ApiError('Sesi sudah berubah.', { code: 'SESSION_CLOSED' });
      if (value?.request_id !== requestId || value.workspace_id !== this.workspaceId || value.device_id !== this.deviceId || value.rotation_performed !== false || value.refresh_token_state !== 'current') {
        throw new ApiError('Backend belum membuktikan refresh token tersimpan masih current. Tidak ada token yang dikirim ulang.', { code: 'REFRESH_RECOVERY_REQUIRED' });
      }
      const restored = { ...this.auth };
      delete restored.refresh_uncertain;
      delete restored.refresh_attempt_id;
      const saved = saveSession(restored, this.storage);
      if (!saved.ok) throw new ApiError('Penyimpanan sesi belum dapat diperbarui.', { code: 'SESSION_STORAGE_FAILED' });
      this.auth = restored;
      this.sessionPersistence = saved.status;
    })().finally(() => { this.recovering = null; });
    return this.recovering;
  }
  async refreshToken() {
    if (this.refreshing) return this.refreshing;
    if (!this.auth?.refresh_token) throw new ApiError('Pasangkan perangkat terlebih dahulu.', { status: 401, code: 'UNPAIRED' });
    if (this.auth.refresh_uncertain) throw new ApiError('Hasil rotasi token belum diketahui. Sesi perangkat tetap disimpan; pemulihan perlu diverifikasi backend sebelum refresh dapat dilanjutkan.', { code: 'REFRESH_UNCERTAIN' });
    const refreshToken = this.auth.refresh_token;
    const epoch = this.authEpoch;
    // Persist intent before a rotating POST: a process close must not replay it.
    const previous = this.auth;
    this.auth = { ...previous, refresh_uncertain: true, refresh_attempt_id: recoveryRequestId() };
    const intent = saveSession(this.auth, this.storage);
    if (this.storage && !intent.ok) {
      this.auth = previous;
      throw new ApiError('Rotasi ditunda karena penyimpanan sesi tidak dapat ditulis.', { code: 'SESSION_STORAGE_FAILED' });
    }
    this.refreshing = (async () => {
      try {
        const value = await this.raw('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false);
        if (epoch !== this.authEpoch) throw new ApiError('Sesi sudah ditutup.', { code: 'SESSION_CLOSED' });
        this.setTokens(value);
      } catch (error) {
        if (epoch !== this.authEpoch) throw error;
        if (isBackendCredentialRejection(error, this.baseUrl, 'refresh')) this.rejectCredentials(error);
        else if ((error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') && this.auth) {
          this.auth.refresh_uncertain = true;
          const saved = saveSession(this.auth, this.storage);
          this.sessionPersistence = saved.status;
        }
        throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async pair(pairingCode, deviceName) {
    const ready = checkStorageReady(this.storage);
    if (!ready.ready && ready.reason === 'STORAGE_WRITE_FAILED') {
      // Storage write failed probe
    }
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
  getHealth() { return this.readOrSend('/health/ready', {}, false); }
  getBootstrap() { return this.request('/api/v1/bootstrap'); }
  getNodes() { return this.request('/api/v1/nodes'); }
  getNode(id) { return this.request(`/api/v1/nodes/${encodeURIComponent(id)}`); }
  getSessions() { return this.request('/api/v1/sessions'); }
  createSession(agentId, title = 'Direct chat') { return this.request('/api/v1/sessions', { method: 'POST', body: JSON.stringify({ agent_id: agentId, title, reuse_active: true }) }); }
  getMessages(id) { return this.request(`/api/v1/sessions/${encodeURIComponent(id)}/messages`); }
  sendMessage(id, content, target) { return this.request(`/api/v1/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content, execution: { target_node: target } }) }); }
  getMissions() { return this.request('/api/v1/missions'); }
  getMission(id) { return this.request(`/api/v1/missions/${encodeURIComponent(id)}`); }
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
    this.retryTelemetry = null;
    this.reconnectTelemetry = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) Promise.resolve(socket.close()).catch(() => {});
  }
  startTelemetry({ onEvent, onStatus, beforeConnect = async () => {}, onStage = () => {}, onRetry = () => {} }) {
    this.stopTelemetry();
    const generation = this.generation;
    let attempts = 0;
    let connectionEpoch = 0;
    let inFlight = null;
    const current = () => generation === this.generation && Boolean(this.accessToken);
    const reconnect = (recovery = false) => {
      if (!current() || this.reconnectTimer) return;
      connectionEpoch++;
      clearInterval(this.pingTimer);
      const previous = this.socket;
      this.socket = null;
      const delay = recovery ? 60000 : reconnectDelay(attempts++, this.retryDelay, this.random);
      onStatus(recovery ? 'recovery_required' : 'reconnecting');
      onRetry({ attempt: attempts, delay });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        connect();
      }, delay);
      if (previous) Promise.resolve(previous.close()).catch(() => {});
    };
    const performConnect = async () => {
      if (!current()) return;
      onStatus('connecting');
      const attempt = ++connectionEpoch;
      try {
        await beforeConnect();
        if (!current()) { if (!this.accessToken) onStatus(this.authenticationRequired ? 'auth_required' : 'unpaired'); return; }
        onStage('ticket');
        const ticket = await this.request('/api/v1/auth/ws-ticket', { method: 'POST', body: '{}' });
        if (typeof ticket?.ticket !== 'string' || ticket.subprotocol !== 'hermes.telemetry.v1') throw new ApiError('Tiket telemetry tidak valid.', { code: 'INVALID_RESPONSE', endpoint: '/api/v1/auth/ws-ticket', method: 'POST' });
        if (!current()) { if (!this.accessToken) onStatus(this.authenticationRequired ? 'auth_required' : 'unpaired'); return; }
        const url = `${this.baseUrl.replace(/^http/, 'ws')}/ws/telemetry?ticket=${encodeURIComponent(ticket.ticket)}&after_seq=${encodeURIComponent(this.lastEventSeq)}`;
        let closed = false;
        let lastPong = this.now();
        onStage('telemetry');
        const socket = await this.socketFactory(url, ticket.subprotocol, {
          close: () => { closed = true; if (attempt === connectionEpoch) reconnect(); },
          message: text => {
            if (!current() || attempt !== connectionEpoch) return;
            if (text === 'pong') { lastPong = this.now(); return; }
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
        this.pingTimer = setInterval(() => {
          if (!current() || attempt !== connectionEpoch) return;
          if (this.now() - lastPong > 45000) { reconnect(); return; }
          Promise.resolve(socket.send('ping')).catch(() => reconnect());
        }, 15000);
      } catch (error) {
        if (!this.accessToken) {
          onStatus(this.authenticationRequired ? 'auth_required' : 'unpaired', error);
          return;
        }
        if (recoveryNeeded(error) || (this.auth?.refresh_uncertain && error.endpoint === '/api/v1/auth/refresh')) {
          onStatus('recovery_required', error);
          reconnect(true); // Probe status later; never replay the uncertain rotating POST.
          return;
        }
        if (generation !== this.generation) return;
        onStatus('offline', error);
        if (retryableRead(error) || error.retryable !== false) reconnect();
      }
    };
    const connect = () => inFlight || (inFlight = performConnect().finally(() => { inFlight = null; }));
    this.retryTelemetry = () => {
      if (!current()) return Promise.resolve();
      if (this.socket && !inFlight) return Promise.resolve();
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      return connect();
    };
    this.reconnectTelemetry = () => reconnect(true);
    return connect();
  }
}
export const hermesApi = new HermesApiClient();
