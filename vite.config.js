import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const host = process.env.TAURI_DEV_HOST;
const buildInfo = {
  version: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
  commit: process.env.GITHUB_SHA || 'local',
  run: process.env.GITHUB_RUN_NUMBER || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null
};

export default defineConfig({
  base: './',
  clearScreen: false,
  define: { __HERMES_BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [{
    name: 'hermes-build-info',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo, null, 2) });
    }
  }],
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  preview: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    emptyOutDir: true
  }
});
