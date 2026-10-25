export const AUTH_KEY = 'hermes_auth_v2';
export const LEGACY_AUTH_KEYS = [
  'hermes_access_token',
  'hermes_refresh_token',
  'hermes_workspace_id',
  'hermes_device_id'
];

export function checkStorageReady(storage = globalThis?.localStorage) {
  if (!storage) return { ready: false, reason: 'STORAGE_UNAVAILABLE' };
  const probeKey = '__hermes_storage_probe__';
  try {
    storage.setItem(probeKey, '1');
    const read = storage.getItem(probeKey);
    storage.removeItem(probeKey);
    return read === '1' ? { ready: true } : { ready: false, reason: 'PROBE_FAILED' };
  } catch (error) {
    return { ready: false, reason: 'STORAGE_WRITE_FAILED', error: error?.message || String(error) };
  }
}

export function validateSessionRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const { server, workspace_id, device_id, access_token, refresh_token } = record;
  return typeof server === 'string' && server.trim().length > 0 &&
    typeof workspace_id === 'string' && workspace_id.trim().length > 0 &&
    typeof device_id === 'string' && device_id.trim().length > 0 &&
    typeof access_token === 'string' && access_token.trim().length > 0 &&
    typeof refresh_token === 'string' && refresh_token.trim().length > 0;
}

export function loadSession(expectedServer, storage = globalThis?.localStorage) {
  if (!storage) return { status: 'storage_unavailable', session: null };
  let raw = null;
  try {
    raw = storage.getItem(AUTH_KEY);
  } catch (error) {
    return { status: 'read_failed', session: null, error: error?.message || 'Read failed' };
  }
  if (!raw) return { status: 'missing', session: null };
  let record = null;
  try {
    record = JSON.parse(raw);
  } catch {
    return { status: 'invalid_record', session: null };
  }
  if (!validateSessionRecord(record)) {
    return { status: 'invalid_record', session: null };
  }
  if (expectedServer && record.server !== expectedServer) {
    return { status: 'server_mismatch', session: record };
  }
  return { status: 'valid', session: record };
}

export function saveSession(record, storage = globalThis?.localStorage) {
  if (!storage) return { ok: false, status: 'storage_unavailable' };
  if (!validateSessionRecord(record)) {
    return { ok: false, status: 'invalid_record' };
  }
  const payload = JSON.stringify(record);
  try {
    storage.setItem(AUTH_KEY, payload);
    const verified = storage.getItem(AUTH_KEY);
    if (verified !== payload) {
      return { ok: false, status: 'write_failed', reason: 'VERIFY_MISMATCH' };
    }
    return { ok: true, status: 'saved' };
  } catch (error) {
    return { ok: false, status: 'write_failed', error: error?.message || 'Write failed' };
  }
}

export function clearSession(storage = globalThis?.localStorage) {
  if (!storage) return { ok: false, status: 'storage_unavailable' };
  try {
    storage.removeItem(AUTH_KEY);
    for (const key of LEGACY_AUTH_KEYS) {
      storage.removeItem(key);
    }
    const check = storage.getItem(AUTH_KEY);
    return check === null ? { ok: true, status: 'cleared' } : { ok: false, status: 'clear_failed' };
  } catch (error) {
    return { ok: false, status: 'clear_failed', error: error?.message || 'Clear failed' };
  }
}
