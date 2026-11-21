/** Bytes accepted by encode() and dataUri(). Strings are encoded as UTF-8. */
export type BytesLike = Uint8Array | ArrayBuffer | ArrayBufferView;

export interface EncodeOptions {
  /** Use the URL-safe alphabet (`-` and `_`, RFC 4648 §5). Default `false`. */
  url?: boolean;
  /** Add `=` padding. Default `true`. */
  pad?: boolean;
  /** Insert `\n` after every `wrap` characters (none at the end). `0` = no wrap, `76` = MIME. Default `0`. */
  wrap?: number;
}

/**
 * Which alphabet the input uses: `standard` (`+` or `/` seen), `url` (`-` or `_` seen),
 * `mixed` (both) or `either` (neither, so it is valid in both).
 */
export type Variant = 'standard' | 'url' | 'mixed' | 'either';

export interface ValidResult {
  valid: true;
  variant: Variant;
  /** The cleaned length, `=` included, is a multiple of 4. */
  padded: boolean;
  /** Length of the decoded data in bytes. */
  bytes: number;
}

export interface InvalidResult {
  valid: false;
  /**
   * The message decode() would throw, for the first problem from the left: one of
   * `invalid character '!' at position 4`,
   * `unexpected '=' at position 2: padding is only allowed at the end`,
   * `too much padding: 3 '=' at position 2, at most 2 are allowed`,
   * `invalid length: 5 characters leave a single character in the last group`.
   */
  error: string;
}

export type ValidateResult = ValidResult | InvalidResult;

/** Thrown by decode() when the input is not valid Base64. */
export class Base64Error extends Error {
  /**
   * 0-based position in the cleaned input (whitespace and data URI prefix removed): the bad
   * character, the first `=`, or the single character left in the last group.
   */
  readonly position?: number;
}

/** Encode bytes, or the UTF-8 bytes of a string, to Base64. */
export function encode(input: string | BytesLike, options?: EncodeOptions): string;

/**
 * Decode Base64 to bytes. Accepts either alphabet (even mixed), missing padding, spaces, tabs,
 * CR and LF anywhere, and a `data:...;base64,` prefix (`data:` in any case, `;base64,` in lower
 * case). Bytes are read as UTF-8 text.
 * @throws {Base64Error} for the first problem from the left.
 */
export function decode(text: string | BytesLike): Uint8Array;

/** Check Base64 without throwing. Valid exactly when decode() would succeed. */
export function validate(text: string | BytesLike): ValidateResult;

/**
 * Build a `data:<mime>;base64,<payload>` URI. When `mime` is omitted it is sniffed:
 * PNG, JPEG, GIF, WebP, PDF, SVG, UTF-8 text, else `application/octet-stream`.
 */
export function dataUri(input: string | BytesLike, mime?: string): string;
