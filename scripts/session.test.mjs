import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSession,
  saveSession,
  clearSession,
  checkStorageReady,
  AUTH_KEY
} from '../src/session_storage.js';

test('checkStorageReady verifies write and remove roundtrip', () => {
  const store = new Map();
  const mockStorage = {
    getItem: k => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const result = checkStorageReady(mockStorage);
  assert.equal(result.ready, true);
  assert.equal(store.has('__hermes_storage_probe__'), false);
});

test('saveSession and loadSession preserve session record across reloads', () => {
  const store = new Map();
  const mockStorage = {
    getItem: k => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };

  const validRecord = {
    server: 'http://192.168.1.4:3450',
    workspace_id: 'ws-123',
    device_id: 'dev-456',
    access_token: 'acc-token-xyz',
    refresh_token: 'ref-token-abc'
  };

  const saveResult = saveSession(validRecord, mockStorage);
  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.status, 'saved');

  // Load on same server
  const loadResult = loadSession('http://192.168.1.4:3450', mockStorage);
  assert.equal(loadResult.status, 'valid');
  assert.deepEqual(loadResult.session, validRecord);

  // Load on mismatched server
  const mismatchResult = loadSession('http://192.168.1.99:3450', mockStorage);
  assert.equal(mismatchResult.status, 'server_mismatch');
});

test('clearSession cleanly purges stored auth record', () => {
  const store = new Map([[AUTH_KEY, '{"server":"test"}']]);
  const mockStorage = {
    getItem: k => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };

  const clearResult = clearSession(mockStorage);
  assert.equal(clearResult.ok, true);
  assert.equal(store.has(AUTH_KEY), false);
});
