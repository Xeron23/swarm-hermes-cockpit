import { listThemePresets, DEFAULT_THEME_ID } from './theme_registry.js';
import { esc } from './ui.js';

export function renderThemeCard(preset, activeThemeId) {
  const isActive = preset.id === activeThemeId;
  const colors = [
    ['Primary', preset.primary],
    ['Secondary', preset.secondary],
    ['Supporting 1', preset.support1],
    ['Supporting 2', preset.support2]
  ];
  return `
    <button id="theme-${esc(preset.id)}" type="button" class="theme-card ${isActive ? 'active' : ''}"
      data-action="theme-select" data-theme-id="${esc(preset.id)}" aria-pressed="${isActive}">
      <span class="theme-card-head">
        <span class="theme-name">${esc(preset.name)}</span>
        <span class="theme-badge-active" ${isActive ? '' : 'hidden'}>✓ Aktif</span>
      </span>
      <span class="theme-swatches">
        ${colors.map(([label, color]) => `
          <span class="theme-color">
            <span class="swatch" style="background-color:${esc(color)}" aria-hidden="true"></span>
            <span class="theme-color-label">${esc(label)}</span>
            <span class="theme-color-value">${esc(color)}</span>
          </span>
        `).join('')}
      </span>
    </button>
  `;
}

export function renderThemePanel(activeThemeId = DEFAULT_THEME_ID) {
  return `
    <div id="theme-panel-backdrop" class="theme-panel-overlay" data-theme-backdrop>
      <section class="theme-panel-dialog" role="dialog" aria-modal="true"
        aria-labelledby="theme-panel-title" aria-describedby="theme-panel-description">
        <header class="theme-panel-header">
          <div>
            <h2 id="theme-panel-title">Tampilan &amp; Tema</h2>
            <p id="theme-panel-description" class="muted">Pilih palet warna antarmuka Hermes Cockpit.</p>
          </div>
          <button id="theme-close" type="button" class="icon-button" data-action="theme-dismiss" aria-label="Tutup panel tema">✕</button>
        </header>
        <div class="theme-panel-body">
          <div class="theme-grid" role="group" aria-label="Pilihan tema">
            ${listThemePresets().map(p => renderThemeCard(p, activeThemeId)).join('')}
          </div>
        </div>
        <footer class="theme-panel-footer">
          <button id="theme-reset" type="button" class="secondary-button" data-action="theme-reset">Kembalikan ke Default</button>
          <button id="theme-done" type="button" class="primary-button" data-action="theme-dismiss">Selesai</button>
        </footer>
      </section>
    </div>
  `;
}
