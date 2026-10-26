// Only responses received through the configured Hermes backend may revoke a session.
const TERMINAL_CODES = new Set([
  'TOKEN_REUSE_DETECTED', 'DEVICE_REVOKED', 'SESSION_REVOKED', 'TOKEN_REVOKED',
  'INVALID_REFRESH_TOKEN', 'REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_EXPIRED',
  'REFRESH_EXPIRED', 'SESSION_EXPIRED'
]);

export function isBackendCredentialRejection(error, baseUrl, phase = 'request') {
  if (error?.source !== 'hermes-backend' || error.backendUrl !== baseUrl) return false;
  if (![400, 401, 403].includes(error.status) || error.code === 'INVALID_RESPONSE') return false;
  if (TERMINAL_CODES.has(error.code)) return true;
  return error.status === 401 && ['refresh', 'retry'].includes(phase);
}
