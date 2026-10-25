export const PAIRING_CODE_PATTERN = '[A-Z2-7]{26}';
const validCode = new RegExp(`^(?:${PAIRING_CODE_PATTERN})$`);

export function normalizePairingCode(value) {
  if (typeof value !== 'string') return '';
  // Copying from terminals/chat can add spacing, zero-width or bidi marks.
  // Keep invalid visible characters so they are rejected, never guessed.
  return value.replace(/[\s\u200B-\u200F\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/[a-z]/g, character => character.toUpperCase());
}

export function pairingCodeError(value) {
  const code = normalizePairingCode(value);
  if (code.length !== 26) return `Kode pairing harus 26 karakter setelah spasi dibersihkan; terbaca ${code.length} karakter.`;
  if (!validCode.test(code)) return 'Kode pairing hanya boleh berisi huruf A–Z dan angka 2–7.';
  return '';
}

export function normalizePairingInput(input) {
  const original = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const code = normalizePairingCode(original);
  if (code !== original) {
    input.value = code;
    if (typeof start === 'number' && typeof end === 'number') {
      input.setSelectionRange(normalizePairingCode(original.slice(0, start)).length, normalizePairingCode(original.slice(0, end)).length);
    }
  }
  input.setCustomValidity(pairingCodeError(code));
}
