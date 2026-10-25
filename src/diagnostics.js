// Classify known transport failures without displaying raw exception text:
// native errors may contain URLs, tickets, headers, or request bodies.
export function transportFailure(error, { timedOut = false, mutation = false, native = false } = {}) {
  const raw = typeof error === 'string' ? error : String(error?.message || '');
  if (/url not allowed|configured scope|denied by.*scope/i.test(raw)) return {
    code: 'NATIVE_SCOPE_DENIED', message: 'Izin jaringan aplikasi menolak URL API. Pastikan installer yang digunakan adalah build terbaru.', retryable: false
  };
  if (/(?:http|websocket)\.[a-z_]+.*not allowed|command.*(?:not allowed|not found)|plugin.*not found/i.test(raw)) return {
    code: 'NATIVE_PERMISSION_DENIED', message: 'Perintah jaringan native tidak tersedia atau tidak diizinkan pada build aplikasi ini.', retryable: false
  };
  if (/connection refused|actively refused|ECONNREFUSED/i.test(raw)) return {
    code: 'CONNECTION_REFUSED', message: 'Koneksi ke port API ditolak. Periksa service HTTP port 3450, alamat bind, dan firewall server.', retryable: !mutation
  };
  const unknownOutcome = mutation ? 'Hasil permintaan belum diketahui; periksa status sebelum mengirim ulang. ' : '';
  if (timedOut || /timed out|timeout/i.test(raw)) return {
    code: 'TIMEOUT', message: `${unknownOutcome}Batas waktu koneksi API habis. Periksa akses ke port 3450 melalui LAN atau subnet Tailscale.`, retryable: !mutation
  };
  if (!native && /failed to fetch|load failed|networkerror/i.test(raw)) return {
    code: 'BROWSER_FETCH_FAILED', message: `${unknownOutcome}Fetch browser/WebView gagal. Penyebabnya dapat berupa jaringan, CORS, CSP, atau izin akses jaringan lokal.`, retryable: !mutation
  };
  return {
    code: 'NETWORK_ERROR', message: `${unknownOutcome}Server belum dapat dijangkau melalui transport ${native ? 'native' : 'browser'}. Periksa LAN atau subnet Tailscale.`, retryable: !mutation
  };
}

export function redactDiagnostic(message, secrets = []) {
  let result = String(message);
  for (const secret of secrets) if (typeof secret === 'string' && secret.length) result = result.split(secret).join('[redacted]');
  return result;
}

export function formatApiError(error) {
  const operation = error.endpoint ? `${error.method || 'GET'} ${error.endpoint}` : '';
  const fields = [error.code, error.status ? `HTTP ${error.status}` : '', operation].filter(Boolean);
  return `${error.message || 'Permintaan gagal.'}${fields.length ? ` [${fields.join(' · ')}]` : ''}`;
}
