import { updateService } from './update_service.js';

const supported = platform => ['windows', 'android'].includes(platform);
export function updateError(error) {
  const raw = typeof error === 'string' ? error : String(error?.message || '');
  if (error?.code === 'UPDATE_CERTIFICATE_MISMATCH') return 'Sertifikat APK berbeda dari aplikasi terpasang. Paket ini belum dapat dipasang sebagai pembaruan.';
  if (error?.code === 'UPDATE_PACKAGE_MISMATCH') return 'APK bukan untuk Hermes Cockpit pada perangkat ini.';
  if (/signature|signed.version|public.?key|minisign/i.test(raw) || error?.code === 'UPDATE_VERIFICATION_FAILED') return 'Tanda tangan paket tidak sesuai. Pembaruan belum dapat dipasang; periksa release resmi berikutnya.';
  if (error?.code === 'UPDATE_FEED_NOT_READY' || /404/i.test(raw)) return 'Belum tersedia paket pembaruan pada layanan release.';
  if (error?.code === 'UPDATE_FEED_INVALID') return 'Format feed pembaruan tidak valid. Sesi perangkat tetap tersimpan.';
  if (error?.code === 'UPDATE_PLATFORM_UNAVAILABLE') return 'Paket pembaruan untuk perangkat ini belum tersedia.';
  if (error?.code === 'UPDATE_STORAGE_ERROR') return 'Penyimpanan perangkat belum dapat menampung pembaruan.';
  if (error?.code === 'UPDATE_INSTALL_FAILED') return 'Pemasangan belum berhasil. Periksa izin pemasangan pada perangkat lalu coba lagi.';
  return 'Pembaruan belum dapat diselesaikan. Periksa koneksi internet lalu coba lagi.';
}

export class AppUpdater {
  constructor({ service = updateService, interval = 6 * 60 * 60 * 1000 } = {}) {
    this.service = service;
    this.interval = interval;
    this.listeners = new Set();
    this.update = null;
    this.state = { status: 'idle', platform: null, version: null, notes: '', date: null, checkedAt: null, bytes: 0, total: null, error: '', notice: '' };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.state); }
  set(value) { Object.assign(this.state, value); this.emit(); }
  get busy() { return ['checking', 'downloading', 'verifying', 'installing'].includes(this.state.status); }
  reportError(error) {
    // This controller owns update state only; it has no workspace/auth/storage dependency.
    this.set({ status: 'error', error: updateError(error) });
  }
  async start() {
    try {
      const platform = await this.service.platform();
      this.set({ platform, status: supported(platform) ? 'idle' : 'unsupported' });
      if (!supported(platform)) return;
      await this.check();
      this.timer = setInterval(() => this.check(), this.interval);
    } catch (error) { this.reportError(error); }
  }
  async check() {
    if (!supported(this.state.platform) || this.busy || this.state.status === 'ready') return;
    this.set({ status: 'checking', version: null, notes: '', date: null, error: '', notice: '' });
    try {
      await this.update?.close().catch(() => {});
      this.update = null;
      const update = await this.service.check(this.state.platform);
      this.update = update;
      this.set({ status: update ? 'available' : 'current', version: update?.version || null, notes: String(update?.body || ''), date: update?.date || null, checkedAt: new Date().toISOString(), bytes: 0, total: null });
      // Checking is automatic; downloading and installing require user clicks.
    } catch (error) { this.reportError(error); }
  }
  async download() {
    if (!this.update || this.busy || this.state.status === 'ready') return;
    this.set({ status: 'downloading', bytes: 0, total: null, error: '', notice: '' });
    try {
      await this.update.download(event => {
        if (event.event === 'Started') this.set({ bytes: 0, total: event.data?.contentLength || null });
        if (event.event === 'Progress') this.set({ bytes: this.state.bytes + Math.max(0, Number(event.data?.chunkLength) || 0) });
        if (event.event === 'Finished') this.set({ status: 'verifying' });
      }, { timeout: 300000 });
      this.set({ status: 'ready' });
    } catch (error) { this.set({ status: 'error', error: updateError(error) }); }
  }
  async install() {
    if (!this.update || this.state.status !== 'ready') return;
    this.set({ status: 'installing', error: '', notice: '' });
    try {
      const result = await this.update.install({ restartAfterInstall: true });
      if (result?.status === 'cancelled') this.set({ status: 'ready', notice: 'Pemasangan dibatalkan. Paket masih siap dipasang.' });
      else if (result?.status === 'permission_required') this.set({ status: 'ready', notice: 'Izinkan pemasangan dari Hermes Cockpit pada pengaturan Android, lalu coba lagi.' });
      else this.set({ status: 'installed' });
    } catch (error) { this.set({ status: 'ready', error: updateError(error) }); }
  }
  async dispose() {
    clearInterval(this.timer);
    if (this.state.status !== 'installing') await this.update?.close().catch(() => {});
  }
}
