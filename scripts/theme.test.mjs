import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_THEME_ID, getThemePreset, listThemePresets } from '../src/theme_registry.js';
import { ThemeManager, THEME_STORAGE_KEY } from '../src/theme_manager.js';

test('theme registry contains exactly the four requested palette presets', () => {
  const presets = listThemePresets();
  assert.equal(presets.length, 4);

  const expected = {
    'ocean-mist': {
      primary: '#3368A0',
      secondary: '#66A3BF',
      support1: '#C8DFDB',
      support2: '#F2EFE7',
      colorScheme: 'light'
    },
    'sunset-gold': {
      primary: '#FF933E',
      secondary: '#FFCB56',
      support1: '#FFE9A9',
      support2: '#73A5CA',
      colorScheme: 'light'
    },
    'tropical-tide': {
      primary: '#8AD6D1',
      secondary: '#359FA0',
      support1: '#FFF0C5',
      support2: '#FF8C52',
      colorScheme: 'light'
    },
    'midnight-slate': {
      primary: '#1B3C53',
      secondary: '#234C6A',
      support1: '#456882',
      support2: '#D2C1B6',
      colorScheme: 'dark'
    }
  };

  for (const [id, exp] of Object.entries(expected)) {
    const p = THEMES[id];
    assert.ok(p, `Preset ${id} must exist`);
    assert.equal(p.primary, exp.primary, `${id} primary mismatch`);
    assert.equal(p.secondary, exp.secondary, `${id} secondary mismatch`);
    assert.equal(p.support1, exp.support1, `${id} support1 mismatch`);
    assert.equal(p.support2, exp.support2, `${id} support2 mismatch`);
    assert.equal(p.colorScheme, exp.colorScheme, `${id} colorScheme mismatch`);
    assert.ok(p.tokens['--brand-primary'], `${id} must define --brand-primary`);
    assert.ok(p.tokens['--brand-secondary'], `${id} must define --brand-secondary`);
    assert.ok(p.tokens['--bg'], `${id} must define --bg`);
    assert.ok(p.tokens['--surface'], `${id} must define --surface`);
  }
});

test('default theme is Ocean Mist and invalid IDs safely resolve to default', () => {
  assert.equal(DEFAULT_THEME_ID, 'ocean-mist');
  assert.equal(getThemePreset('non-existent-theme').id, 'ocean-mist');
  assert.equal(getThemePreset(null).id, 'ocean-mist');
});

test('ThemeManager persists preference and restores on next initialization', () => {
  const memoryStore = new Map();
  const mockStorage = {
    getItem: k => memoryStore.get(k) || null,
    setItem: (k, v) => memoryStore.set(k, String(v)),
    removeItem: k => memoryStore.delete(k)
  };

  const manager1 = new ThemeManager({ storage: mockStorage });
  assert.equal(manager1.initialize(), 'ocean-mist');

  // Change to Sunset Gold
  manager1.setTheme('sunset-gold');
  assert.equal(manager1.getTheme().id, 'sunset-gold');
  assert.equal(mockStorage.getItem(THEME_STORAGE_KEY), 'sunset-gold');

  // Initialize a new manager instance on same storage
  const manager2 = new ThemeManager({ storage: mockStorage });
  assert.equal(manager2.initialize(), 'sunset-gold');
  assert.equal(manager2.getTheme().id, 'sunset-gold');
});
