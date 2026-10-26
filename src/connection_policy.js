export const RECOVERY_CODES = new Set(['REFRESH_UNCERTAIN', 'REFRESH_RECOVERY_REQUIRED']);
export const recoveryNeeded = error => RECOVERY_CODES.has(error?.code);
export const retryableRead = error => [500, 502, 503, 504].includes(error?.status) ||
  (error?.retryable === true && error.status === 0);
export function reconnectDelay(attempt, base = 1000, random = Math.random) {
  return Math.round(Math.min(base * 2 ** Math.min(attempt, 5), 30000) * (0.8 + random() * 0.2));
}
export function recoveryRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
export const clearedConnectionError = (scope, state, previousVersion) => scope === 'connection' &&
  (state.status === 'connected' || state.syncVersion > previousVersion);
