import { esc } from './ui.js';
import { BUILD_INFO } from './build_info.js';

export const updateStatus = status => ({ idle: 'Belum diperiksa', checking: 'Memeriksa release stabil…', available: 'Pembaruan tersedia', current: 'Versi terpasang sudah terbaru', downloading: 'Mengunduh pembaruan…', verifying: 'Memverifikasi tanda tangan paket…', ready: 'Pembaruan siap dipasang', installing: 'Menunggu pemasangan…', relaunching: 'Installer Windows berjalan · aplikasi akan dimulai ulang', installed: 'Android melaporkan pemasangan selesai', error: 'Pembaruan belum selesai', unsupported: 'Pembaruan tersedia di aplikasi Windows dan Android' })[status] || status;
export function updateBody(state) {
  const size = bytes => `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`;
  const progress = ['downloading', 'verifying'].includes(state.status) ? `<progress class="update-progress" aria-label="Progres unduhan pembaruan" ${state.total ? `max="${state.total}" value="${Math.min(state.bytes, state.total)}"` : ''}></progress><p>${esc(size(state.bytes))}${state.total ? ` / ${esc(size(state.total))}` : ''}</p>` : '';
  return `<section id="updates-panel"><dl class="connection-details"><dt>Versi terpasang</dt><dd>${esc(BUILD_INFO.version)} · build ${esc(BUILD_INFO.run || 'local')}</dd><dt>Status</dt><dd role="status" aria-live="polite">${esc(updateStatus(state.status))}</dd>${state.version ? `<dt>Pembaruan</dt><dd>${esc(state.version.replace('+build.', ' · build '))}</dd>` : ''}</dl>${progress}${state.error ? `<p data-key="updater-error" role="alert" class="notice">${esc(state.error)}</p>` : ''}${state.notice ? `<p data-key="updater-notice" role="status" class="notice">${esc(state.notice)}</p>` : ''}${state.verified ? '<p>Paket telah lolos verifikasi signature dan versi oleh updater native.</p>' : ''}${state.status === 'unsupported' ? '<p>Buka Hermes Cockpit yang terpasang untuk mengunduh dan memasang pembaruan.</p>' : `<p>Feed mengikuti release stabil terbaru di GitHub. Pemeriksaan otomatis tidak mengunduh atau memasang paket.</p><p>Pilih “Unduh & pasang” untuk memulai alur setelah konfirmasi, atau “Unduh saja” untuk memasang nanti.</p>${state.platform === 'android' ? '<p>Android tetap meminta izin pemasangan dan konfirmasi sistem. Upgrade memerlukan package ID dan sertifikat APK yang sama.</p>' : '<p>Windows memakai installer passive dan restartAfterInstall. Aplikasi ditutup saat installer dijalankan.</p>'}`}${state.notes ? `<h3 id="update-notes-title">Catatan release</h3><pre id="update-release-notes">${esc(state.notes.slice(0, 32000))}</pre>` : ''}</section>`;
}
export function updateFooter(state) {
  if (state.status === 'unsupported') return '';
  const busy = ['checking', 'downloading', 'verifying', 'installing', 'relaunching'].includes(state.status);
  const check = `<button class="secondary-button" data-action="update-check" ${busy || ['ready', 'installed'].includes(state.status) ? 'disabled' : ''}>Periksa pembaruan</button>`;
  const available = state.version && (state.status === 'available' || state.status === 'error' && state.errorStage === 'download');
  const apply = available ? '<button class="primary-button" data-action="update-apply-confirm">Unduh &amp; pasang</button><button class="secondary-button" data-action="update-download">Unduh saja</button>' : '';
  const install = state.status === 'ready' && state.verified ? `<button class="primary-button" data-action="update-confirm">${state.platform === 'android' ? 'Pasang APK' : 'Pasang & mulai ulang'}</button>` : '';
  return `${check}${apply}${install}`;
}
