import { Channel, invoke } from '@tauri-apps/api/core';

class AndroidUpdate {
  constructor(metadata) { Object.assign(this, metadata); }
  async download(onEvent) {
    const onProgress = new Channel(onEvent);
    await invoke('android_update_download', { rid: this.rid, onEvent: onProgress });
  }
  install() { return invoke('android_update_install', { rid: this.rid }); }
  close() { return invoke('android_update_close', { rid: this.rid }); }
}

export const updateService = {
  async platform() { return (await window.HermesNative.getRuntimeInfo()).platform; },
  async check(platform) {
    if (platform === 'windows') {
      const { check } = await import('@tauri-apps/plugin-updater');
      return check({ timeout: 15000 });
    }
    if (platform === 'android') {
      const metadata = await invoke('android_update_check');
      return metadata ? new AndroidUpdate(metadata) : null;
    }
    return null;
  }
};
