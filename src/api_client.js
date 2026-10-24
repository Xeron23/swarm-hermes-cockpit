/**
 * Hermes Cockpit Production API & Telemetry Client
 * Implements wire contracts from hermes-backend-spec-v1.
 */

export class HermesApiClient {
  constructor(baseUrl = 'http://127.0.0.1:3450') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws');
    this.accessToken = localStorage.getItem('hermes_access_token') || null;
    this.refreshTokenVal = localStorage.getItem('hermes_refresh_token') || null;
    this.workspaceId = localStorage.getItem('hermes_workspace_id') || null;
    this.deviceId = localStorage.getItem('hermes_device_id') || null;
    this.lastEventSeq = '0';
    this.telemetryWs = null;
    this.listeners = new Set();
  }

  setTokens({ access_token, refresh_token, workspace_id, device_id }) {
    if (access_token) {
      this.accessToken = access_token;
      localStorage.setItem('hermes_access_token', access_token);
    }
    if (refresh_token) {
      this.refreshTokenVal = refresh_token;
      localStorage.setItem('hermes_refresh_token', refresh_token);
    }
    if (workspace_id) {
      this.workspaceId = workspace_id;
      localStorage.setItem('hermes_workspace_id', workspace_id);
    }
    if (device_id) {
      this.deviceId = device_id;
      localStorage.setItem('hermes_device_id', device_id);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshTokenVal = null;
    localStorage.removeItem('hermes_access_token');
    localStorage.removeItem('hermes_refresh_token');
    localStorage.removeItem('hermes_workspace_id');
    localStorage.removeItem('hermes_device_id');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(url, { ...options, headers });

    // Handle Token Expiry & Automatic Refresh
    if (response.status === 401 && this.refreshTokenVal && !endpoint.includes('/auth/')) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson.error?.message || errorJson.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async pair(pairingCode, deviceName = 'Cockpit Client') {
    const data = await this.request('/api/v1/auth/pair', {
      method: 'POST',
      body: JSON.stringify({ pairing_code: pairingCode, device_name: deviceName })
    });
    this.setTokens(data);
    return data;
  }

  async refreshToken() {
    try {
      const data = await this.request('/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: this.refreshTokenVal })
      });
      this.setTokens(data);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  async getHealth() {
    return this.request('/health/ready');
  }

  async getBootstrap() {
    const data = await this.request('/api/v1/bootstrap');
    if (data.last_event_seq) {
      this.lastEventSeq = data.last_event_seq;
    }
    return data;
  }

  async getAgents() {
    return this.request('/api/v1/agents');
  }

  async getNodes() {
    return this.request('/api/v1/nodes');
  }

  async getSessions() {
    return this.request('/api/v1/sessions');
  }

  async createSession(agentId, title = 'New session', reuseActive = true) {
    return this.request('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, title, reuse_active: reuseActive })
    });
  }

  async getMessages(sessionId, afterSeq = null) {
    let ep = `/api/v1/sessions/${sessionId}/messages`;
    if (afterSeq) ep += `?after_seq=${afterSeq}`;
    return this.request(ep);
  }

  async sendMessage(sessionId, content, execution = { target_node: 'auto' }) {
    return this.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, execution })
    });
  }

  async getMissions() {
    return this.request('/api/v1/missions');
  }

  async createMission(title, prompt, execution = { target_node: 'auto' }) {
    return this.request('/api/v1/missions', {
      method: 'POST',
      body: JSON.stringify({ title, prompt, execution, token_budget: 200000 })
    });
  }

  async getSwarmEvents(afterSeq = null) {
    let ep = '/api/v1/swarm/events';
    if (afterSeq) ep += `?after_seq=${afterSeq}`;
    return this.request(ep);
  }

  async connectTelemetry(onEvent) {
    if (onEvent) this.listeners.add(onEvent);

    // Get single-use WS ticket
    const ticketRes = await this.request('/api/v1/auth/ws-ticket', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const ticket = ticketRes.ticket;
    const wsUrl = `${this.wsUrl}/ws/telemetry?ticket=${encodeURIComponent(ticket)}&after_seq=${this.lastEventSeq}`;

    this.telemetryWs = new WebSocket(wsUrl, ['hermes.telemetry.v1']);

    this.telemetryWs.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        if (envelope.seq) {
          this.lastEventSeq = envelope.seq;
        }
        for (const listener of this.listeners) {
          listener(envelope);
        }
      } catch (err) {
        console.error('Failed to parse telemetry envelope:', err);
      }
    };

    this.telemetryWs.onclose = () => {
      // Automatic reconnect with backoff
      setTimeout(() => {
        if (this.accessToken) {
          this.connectTelemetry().catch(console.error);
        }
      }, 3000);
    };

    // Ping keep-alive
    const interval = setInterval(() => {
      if (this.telemetryWs?.readyState === WebSocket.OPEN) {
        this.telemetryWs.send('ping');
      } else {
        clearInterval(interval);
      }
    }, 15000);
  }
}

export const hermesApi = new HermesApiClient();
