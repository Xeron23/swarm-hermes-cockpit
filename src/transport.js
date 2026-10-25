import { isTauri, Channel, invoke } from '@tauri-apps/api/core';

// The same VM address is reached on LAN and via the Tailscale subnet router.
// The Proxmox Tailscale address is not the backend API address.
export const SERVER_URL = 'http://192.168.1.4:3450';
export const NETWORK = Object.freeze({ server: '192.168.1.4', pc: '192.168.1.26', pcTailscale: '100.122.253.126', subnetRouter: '100.114.42.71' });

export async function httpFetch(url, options) {
  if (isTauri()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, { ...options, maxRedirections: 0, connectTimeout: 5000 });
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
        deadline = setTimeout(() => { expired = true; active = false; reject(new Error('Telemetry tidak merespons.')); }, 10000);
      })]);
    } finally { clearTimeout(deadline); }
    return { send: text => socket.send(text), close: async () => { active = false; await socket.disconnect(); } };
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocol);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Telemetry tidak merespons.')); }, 10000);
    socket.onmessage = event => handlers.message(event.data);
    socket.onclose = () => { clearTimeout(timer); handlers.close(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Telemetry tidak dapat dihubungi.')); };
    socket.onopen = () => {
      clearTimeout(timer);
      resolve({ send: text => socket.send(text), close: () => socket.close() });
    };
  });
}
