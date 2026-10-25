import { THEMES, DEFAULT_THEME_ID, getThemePreset } from './theme_registry.js';

export const THEME_STORAGE_KEY = 'hermes_theme_v1';

export class ThemeManager {
  constructor({ storage = globalThis?.localStorage } = {}) {
    this.storage = storage;
    this.currentThemeId = DEFAULT_THEME_ID;
    this.listeners = new Set();
  }

  loadPreference() {
    try {
      const saved = this.storage?.getItem(THEME_STORAGE_KEY);
      if (saved && THEMES[saved]) {
        return saved;
      }
    } catch {
      // Storage unavailable or disabled
    }
    return DEFAULT_THEME_ID;
  }

  savePreference(themeId) {
    try {
      this.storage?.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      // In-memory theme still works
    }
  }

  applyToDom(preset) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', preset.id);
    root.style.colorScheme = preset.colorScheme;

    for (const [key, val] of Object.entries(preset.tokens)) {
      root.style.setProperty(key, val);
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', preset.primary);
    }
  }

  initialize() {
    const id = this.loadPreference();
    this.setTheme(id, false);
    return this.currentThemeId;
  }

  getTheme() {
    return getThemePreset(this.currentThemeId);
  }

  setTheme(themeId, persist = true) {
    const preset = getThemePreset(themeId);
    this.currentThemeId = preset.id;
    if (persist) {
      this.savePreference(preset.id);
    }
    this.applyToDom(preset);
    for (const listener of this.listeners) {
      try {
        listener(preset);
      } catch {
        // Safe emission
      }
    }
    return preset;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const themeManager = new ThemeManager();
