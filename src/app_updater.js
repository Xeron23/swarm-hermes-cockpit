import { updateService } from './update_service.js';

const supported = platform => ['windows', 'android'].includes(platform);
const inProgress = status => ['checking', 'downloading', 'verifying', 'installing', 'relaunching'].includes(status);
export function updateError(error) {
  const raw = typeof error === 'string' ? error : String(error?.message || '');
  if (error?.code === 'UPDATE_CERTIFICATE_MISMATCH') return 'Sertifikat APK berbeda dari aplikasi terpasang. Gunakan paket dengan identitas penandatangan yang sama.';
  if (error?.code === 'UPDATE_PACKAGE_MISMATCH') return 'APK bukan untuk Hermes Cockpit pada perangkat ini.';
  if (error?.code === 'UPDATE_DOWNGRADE_REJECTED') return 'Android menolak paket yang lebih lama dari aplikasi terpasang.';
  if (/signature|signed.version|public.?key|minisign/i.test(raw) || error?.code === 'UPDATE_VERIFICATION_FAILED') return 'Tanda tangan paket tidak sesuai. Pembaruan belum dapat dipasang; periksa release resmi berikutnya.';
  if (error?.code === 'UPDATE_FEED_NOT_READY' || /404/i.test(raw)) return 'Rilis stabil bertanda tangan belum tersedia. Periksa lagi setelah release resmi diterbitkan.';
  if (error?.code === 'UPDATE_FEED_INVALID') return 'Format feed pembaruan tidak valid. Sesi perangkat tetap tersimpan.';
  if (error?.code === 'UPDATE_PLATFORM_UNAVAILABLE') return 'Paket pembaruan untuk perangkat ini belum tersedia.';
  if (error?.code === 'UPDATE_STORAGE_ERROR') return 'Penyimpanan perangkat belum dapat menampung pembaruan.';
  if (error?.code === 'UPDATE_INSTALL_FAILED') return 'Pemasangan belum berhasil. Periksa pembaruan kembali sebelum mencoba lagi.';
  return 'Pembaruan belum dapat diselesaikan. Periksa koneksi internet lalu coba lagi.';
}

