// base64hub: Base64 encode, decode and validate (RFC 4648), zero dependencies.
// Behavior follows the shared base64hub contract; see testdata/vectors.json.

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const STD_CODES = codes(STD);
const URL_CODES = codes(URL_SAFE);
const PAD = 61; // '='
const LF = 10;

// ASCII code -> 6-bit value for both alphabets, -1 for anything else.
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  VALUES[STD.charCodeAt(i)] = i;
  VALUES[URL_SAFE.charCodeAt(i)] = i;
}

const utf8 = new TextEncoder();
const ascii = new TextDecoder();

function codes(alphabet) {
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = alphabet.charCodeAt(i);
  return out;
}

/** Error thrown by decode() for input that is not valid Base64. */
export class Base64Error extends Error {
  constructor(message, position) {
    super(message);
    this.name = 'Base64Error';
    if (position !== undefined) this.position = position;
  }
}

function toBytes(input) {
  if (typeof input === 'string') return utf8.encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('expected a string, Uint8Array, ArrayBuffer or ArrayBufferView');
}

/**
 * Encode bytes (or the UTF-8 bytes of a string) to Base64.
 * Options: url (URL-safe alphabet), pad (default true), wrap (line length, 0 = none).
 */
export function encode(input, { url = false, pad = true, wrap = 0 } = {}) {
  const bytes = toBytes(input);
  if (!Number.isInteger(wrap) || wrap < 0) throw new RangeError('wrap must be a non-negative integer');
  const abc = url ? URL_CODES : STD_CODES;
  const len = bytes.length;
  const rest = len % 3;
  const full = len - rest;
  const size = pad ? Math.ceil(len / 3) * 4 : full / 3 * 4 + (rest ? rest + 1 : 0);
  const out = new Uint8Array(size);
  let j = 0;
  for (let i = 0; i < full; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[j++] = abc[n >> 18];
    out[j++] = abc[(n >> 12) & 63];
    out[j++] = abc[(n >> 6) & 63];
    out[j++] = abc[n & 63];
  }
  if (rest) {
    const n = (bytes[full] << 16) | (rest === 2 ? bytes[full + 1] << 8 : 0);
    out[j++] = abc[n >> 18];
    out[j++] = abc[(n >> 12) & 63];
    if (rest === 2) out[j++] = abc[(n >> 6) & 63];
    else if (pad) out[j++] = PAD;
    if (pad) out[j++] = PAD;
  }
  if (wrap === 0 || size <= wrap) return ascii.decode(out);
  const wrapped = new Uint8Array(size + Math.floor((size - 1) / wrap));
  let k = 0;
  for (let i = 0; i < size; i += wrap) {
    if (i) wrapped[k++] = LF;
    const line = out.subarray(i, i + wrap);
    wrapped.set(line, k);
    k += line.length;
  }
  return ascii.decode(wrapped);
}

// Whitespace is exactly space, tab, CR and LF.
const isSpace = (c) => c === 32 || c === 9 || c === 13 || c === 10;

// The ";base64," of a data URI prefix is looked for within this many bytes, as in the Go build.
const HEADER_WINDOW = 64 * 1024;
const MARKER = utf8.encode(';base64,');
const DATA = utf8.encode('data:');

function textBytes(text) {
  if (typeof text === 'string') return utf8.encode(text);
  if (text instanceof Uint8Array) return text;
  if (text instanceof ArrayBuffer) return new Uint8Array(text);
  if (ArrayBuffer.isView(text)) return new Uint8Array(text.buffer, text.byteOffset, text.byteLength);
  throw new TypeError('expected a string or bytes');
}

// Index where the Base64 payload starts: after leading whitespace and, when the input starts
// with "data:" (any case), after the first ";base64," (literal, lower case).
function payloadStart(b) {
  let i = 0;
  while (i < b.length && isSpace(b[i])) i++;
  if (b.length - i < DATA.length) return i;
  for (let k = 0; k < DATA.length; k++) {
    const c = b[i + k];
    if ((c >= 65 && c <= 90 ? c | 32 : c) !== DATA[k]) return i;
  }
  const end = Math.min(b.length, i + HEADER_WINDOW) - MARKER.length;
  outer: for (let j = i; j <= end; j++) {
    for (let k = 0; k < MARKER.length; k++) if (b[j + k] !== MARKER[k]) continue outer;
    return j + MARKER.length;
  }
  return i;
}

const fatal = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const hex = (n, width) => n.toString(16).padStart(width, '0');
const isPrint = (ch) => ch === ' ' || /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(ch);

// One code point escaped the way Go's strconv.QuoteRune does it, without the quotes.
function quoteRune(cp) {
  const ch = String.fromCodePoint(cp);
  if (ch === "'" || ch === '\\') return '\\' + ch;
  if (isPrint(ch)) return ch;
  const esc = { 7: '\\a', 8: '\\b', 12: '\\f', 10: '\\n', 13: '\\r', 9: '\\t', 11: '\\v' }[cp];
  if (esc) return esc;
  if (cp < 32 || cp === 127) return '\\x' + hex(cp, 2);
  if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
  return cp < 0x10000 ? '\\u' + hex(cp, 4) : '\\U' + hex(cp, 8);
}

