import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

/** Native OS boundary. Workspace and node data come from the backend. */
window.HermesNative = Object.freeze({
  isNative: isTauri(),
  async copyText(text) {
    if (typeof text !== 'string') throw new TypeError('Clipboard payload must be text.');
    if (isTauri()) return writeText(text);
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable.');
    return navigator.clipboard.writeText(text);
  },
  async getRuntimeInfo() {
    if (isTauri()) return invoke('runtime_info');
    return { app: 'Hermes Cockpit', version: '0.1.1', platform: 'browser', mode: 'live' };
  }
});
