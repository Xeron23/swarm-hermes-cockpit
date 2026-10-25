import { listThemePresets, DEFAULT_THEME_ID } from './theme_registry.js';
import { esc } from './ui.js';

export function renderThemeCard(preset, activeThemeId) {
  const isActive = preset.id === activeThemeId;
  return `
    <button type="button" class="theme-card ${isActive ? 'active' : ''}" data-action="theme-select" data-theme-id="${esc(preset.id)}" aria-pressed="${isActive}">
      <div class="theme-card-head">
        <span class="theme-name">${esc(preset.name)}</span>
        ${isActive ? '<span class="theme-badge-active" aria-label="Aktif">✓ Aktif</span>' : ''}
      </div>
      <div class="theme-swatches" aria-label="Palet warna: primary, secondary, support 1, support 2">
        <span class="swatch" style="background:${esc(preset.primary)}" title="Primary: ${esc(preset.primary)}"></span>
        <span class="swatch" style="background:${esc(preset.secondary)}" title="Secondary: ${esc(preset.secondary)}"></span>
        <span class="swatch" style="background:${esc(preset.support1)}" title="Supporting 1: ${esc(preset.support1)}"></span>
        <span class="swatch" style="background:${esc(preset.support2)}" title="Supporting 2: ${esc(preset.support2)}"></span>
      </div>
      <div class="theme-labels">
        <small>Primary &amp; Secondary</small>
      </div>
    </button>
  `;
}

export function renderThemePanel(activeThemeId = DEFAULT_THEME_ID) {
  const presets = listThemePresets();
  return `
    <div class="theme-panel-overlay" data-action="theme-dismiss" role="dialog" aria-modal="true" aria-labelledby="theme-panel-title">
      <div class="theme-panel-dialog" onclick="event.stopPropagation()">
        <div class="theme-panel-header">
          <div>
            <h2 id="theme-panel-title">Tampilan &amp; Tema</h2>
            <p class="muted">Pilih palet warna antarmuka Hermes Cockpit</p>
          </div>
          <button type="button" class="icon-button" data-action="theme-dismiss" aria-label="Tutup panel tema">✕</button>
        </div>
        <div class="theme-grid">
          ${presets.map(p => renderThemeCard(p, activeThemeId)).join('')}
        </div>
        <div class="theme-panel-footer">
          <button type="button" class="secondary-button" data-action="theme-reset">Kembalikan ke Default</button>
          <button type="button" class="primary-button" data-action="theme-dismiss">Selesai</button>
        </div>
      </div>
    </div>
  `;
}
