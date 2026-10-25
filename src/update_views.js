import { esc } from './ui.js';
import { BUILD_INFO } from './build_info.js';

export const updateStatus = status => ({ idle: 'Belum diperiksa', checking: 'Memeriksa pembaruan…', available: 'Pembaruan tersedia', current: 'Versi terpasang sudah terbaru', downloading: 'Mengunduh pembaruan…', verifying: 'Memverifikasi paket…', ready: 'Pembaruan siap dipasang', installing: 'Menunggu pemasangan…', installed: 'Pembaruan terpasang', error: 'Pembaruan belum selesai', unsupported: 'Pembaruan tersedia di aplikasi Windows dan Android' })[status] || status;
export function updateBody(state) {
  const size = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const progress = ['downloading', 'verifying'].includes(state.status) ? `<progress class="update-progress" aria-label="Progres unduhan pembaruan" ${state.total ? `max="${state.total}" value="${Math.min(state.bytes, state.total)}"` : ''}></progress><p>${esc(size(state.bytes))}${state.total ? ` / ${esc(size(state.total))}` : ''}</p>` : '';
  return `<section id="updates-panel"><dl class="connection-details"><dt>Versi terpasang</dt><dd>${esc(BUILD_INFO.version)} · build ${esc(BUILD_INFO.run || 'local')}</dd><dt>Status</dt><dd role="status">${esc(updateStatus(state.status))}</dd>${state.version ? `<dt>Pembaruan</dt><dd>${esc(state.version.replace('+build.', ' · build '))}</dd>` : ''}</dl>${progress}${state.error ? `<p role="alert" class="notice">${esc(state.error)}</p>` : ''}${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}${state.status === 'unsupported' ? '<p>Buka Hermes Cockpit yang terpasang untuk mengunduh dan memasang pembaruan.</p>' : `<p>Pembaruan diperiksa saat aplikasi dibuka dan setiap 6 jam. Unduhan serta pemasangan dimulai saat Anda memilihnya.</p>${state.platform === 'android' ? '<p>Android akan meminta konfirmasi pemasangan. Data dan pairing dipertahankan saat APK diperbarui dengan sertifikat yang sama.</p>' : '<p>Aplikasi akan ditutup sebentar saat Anda memasang dan memulai ulang pembaruan.</p>'}`}${state.notes ? `<h3>Catatan release</h3><pre>${esc(state.notes.slice(0, 6000))}</pre>` : ''}</section>`;
}
export function updateFooter(state) {
  if (state.status === 'unsupported') return '';
  const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(state.status);
  const check = `<button class="secondary-button" data-action="update-check" ${busy || state.status === 'ready' ? 'disabled' : ''}>Periksa pembaruan</button>`;
  const download = state.version && ['available', 'error'].includes(state.status) ? '<button class="primary-button" data-action="update-download">Unduh pembaruan</button>' : '';
  const install = state.status === 'ready' ? `<button class="primary-button" data-action="update-confirm">${state.platform === 'android' ? 'Pasang APK' : 'Pasang & mulai ulang'}</button>` : '';
  return `${check}${download}${install}`;
}
