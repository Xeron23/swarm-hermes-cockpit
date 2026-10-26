import { items, sequence, compareSequence, ApiError } from './api_client.js';
import { SEMANTIC_EVENT_TYPES } from './activity_model.js';
import { formatApiError } from './diagnostics.js';
import { selectActiveMissions, selectMissionHistory, normalizeMission } from './mission_model.js';
import { recoveryNeeded } from './connection_policy.js';

export const senderId = value => String(value || '').replace(/^(agent|node|user):/, '');
export function metricRows(node) {
  if (!node.metrics || typeof node.metrics !== 'object') return [];
  const rows = [];
  const visit = (value, path = '') => {
    for (const [key, entry] of Object.entries(value)) {
      const name = path ? `${path} / ${key}` : key;
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) visit(entry, name);
      else if (entry !== null && entry !== undefined) rows.push([name.replaceAll('_', ' '), typeof entry === 'object' ? JSON.stringify(entry) : String(entry)]);
    }
  };
  visit(node.metrics);
  return rows;
}

export class Workspace {
  constructor(api, { now = () => Date.now(), isVisible = () => globalThis.document?.visibilityState !== 'hidden' } = {}) {
    this.api = api;
    this.now = now;
    this.isVisible = isVisible;
    this.lastSyncedAt = 0;
    this.replyTimers = new Map();
    this.listeners = new Set();
    this.state = this.empty();
    this.epoch = 0;
  }
  empty() {
    return { status: this.api?.accessToken ? 'connecting' : this.api?.authenticationRequired ? 'auth_required' : 'unpaired', connectionStage: null, workspaceId: null, error: '', syncing: false, syncVersion: 0, telemetryConnected: false, retry: null, sessionWarning: '', updatedAt: null, nodes: [], agents: [], missions: [], activeMissions: [], missionHistory: [], missionDetailsById: {}, sessions: [], messages: {}, pendingReplies: {}, activityEvents: [], events: [], features: {}, approvals: [], questions: [], sectionErrors: {} };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.state); }
  get disconnectedStatus() { return this.api.authenticationRequired ? 'auth_required' : this.api.accessToken ? 'offline' : 'unpaired'; }
  get writable() { return this.state.status === 'connected' && Boolean(this.api.accessToken) && !this.api.auth?.refresh_uncertain && this.state.features.real_mode === true && this.state.features.runtime_ready === true; }
  requireOnline() {
    if (!this.writable) throw new ApiError('Tunggu backend dan telemetry siap sebelum mengirim perintah.', { code: 'NOT_READY' });
  }
  async snapshot(resetCursor = false, notify = true) {
    const epoch = this.epoch;
    const value = await this.api.getBootstrap();
    if (epoch !== this.epoch) return;
    if (!value || value.workspace_id !== this.api.workspaceId || value.device_id !== this.api.deviceId || !Array.isArray(value.nodes) || !Array.isArray(value.agents) || !Array.isArray(value.active_missions)) {
      throw new ApiError('Snapshot workspace tidak sesuai identitas perangkat atau kontrak API.', { code: 'INVALID_SNAPSHOT', endpoint: '/api/v1/bootstrap', method: 'GET' });
    }
    if (resetCursor && sequence(value.last_event_seq) === null) throw new ApiError('Cursor event server tidak valid.', { code: 'INVALID_SNAPSHOT', endpoint: '/api/v1/bootstrap', method: 'GET' });
    const incomingIds = new Set(value.active_missions.map(mission => mission.id));
    // Bootstrap contains active records only. Keep known records until the
    // authoritative full list arrives, including when a delta emits mid-fetch.
    const missions = [...value.active_missions, ...this.state.missions.filter(mission => !incomingIds.has(mission.id))];
    Object.assign(this.state, {
      workspaceId: value.workspace_id,
      nodes: value.nodes,
      agents: value.agents,
      missions,
      activeMissions: selectActiveMissions(missions),
      missionHistory: selectMissionHistory(missions),
      features: value.features || {},
      updatedAt: new Date().toISOString()
    });
    if (resetCursor) this.api.lastEventSeq = value.last_event_seq;
    if (notify) this.emit();
  }
  async sections(notify = true) {
    const epoch = this.epoch;
    const calls = { missions: () => this.api.getMissions(), sessions: () => this.api.getSessions(), approvals: () => this.api.getApprovals(), questions: () => this.api.getQuestions() };
    await Promise.all(Object.entries(calls).map(async ([name, call]) => {
      try {
        const value = await call();
        if (epoch !== this.epoch) return;
        const resultItems = items(value);
        if (name === 'missions') {
          this.state.missions = resultItems;
          this.state.activeMissions = selectActiveMissions(resultItems);
          this.state.missionHistory = selectMissionHistory(resultItems);
        } else {
          this.state[name] = resultItems;
        }
        delete this.state.sectionErrors[name];
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.state.sectionErrors[name] = formatApiError(error);
        if (!this.api.accessToken || error.code === 'REFRESH_UNCERTAIN') this.state.status = this.disconnectedStatus;
      }
    }));
    if (notify && epoch === this.epoch) this.emit();
  }
  async connect() {
    if (this.connecting && this.api.retryTelemetry) return this.connecting;
    if (this.telemetryStarted && this.api.retryTelemetry) return this.api.retryTelemetry();
    this.disconnect(false);
    if (this.state.workspaceId && this.state.workspaceId !== this.api.workspaceId) this.state = this.empty();
    if (!this.api.accessToken) { this.state.status = this.disconnectedStatus; this.emit(); return; }
    const epoch = this.epoch;
    this.telemetryStarted = true;
    this.state.status = 'connecting';
    this.state.error = '';
    this.emit();
    const stage = value => { if (epoch === this.epoch) { this.state.connectionStage = value; this.emit(); } };
    const attempt = this.api.startTelemetry({
      beforeConnect: async () => {
        stage('health');
        const health = await this.api.getHealth();
        if (epoch !== this.epoch) return;
        if (health?.status !== 'ok') throw new ApiError('Backend belum siap; koneksi akan dicoba kembali.', { code: 'BACKEND_NOT_READY', status: 503, retryable: true, endpoint: '/health/ready', method: 'GET' });
        if (this.api.auth?.refresh_uncertain) {
          stage('session');
          await this.api.recoverSession(health);
        }
        if (epoch !== this.epoch) return;
        stage('bootstrap');
        await this.snapshot(true, false);
        if (epoch === this.epoch) {
          await this.sections(false);
          this.lastSyncedAt = this.now();
          this.state.syncVersion++;
          this.state.sessionWarning = this.api.auth?.refresh_uncertain ? 'Access token masih dapat dipakai untuk membaca. Refresh token perlu verifikasi backend; aksi tugas sementara dinonaktifkan.' : '';
          this.emit();
        }
      },
      onStage: stage,
      onRetry: retry => { if (epoch === this.epoch) { this.state.retry = retry; this.emit(); } },
      onStatus: (status, error) => {
        if (epoch !== this.epoch) return;
        this.state.status = status;
        this.state.telemetryConnected = status === 'connected';
        if (status !== 'connected' && this.state.connectionStage === 'ready') this.state.connectionStage = 'telemetry';
        if (status !== 'connected') this.interruptReplies();
        if (error) this.state.error = formatApiError(error);
        if (status === 'connected') { this.state.error = ''; this.state.connectionStage = 'ready'; this.state.retry = null; }
        this.emit();
      },
      onEvent: event => { if (epoch === this.epoch) this.applyEvent(event); }
    });
    this.pollTimer = setInterval(() => this.poll(), 15000);
    this.connecting = Promise.resolve(attempt).finally(() => { if (epoch === this.epoch) this.connecting = null; });
    return this.connecting;
  }
  disconnect(clear = true) {
    this.epoch++;
    this.api.stopTelemetry();
    this.telemetryStarted = false;
    this.connecting = null;
    this.state.telemetryConnected = false;
    this.state.syncing = false;
    this.state.retry = null;
    clearInterval(this.pollTimer);
    clearTimeout(this.eventRefresh);
    this.refreshing = null;
    this.eventRefresh = null;
    this.eventRefreshStarted = null;
    for (const timer of this.replyTimers.values()) clearTimeout(timer);
    this.replyTimers.clear();
    this.state.pendingReplies = {};
    if (clear) this.state = this.empty();
  }
  suspend() {
    this.disconnect(false);
    this.state.status = this.disconnectedStatus;
    this.state.connectionStage = 'paused';
    this.emit();
  }
  resume() {
    if (!this.isVisible() || !this.api.accessToken) return Promise.resolve();
    return this.state.telemetryConnected && this.api.socket ? this.refresh() : this.connect();
  }
  reconnect() {
    this.suspend();
    return this.resume();
  }
  syncNow() {
    return this.state.telemetryConnected && this.api.socket ? this.refresh() : this.connect();
  }
  poll() {
    if (!this.isVisible() || !this.api.accessToken) return;
    if (this.telemetryStarted && !this.state.telemetryConnected) return;
    const live = this.state.status === 'connected' && Boolean(this.api.socket);
    if (!live || this.now() - this.lastSyncedAt >= (this.api.auth?.refresh_uncertain ? 60000 : 120000)) this.refresh().catch(() => {});
  }
  scheduleRefresh() {
    const now = this.now();
    this.eventRefreshStarted ??= now;
    clearTimeout(this.eventRefresh);
    const epoch = this.epoch;
    this.eventRefresh = setTimeout(() => {
      this.eventRefresh = null;
      this.eventRefreshStarted = null;
      if (epoch === this.epoch && this.isVisible()) this.refresh().catch(() => {});
    }, Math.max(0, Math.min(1000, 3000 - (now - this.eventRefreshStarted))));
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    if (!this.api.accessToken) { this.state.status = this.disconnectedStatus; this.emit(); return; }
    const epoch = this.epoch;
    this.state.syncing = true;
    this.emit();
    this.refreshing = (async () => {
      try {
        if (this.api.auth?.refresh_uncertain) await this.api.recoverSession(await this.api.getHealth());
        if (epoch !== this.epoch) return;
        await this.snapshot(false, false);
        if (epoch !== this.epoch) return;
        await this.sections(false);
        if (epoch !== this.epoch) return;
        await Promise.all(Object.keys(this.state.pendingReplies).map(id => this.loadMessages(id, false).catch(error => {
          if (epoch === this.epoch) this.state.sectionErrors.messages = formatApiError(error);
        })));
        if (epoch !== this.epoch) return;
        this.lastSyncedAt = this.now();
        this.state.syncVersion++;
        this.state.sessionWarning = this.api.auth?.refresh_uncertain ? 'Refresh token perlu verifikasi backend; workspace sementara hanya dapat dibaca.' : '';
        if (this.state.telemetryConnected && this.api.socket) { this.state.status = 'connected'; this.state.error = ''; }
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.state.error = formatApiError(error);
        this.state.status = recoveryNeeded(error) ? 'recovery_required' : this.disconnectedStatus;
        if (recoveryNeeded(error)) this.api.reconnectTelemetry?.();
        if (this.state.status === 'auth_required') this.api.stopTelemetry();
        throw error;
      } finally {
        if (epoch === this.epoch) { this.refreshing = null; this.state.syncing = false; this.emit(); }
      }
    })();
    return this.refreshing;
  }
  applyEvent(event) {
    this.state.events = [event, ...this.state.events].slice(0, 300);
    if (SEMANTIC_EVENT_TYPES.has(event.event_type)) this.state.activityEvents = [event, ...this.state.activityEvents].slice(0, 100);
    const payload = event.payload || {};
    if (event.event_type === 'MESSAGE_DELTA' && payload.session_id && payload.message_id && typeof payload.delta === 'string') {
      const messages = this.state.messages[payload.session_id] ||= [];
      let message = messages.find(m => m.id === payload.message_id);
      if (!message) {
        message = { id: payload.message_id, session_id: payload.session_id, sender_kind: 'agent', sender_id: senderId(event.sender), content: '', created_at: event.timestamp, status: 'streaming' };
        messages.push(message);
      }
      message.content += payload.delta;
      this.acceptReply(payload.session_id, message);
    }
    if (event.event_type === 'MESSAGE_FINAL') {
      const message = payload.message || payload;
      const id = message.message_id || message.id;
      const sessionId = message.session_id || Object.entries(this.state.messages).find(([, list]) => id && list.some(m => m.id === id))?.[0];
      if (sessionId) {
        this.acceptReply(sessionId, { ...message, sender_kind: message.sender_kind || (String(event.sender || '').startsWith('agent:') ? 'agent' : ''), sender_id: message.sender_id || senderId(event.sender), id });
        const epoch = this.epoch;
        this.loadMessages(sessionId).catch(error => {
          if (epoch !== this.epoch) return;
          this.state.sectionErrors.messages = error.message;
          this.emit();
        });
      }
    }
    // Full backend records are authoritative; do not guess partial payload
    // schemas or mark a power action complete because its request was accepted.
    if (/^(NODE|AGENT|MISSION|TASK|APPROVAL|QUESTION|ARTIFACT)_/.test(event.event_type)) this.scheduleRefresh();
    this.emit();
  }
  async session(agentId) {
    this.requireOnline();
    const agent = this.state.agents.find(a => a.id === agentId);
    if (!agent) throw new ApiError('Agen tidak ditemukan.', { code: 'UNKNOWN_AGENT' });
    let id = agent.active_direct_session_id;
    if (!id) {
      const created = await this.api.createSession(agentId);
      id = created?.session?.id || created?.id;
      if (!id) throw new ApiError('Sesi agen tidak berhasil dibuat.', { code: 'INVALID_RESPONSE' });
      agent.active_direct_session_id = id;
      this.state.sessions = [created.session || created, ...this.state.sessions.filter(s => s.id !== id)];
      this.emit();
    }
    await this.loadMessages(id);
    return id;
  }
  async loadMessages(id, notify = true) {
    const epoch = this.epoch;
    const value = await this.api.getMessages(id);
    if (epoch !== this.epoch) return;
    const incoming = items(value);
    const existing = this.state.messages[id] || [];
    const stream = existing.find(m => m.status === 'streaming');
    if (stream && !incoming.some(m => m.id === stream.id)) incoming.push(stream);
    this.state.messages[id] = incoming.sort((a, b) => {
      const x = sequence(a.seq_no), y = sequence(b.seq_no);
      return x !== null && y !== null ? compareSequence(x, y) : String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    for (const message of this.state.messages[id]) this.acceptReply(id, message);
    delete this.state.sectionErrors.messages;
    if (notify) this.emit();
  }
  acceptReply(id, message) {
    const pending = this.state.pendingReplies[id];
    if (!pending || message.sender_kind !== 'agent' || !message.id || pending.knownIds.has(message.id)) return;
    if (pending.agentId && senderId(message.sender_id) !== senderId(pending.agentId)) return;
    // A late history fetch must not mistake an older agent message for this reply.
    if (message.created_at && pending.lastAgentAt && Date.parse(message.created_at) <= pending.lastAgentAt) return;
    clearTimeout(this.replyTimers.get(id));
    this.replyTimers.delete(id);
    delete this.state.pendingReplies[id];
  }
  interruptReplies() {
    for (const [id, pending] of Object.entries(this.state.pendingReplies)) {
      clearTimeout(this.replyTimers.get(id));
      if (pending.phase === 'waiting') pending.phase = 'interrupted';
    }
    this.replyTimers.clear();
  }
  async send(id, content, target, agentId = null) {
    this.requireOnline();
    const epoch = this.epoch;
    if (this.state.pendingReplies[id]?.phase === 'sending') throw new ApiError('Pesan masih dikirim.', { code: 'SEND_PENDING' });
    clearTimeout(this.replyTimers.get(id));
    const pending = { phase: 'sending', agentId, lastAgentAt: Math.max(0, ...(this.state.messages[id] || []).filter(m => m.sender_kind === 'agent').map(m => Date.parse(m.created_at) || 0)), knownIds: new Set((this.state.messages[id] || []).map(m => m.id)) };
    this.state.pendingReplies[id] = pending;
    try {
      const value = await this.api.sendMessage(id, content, target);
      if (epoch !== this.epoch) return;
      const message = value?.message || value;
      if (message?.id && message.session_id === id) {
        const list = this.state.messages[id] ||= [];
        if (!list.some(m => m.id === message.id)) list.push(message);
      }
      // A stream can arrive before POST settles. Never resurrect its typing state.
      if (this.state.pendingReplies[id] === pending) {
        pending.phase = this.state.status === 'connected' ? 'waiting' : 'interrupted';
        this.replyTimers.set(id, setTimeout(() => {
          this.replyTimers.delete(id);
          if (epoch === this.epoch && this.state.pendingReplies[id] === pending) {
            pending.phase = 'delayed';
            this.emit();
          }
        }, 90000));
      }
      this.emit();
    } catch (error) {
      if (epoch === this.epoch && this.state.pendingReplies[id] === pending) {
        delete this.state.pendingReplies[id];
        this.emit();
      }
      throw error; // Mutations are never replayed after a transport failure.
    }
    try { await this.loadMessages(id); } catch (error) {
      // POST was accepted: a failed history GET must not encourage resending it.
      if (epoch === this.epoch) { this.state.sectionErrors.messages = formatApiError(error); this.emit(); }
    }
  }
}