export class AppUpdater {
  constructor({ service = updateService, interval = 6 * 60 * 60 * 1000 } = {}) {
    this.service = service; this.interval = interval; this.listeners = new Set();
    this.update = null; this.epoch = 0; this.disposed = false; this.started = false;
    this.state = { status: 'idle', platform: null, version: null, notes: '', date: null, checkedAt: null,
      bytes: 0, total: null, verified: false, error: '', errorStage: null, notice: '' };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { if (!this.disposed) for (const listener of this.listeners) listener(this.state); }
  set(value) { Object.assign(this.state, value); this.emit(); }
  get busy() { return inProgress(this.state.status); }
  active(epoch) { return !this.disposed && epoch === this.epoch; }
  reportError(error, errorStage = 'check') { this.set({ status: 'error', verified: false, error: updateError(error), errorStage }); }
  start() {
    if (this.disposed || this.started) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const epoch = this.epoch;
    this.startPromise = (async () => {
      try {
        const platform = await this.service.platform();
        if (!this.active(epoch)) return;
        this.started = true;
        this.set({ platform, status: supported(platform) ? 'idle' : 'unsupported' });
        if (!supported(platform)) return;
        await this.check();
        if (!this.disposed) this.timer = setInterval(() => this.check(), this.interval);
      } catch (error) { if (this.active(epoch)) this.reportError(error); }
      finally { this.startPromise = null; }
    })();
    return this.startPromise;
  }
  async check() {
    if (this.disposed || !supported(this.state.platform) || this.busy || ['ready', 'installed'].includes(this.state.status)) return;
    const epoch = ++this.epoch;
    this.set({ status: 'checking', version: null, notes: '', date: null, verified: false, bytes: 0, total: null, error: '', errorStage: null, notice: '' });
    try {
      await this.update?.close().catch(() => {}); this.update = null;
      const update = await this.service.check(this.state.platform);
      if (!this.active(epoch)) { await update?.close().catch(() => {}); return; }
      this.update = update;
      this.set({ status: update ? 'available' : 'current', version: update?.version || null,
        notes: String(update?.body || '').slice(0, 32000), date: update?.date || null, checkedAt: new Date().toISOString() });
    } catch (error) { if (this.active(epoch)) this.reportError(error, 'check'); }
  }
  async apply() {
    if (this.state.status === 'ready') return this.install();
    return this.download({ installAfterDownload: true });
  }
  async download({ installAfterDownload = false } = {}) {
    if (this.disposed || !this.update || this.busy || !['available', 'error'].includes(this.state.status)
      || this.state.status === 'error' && this.state.errorStage !== 'download') return;
    const epoch = ++this.epoch, update = this.update;
    this.set({ status: 'downloading', bytes: 0, total: null, verified: false, error: '', errorStage: null, notice: '' });
    try {
      await update.download(event => {
        if (!this.active(epoch) || !['downloading', 'verifying'].includes(this.state.status)) return;
        if (event.event === 'Started') {
          const total = Number(event.data?.contentLength);
          this.set({ bytes: 0, total: Number.isFinite(total) && total > 0 ? total : null });
        }
        if (event.event === 'Progress') {
          const chunk = Number(event.data?.chunkLength);
          if (Number.isFinite(chunk) && chunk > 0) this.set({ bytes: this.state.bytes + chunk });
        }
        if (event.event === 'Finished') this.set({ status: 'verifying' });
      }, { timeout: 300000 });
      if (!this.active(epoch)) return;
      // Finished means transfer EOF. Only resolved native download means verified.
      this.set({ status: 'ready', verified: true });
      if (installAfterDownload) await this.install();
    } catch (error) { if (this.active(epoch)) this.reportError(error, 'download'); }
    finally {
      if (this.disposed && !['installing', 'relaunching', 'installed'].includes(this.state.status)) {
        await update.close().catch(() => {});
        if (this.update === update) this.update = null;
      }
    }
  }
  async install() {
    if (this.disposed || !this.update || this.state.status !== 'ready' || !this.state.verified) return;
    const epoch = ++this.epoch;
    this.set({ status: 'installing', error: '', errorStage: null, notice: '' });
    try {
      const result = await this.update.install({ restartAfterInstall: true });
      if (!this.active(epoch)) return;
      if (this.state.platform === 'windows') this.set({ status: 'relaunching', notice: 'Installer Windows dimulai. Aplikasi akan dibuka kembali setelah pembaruan.' });
      else if (result?.status === 'cancelled') this.set({ status: 'ready', notice: 'Pemasangan dibatalkan. Paket terverifikasi masih siap dipasang.' });
      else if (result?.status === 'permission_required') this.set({ status: 'ready', notice: 'Izinkan pemasangan dari Hermes Cockpit pada pengaturan Android, lalu coba lagi.' });
      else if (result?.status === 'installed') this.set({ status: 'installed' });
      else throw { code: 'UPDATE_INSTALL_FAILED' };
    } catch (error) {
      if (!this.active(epoch)) return;
      if (this.state.platform === 'android' && ['UPDATE_CERTIFICATE_MISMATCH', 'UPDATE_PACKAGE_MISMATCH', 'UPDATE_DOWNGRADE_REJECTED'].includes(error?.code)) {
        this.set({ status: 'ready', error: updateError(error), errorStage: 'install' });
        return;
      }
      await this.update?.close().catch(() => {}); this.update = null;
      this.set({ version: null }); this.reportError(error, 'install');
    }
  }
  async dispose() {
    this.disposed = true; this.epoch++; clearInterval(this.timer);
    if (!['installing', 'relaunching', 'installed'].includes(this.state.status)) await this.update?.close().catch(() => {});
  }
}