// The character starting at b[i], quoted like Go's %q of a rune; a byte that does not start a
// valid UTF-8 sequence is shown as '\xNN'.
function describe(b, i) {
  for (let n = 1; n <= 4 && i + n <= b.length; n++) {
    let s;
    try {
      s = fatal.decode(b.subarray(i, i + n));
    } catch {
      continue;
    }
    if (s.length > 0) return `'${quoteRune(s.codePointAt(0))}'`;
  }
  return `'\\x${hex(b[i], 2)}'`;
}

// Decodes left to right, like the Go build's streaming decoder, so the first problem in the
// input is the one reported. Writes into `out` when given. Returns the validate fields.
function scan(b, out) {
  const fail = (message, position) => {
    throw new Base64Error(message, position);
  };
  let n = 0; // characters in the current group of four
  let pos = 0; // position in the cleaned text
  let pads = 0;
  let padPos = 0;
  let std = false;
  let url = false;
  let total = 0;
  let acc = 0;
  for (let i = payloadStart(b); i < b.length; i++) {
    const c = b[i];
    if (isSpace(c)) continue;
    if (c === PAD) {
      if (pads === 0) padPos = pos;
      pads++;
      pos++;
      continue;
    }
    if (pads > 0) fail(`unexpected '=' at position ${padPos}: padding is only allowed at the end`, padPos);
    const v = c < 128 ? VALUES[c] : -1;
    if (v < 0) fail(`invalid character ${describe(b, i)} at position ${pos}`, pos);
    if (c === 43 || c === 47) std = true;
    else if (c === 45 || c === 95) url = true;
    acc = (acc << 6) | v;
    n++;
    pos++;
    if (n === 4) {
      if (out) {
        out[total] = acc >> 16;
        out[total + 1] = acc >> 8;
        out[total + 2] = acc;
      }
      total += 3;
      n = 0;
      acc = 0;
    }
  }
  if (pads > 2) fail(`too much padding: ${pads} '=' at position ${padPos}, at most 2 are allowed`, padPos);
  if (n === 1) {
    const len = pos - pads;
    fail(`invalid length: ${len} characters leave a single character in the last group`, len - 1);
  }
  if (n > 1) {
    acc <<= 6 * (4 - n);
    if (out) {
      out[total] = acc >> 16;
      if (n === 3) out[total + 1] = acc >> 8;
    }
    total += n - 1;
  }
  const variant = std && url ? 'mixed' : std ? 'standard' : url ? 'url' : 'either';
  return { variant, padded: pos % 4 === 0, bytes: total };
}

/**
 * Decode Base64 text (a string, or its bytes) to bytes. Lenient: either alphabet, optional
 * padding, spaces, tabs, CR, LF and a data: URI prefix are accepted. Throws Base64Error.
 */
export function decode(text) {
  const b = textBytes(text);
  const out = new Uint8Array(Math.floor((b.length * 3) / 4) + 3);
  const { bytes } = scan(b, out);
  return out.slice(0, bytes);
}

/**
 * Check Base64 text without throwing.
 * Valid: { valid: true, variant, padded, bytes }. Invalid: { valid: false, error }.
 */
export function validate(text) {
  try {
    return { valid: true, ...scan(textBytes(text), null) };
  } catch (err) {
    if (err instanceof Base64Error) return { valid: false, error: err.message };
    throw err;
  }
}

function startsWith(bytes, sig, offset = 0) {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const ascii4 = (s) => Array.from(s, (c) => c.charCodeAt(0));

function indexOf(bytes, sig, from) {
  outer: for (let i = from; i + sig.length <= bytes.length; i++) {
    for (let k = 0; k < sig.length; k++) if (bytes[i + k] !== sig[k]) continue outer;
    return i;
  }
  return -1;
}

function sniffMime(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii4('GIF87a')) || startsWith(bytes, ascii4('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii4('RIFF')) && startsWith(bytes, ascii4('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii4('%PDF-'))) return 'application/pdf';
  let start = 0;
  while (start < bytes.length && isSpace(bytes[start])) start++;
  if (startsWith(bytes, ascii4('<svg'), start)) return 'image/svg+xml';
  if (startsWith(bytes, ascii4('<?xml'), start) && indexOf(bytes, ascii4('<svg'), start) >= 0) return 'image/svg+xml';
  let text;
  try {
    text = fatal.decode(bytes);
  } catch {
    return 'application/octet-stream';
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) return 'application/octet-stream';
  return 'text/plain;charset=utf-8';
}

/** Build a data: URI. The MIME type is sniffed from the bytes when not given. */
export function dataUri(input, mime) {
  const bytes = toBytes(input);
  return `data:${mime || sniffMime(bytes)};base64,${encode(bytes)}`;
}
