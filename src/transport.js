import { isTauri, Channel, invoke } from '@tauri-apps/api/core';

// The same VM address is reached on LAN and via the Tailscale subnet router.
// The Proxmox Tailscale address is not the backend API address.
export const SERVER_URL = 'http://192.168.1.4:3450';
export const NETWORK = Object.freeze({ server: '192.168.1.4', pc: '192.168.1.26', pcTailscale: '100.122.253.126', subnetRouter: '100.114.42.71' });

export async function httpFetch(url, options) {
  if (isTauri()) {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const headers = Array.from(new Headers(options.headers || {}).entries());
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new DOMException('Request aborted', 'AbortError'));
      options.signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      const response = await Promise.race([
        invoke('backend_request', { request: { url, method: options.method || 'GET', headers, body: options.body ?? null } }),
        cancelled
      ]);
      return new Response([101, 103, 204, 205, 304].includes(response.status) ? null : response.body, { status: response.status });
    } finally { options.signal?.removeEventListener('abort', abort); }
  }
  return fetch(url, { ...options, redirect: 'error', credentials: 'omit' });
}

export async function openSocket(url, protocol, handlers) {
  if (isTauri()) {
    const { default: WebSocket } = await import('@tauri-apps/plugin-websocket');
    let active = true;
    // Register the channel BEFORE the handshake: the backend may immediately
    // replay events. Adding a listener after connect() can lose those frames.
    const onMessage = new Channel(message => {
      if (!active) return;
      if (message?.type === 'Text') handlers.message(message.data);
      else if (message?.type === 'Close' || typeof message === 'string') handlers.close();
    });
    let expired = false;
    let deadline;
    const connection = invoke('plugin:websocket|connect', { url, onMessage,
      config: { headers: [['Sec-WebSocket-Protocol', protocol]], maxMessageSize: 4 * 1024 * 1024 }
    }).then(id => new WebSocket(id, new Set()));
    connection.then(socket => { if (expired) socket.disconnect().catch(() => {}); }, () => {});
    let socket;
    try {
      socket = await Promise.race([connection, new Promise((_, reject) => {
        deadline = setTimeout(() => { expired = true; active = false; reject(Object.assign(new Error('Telemetry tidak merespons.'), { code: 'TIMEOUT' })); }, 10000);
      })]);
    } finally { clearTimeout(deadline); }
    return { send: text => socket.send(text), close: async () => { active = false; await socket.disconnect(); } };
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocol);
    let opened = false;
    const timer = setTimeout(() => { socket.close(); reject(Object.assign(new Error('Telemetry tidak merespons.'), { code: 'TIMEOUT' })); }, 10000);
    socket.onmessage = event => handlers.message(event.data);
    socket.onclose = () => {
      clearTimeout(timer);
      if (!opened) reject(new Error('Telemetry ditutup sebelum handshake selesai.'));
      else handlers.close();
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Telemetry tidak dapat dihubungi.')); };
    socket.onopen = () => {
      clearTimeout(timer);
      opened = true;
      resolve({ send: text => socket.send(text), close: () => socket.close() });
    };
  });
}
