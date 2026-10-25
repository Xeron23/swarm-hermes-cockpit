import { items, sequence, compareSequence, ApiError } from './api_client.js';
import { formatApiError } from './diagnostics.js';

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
  constructor(api) {
    this.api = api;
    this.listeners = new Set();
    this.state = this.empty();
    this.epoch = 0;
  }
  empty() {
    return { status: this.api?.accessToken ? 'connecting' : 'unpaired', workspaceId: null, error: '', updatedAt: null, nodes: [], agents: [], missions: [], sessions: [], messages: {}, events: [], features: {}, approvals: [], questions: [], sectionErrors: {} };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.state); }
  get writable() { return this.state.status === 'connected' && this.state.features.real_mode === true && this.state.features.runtime_ready === true; }
  requireOnline() {
    if (!this.writable) throw new ApiError('Tunggu backend dan telemetry siap sebelum mengirim perintah.', { code: 'NOT_READY' });
  }
  async snapshot(resetCursor = false) {
    const epoch = this.epoch;
    const value = await this.api.getBootstrap();
    if (epoch !== this.epoch) return;
    if (!value || value.workspace_id !== this.api.workspaceId || value.device_id !== this.api.deviceId || !Array.isArray(value.nodes) || !Array.isArray(value.agents) || !Array.isArray(value.active_missions)) {
      throw new ApiError('Snapshot workspace tidak sesuai identitas perangkat atau kontrak API.', { code: 'INVALID_SNAPSHOT' });
    }
    if (resetCursor && sequence(value.last_event_seq) === null) throw new ApiError('Cursor event server tidak valid.', { code: 'INVALID_SNAPSHOT' });
    Object.assign(this.state, { workspaceId: value.workspace_id, nodes: value.nodes, agents: value.agents, missions: value.active_missions, features: value.features || {}, updatedAt: new Date().toISOString(), error: '' });
    if (resetCursor) this.api.lastEventSeq = value.last_event_seq;
    this.emit();
  }
  async sections() {
    const epoch = this.epoch;
    const calls = { missions: () => this.api.getMissions(), sessions: () => this.api.getSessions(), approvals: () => this.api.getApprovals(), questions: () => this.api.getQuestions() };
    await Promise.all(Object.entries(calls).map(async ([name, call]) => {
      try {
        const value = await call();
        if (epoch !== this.epoch) return;
        this.state[name] = items(value);
        delete this.state.sectionErrors[name];
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.state.sectionErrors[name] = formatApiError(error);
        if (!this.api.accessToken) this.state.status = 'auth_required';
      }
    }));
    if (epoch === this.epoch) this.emit();
  }
  async connect() {
    this.disconnect(false);
    if (this.state.workspaceId && this.state.workspaceId !== this.api.workspaceId) this.state = this.empty();
    if (!this.api.accessToken) { this.state.status = 'unpaired'; this.emit(); return; }
    const epoch = this.epoch;
    this.state.status = 'connecting';
    this.state.error = '';
    this.emit();
    this.api.startTelemetry({
      beforeConnect: async () => {
        await this.api.getHealth();
        await this.snapshot(true);
        if (epoch === this.epoch) await this.sections();
      },
      onStatus: (status, error) => {
        if (epoch !== this.epoch) return;
        this.state.status = status;
        if (error) this.state.error = formatApiError(error);
        if (status === 'connected') this.state.error = '';
        this.emit();
      },
      onEvent: event => { if (epoch === this.epoch) this.applyEvent(event); }
    });
    this.pollTimer = setInterval(() => this.refresh().catch(() => {}), 15000);
  }
  disconnect(clear = true) {
    this.epoch++;
    this.api.stopTelemetry();
    clearInterval(this.pollTimer);
    clearTimeout(this.eventRefresh);
    this.refreshing = null;
    if (clear) this.state = this.empty();
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    if (!this.api.accessToken) return;
    const epoch = this.epoch;
    this.refreshing = (async () => {
      try {
        await this.snapshot();
        await this.sections();
        if (epoch === this.epoch && this.api.socket) this.state.status = 'connected';
        this.emit();
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.state.error = formatApiError(error);
        this.state.status = this.api.accessToken && !this.api.auth?.refresh_uncertain ? 'offline' : 'auth_required';
        if (this.state.status === 'auth_required') this.api.stopTelemetry();
        this.emit();
        throw error;
      } finally { if (epoch === this.epoch) this.refreshing = null; }
    })();
    return this.refreshing;
  }
  applyEvent(event) {
    this.state.events = [event, ...this.state.events].slice(0, 300);
    const payload = event.payload || {};
    if (event.event_type === 'MESSAGE_DELTA' && payload.session_id && payload.message_id && typeof payload.delta === 'string') {
      const messages = this.state.messages[payload.session_id] ||= [];
      let message = messages.find(m => m.id === payload.message_id);
      if (!message) {
        message = { id: payload.message_id, session_id: payload.session_id, sender_kind: 'agent', sender_id: senderId(event.sender), content: '', created_at: event.timestamp, status: 'streaming' };
        messages.push(message);
      }
      message.content += payload.delta;
    }
    if (event.event_type === 'MESSAGE_FINAL') {
      const message = payload.message || payload;
      const id = message.message_id || message.id;
      const sessionId = message.session_id || Object.entries(this.state.messages).find(([, list]) => id && list.some(m => m.id === id))?.[0];
      if (sessionId) this.loadMessages(sessionId).catch(error => {
        this.state.sectionErrors.messages = error.message;
        this.emit();
      });
    }
    // Full backend records are authoritative; do not guess partial payload
    // schemas or mark a power action complete because its request was accepted.
    if (event.event_type !== 'MESSAGE_DELTA' && event.event_type !== 'TOOL_LOG_CHUNK') {
      clearTimeout(this.eventRefresh);
      this.eventRefresh = setTimeout(() => this.refresh().catch(() => {}), 250);
    }
    this.emit();
  }
  async session(agentId) {
    this.requireOnline();
    const agent = this.state.agents.find(a => a.id === agentId);
    if (!agent) throw new ApiError('Agen tidak ditemukan.', { code: 'UNKNOWN_AGENT' });
    let id = agent.active_direct_session_id;
    if (!id) {
      const value = await this.api.createSession(agentId, `Direct chat: ${agent.name}`);
      const record = value?.session || value;
      if (!record?.id) throw new ApiError('Respons session tidak lengkap.', { code: 'INVALID_RESPONSE' });
      id = record.id;
      agent.active_direct_session_id = id;
    }
    await this.loadMessages(id);
    return id;
  }
  async loadMessages(id) {
    const epoch = this.epoch;
    const value = await this.api.getMessages(id);
    if (epoch !== this.epoch) return;
    // A delta received while fetching must not be lost to an older HTTP list.
    const incoming = items(value);
    const merged = new Map(incoming.map(m => [m.id, m]));
    for (const message of this.state.messages[id] || []) {
      const fetched = merged.get(message.id);
      if (message.status === 'streaming' && (!fetched || fetched.status === 'streaming' && message.content.length > fetched.content.length)) merged.set(message.id, message);
    }
    this.state.messages[id] = [...merged.values()].sort((a, b) => {
      const x = sequence(a.seq_no), y = sequence(b.seq_no);
      return x !== null && y !== null ? compareSequence(x, y) : String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    delete this.state.sectionErrors.messages;
    this.emit();
  }
  async send(id, content, target) {
    this.requireOnline();
    const value = await this.api.sendMessage(id, content, target);
    // The contract returns a Message, not an invented task/agent reply.
    const message = value?.message || value;
    if (message?.id && message.session_id === id) {
      const list = this.state.messages[id] ||= [];
      if (!list.some(m => m.id === message.id)) list.push(message);
      this.emit();
    }
    await this.loadMessages(id);
  }
}
