import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { BUILD_INFO } from './build_info.js';

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
    return { app: 'Hermes Cockpit', version: BUILD_INFO.version, commit: BUILD_INFO.commit, build_run: BUILD_INFO.run || 'local', platform: 'browser', mode: 'live' };
  }
});
