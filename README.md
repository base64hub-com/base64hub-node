# base64hub

Base64 encode, decode and validate from the command line or from JavaScript. One small package with
no dependencies: a `b64` command and an ESM library for Node.js 18 and newer.

- Standard (`+/`) and URL-safe (`-_`) alphabets, with or without `=` padding
- Lenient decoding: either alphabet, missing padding, spaces, tabs, line breaks and `data:` URIs are all accepted
- Precise errors: `invalid character '!' at position 4`
- Line wrapping (76 for MIME) and data URIs with MIME type detection
- Same behavior as the [base64hub.com](https://base64hub.com/) web tools and the other base64hub packages

## Install

```sh
npm i -g base64hub
```

The command is called `b64`. To try it without installing:

```sh
npx base64hub "Hello, hub!"
```

As a library:

```sh
npm i base64hub
```

## Command line

```
b64 [flags] [TEXT]
```

With TEXT, `b64` works on the UTF-8 bytes of TEXT. Without it, it reads stdin to the end (or the
`-i` file). Encoding prints the result and one newline; decoding writes the raw bytes and nothing else.

```console
$ b64 "Hello, hub!"
SGVsbG8sIGh1YiE=
$ b64 -d SGVsbG8sIGh1YiE=
Hello, hub!
$ printf '\xfb\xff\xbf' | b64 --url
-_-_
$ b64 --url --no-pad "Привет"
0J_RgNC40LLQtdGC
```

| Flag | Meaning |
|---|---|
| `-d`, `--decode` | Decode instead of encode |
| `-u`, `--url` | Encode with the URL-safe alphabet (`-` and `_`) |
| `-n`, `--no-pad` | Encode without `=` padding |
| `-w N`, `--wrap N` | Wrap encoded output every N characters (`0` = no wrap, `76` = MIME) |
| `--data-uri` | Output a `data:<mime>;base64,...` URI |
| `-m TYPE`, `--mime TYPE` | MIME type for the data URI (otherwise it is detected) |
| `--validate` | Check the input: prints `valid (<variant>, <n> bytes)`, or `invalid: <reason>` to stderr and exits 1 |
| `-i FILE`, `--input FILE` | Read FILE instead of stdin (`-` = stdin) |
| `-o FILE`, `--output FILE` | Write FILE instead of stdout (`-` = stdout) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Print the version |

Flags may come before or after TEXT. Short flags can't be combined (`-dn` is an error) and take
their value as the next argument (`-w 76`, not `-w76`); long flags also accept `--wrap=76`. Use `--`
to end the flags, for example when the input itself starts with a dash: `b64 -d -- -_-_`. A bare
`-` as TEXT means stdin.

These are usage errors: encoding flags (`-u`, `-n`, `-w`, `--data-uri`, `-m`) with `-d` or
`--validate`; `-u`, `-n` or `-w` with `--data-uri` (data URIs are standard padded Base64 on one line);
`--mime` without `--data-uri`; TEXT together with `-i`; the same file for `-i` and `-o`.

Errors go to stderr as `b64: <message>`. Exit codes: `0` success, `1` invalid input or I/O error,
`2` usage error. When a run fails, a file written with `-o` is removed, so no partial output is left.
`b64` behaves exactly like the Go build of the command, the reference implementation.

More examples:

```console
$ echo "eyJhbGciOiJIUzI1NiJ9" | b64 -d
{"alg":"HS256"}
$ b64 --validate "SGVsbG8sIGh1YiE"
valid (either, 11 bytes)
$ b64 -d "Zm9v!"
b64: invalid character '!' at position 4
$ b64 --data-uri -i logo.png
data:image/png;base64,iVBORw0KGgo...
$ b64 -w 76 -i report.pdf -o report.b64
$ b64 -d -i report.b64 -o report.pdf
```

## Library

```js
import { encode, decode, validate, dataUri } from 'base64hub';

encode('Hello, hub!');                           // 'SGVsbG8sIGh1YiE='
encode('Привет', { url: true, pad: false });     // '0J_RgNC40LLQtdGC'
encode(new Uint8Array([0xfb, 0xff, 0xbf]));      // '+/+/'
encode(bytes, { wrap: 76 });                     // MIME line breaks

decode('SGVsbG8sIGh1YiE');                       // Uint8Array(11), padding optional
decode('-_-_');                                  // Uint8Array(3) [251, 255, 191]

validate('a+b_');      // { valid: true, variant: 'mixed', padded: true, bytes: 3 }
validate('Zm9v!');     // { valid: false, error: "invalid character '!' at position 4" }

dataUri(pngBytes);               // 'data:image/png;base64,iVBORw0KGgo...'
dataUri('<svg/>');               // 'data:image/svg+xml;base64,PHN2Zy8+'
dataUri(bytes, 'font/woff2');    // explicit MIME type
```

### `encode(input, options?) → string`

`input` is a string (encoded as UTF-8), `Uint8Array`, `Buffer`, `ArrayBuffer` or any typed array view.
Options: `url` (default `false`), `pad` (default `true`), `wrap` (default `0`; a `\n` after every N
characters, none at the end).

### `decode(text) → Uint8Array`

`text` is a string or its bytes (`Uint8Array`, `Buffer`). Decoding is lenient on purpose:

1. Leading whitespace is skipped. If the input starts with `data:` (any case) and contains
   `;base64,` (lower case), everything up to and including `;base64,` is dropped.
2. Spaces, tabs, CR and LF are ignored anywhere. Other whitespace, such as a no-break space, is an
   invalid character.
3. Up to two trailing `=` are optional; both alphabets are accepted, even mixed in one string.

Errors are found left to right and thrown as a `Base64Error` (also exported) with one of these
messages; `position` counts characters of the cleaned input from 0:

- `invalid character '!' at position 4`
- `unexpected '=' at position 2: padding is only allowed at the end`
- `too much padding: 3 '=' at position 2, at most 2 are allowed`
- `invalid length: 5 characters leave a single character in the last group`

### `validate(text) → object`

Never throws for bad input. Valid exactly when `decode` would succeed:

- `{ valid: true, variant, padded, bytes }`: `variant` is `standard` (`+` or `/` seen), `url`
  (`-` or `_` seen), `mixed` (both) or `either` (neither); `padded` tells whether the length with `=`
  is a multiple of 4; `bytes` is the decoded length.
- `{ valid: false, error }` otherwise, with the message `decode` would throw.

### `dataUri(input, mime?) → string`

Builds `data:<mime>;base64,<payload>`, never wrapped. Without `mime` the type is detected from the
bytes: PNG, JPEG, GIF, WebP, PDF and SVG, then `text/plain;charset=utf-8` for UTF-8 text, else
`application/octet-stream`.

TypeScript types are included.

## Links

- Package page: [base64hub.com/npm/](https://base64hub.com/npm/)
- Documentation: [base64hub.com/docs/npm/](https://base64hub.com/docs/npm/)
- Base64 tools in the browser: [base64hub.com](https://base64hub.com/)

## License

MIT
