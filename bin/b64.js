#!/usr/bin/env node
// b64: Base64 encode, decode and validate from the command line.
// Flags, messages and exit codes follow the Go build of b64, the reference implementation.
import { closeSync, fstatSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { encode, decode, validate, dataUri, Base64Error } from '../index.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `b64 – Base64 encode, decode and validate. https://base64hub.com/cli/

Usage: b64 [flags] [TEXT]

Encodes the UTF-8 bytes of TEXT or, without TEXT, standard input to Base64.

Flags:
  -d, --decode        decode Base64 to raw bytes (whitespace, either alphabet,
                      missing padding and a data: URI prefix are accepted)
  -u, --url           encode with the URL-safe alphabet (- and _)
  -n, --no-pad        encode without = padding
  -w, --wrap N        wrap encoded output every N characters (0 = off, 76 = MIME)
      --data-uri      encode as a data: URI, MIME type detected from the content
  -m, --mime TYPE     MIME type for --data-uri
      --validate      check the input and report its variant and decoded size
  -i, --input FILE    read FILE instead of standard input (- = stdin)
  -o, --output FILE   write FILE instead of standard output (- = stdout)
  -h, --help          show this help
  -v, --version       print the version
  --                  end of flags: the next argument is TEXT even if it starts with -

Exit status: 0 success, 1 invalid input or I/O error, 2 usage error.

Examples:
  b64 "Hello, hub!"                 SGVsbG8sIGh1YiE=
  b64 -d SGVsbG8sIGh1YiE=           Hello, hub!
  b64 --url --no-pad "Привет"       0J_RgNC40LLQtdGC
  b64 --validate -i token.txt
  b64 -w 76 -i photo.jpg -o photo.b64
  b64 --data-uri -i logo.png

Docs: https://base64hub.com/docs/npm/
`;

const EXIT_OK = 0;
const EXIT_INVALID = 1; // invalid input or I/O error
const EXIT_USAGE = 2;

class Failure extends Error {
  constructor(message, code = EXIT_INVALID) {
    super(message);
    this.code = code;
  }
}

const usage = (message) => new Failure(message, EXIT_USAGE);

const GO_ESCAPES = { 7: '\\a', 8: '\\b', 12: '\\f', 10: '\\n', 13: '\\r', 9: '\\t', 11: '\\v' };

// Go's strconv.Quote: a double-quoted string with Go escapes.
function goQuote(s) {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '"' || ch === '\\') out += '\\' + ch;
    else if (ch === ' ' || /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(ch)) out += ch;
    else if (cp in GO_ESCAPES) out += GO_ESCAPES[cp];
    else if (cp < 32 || cp === 127) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp >= 0xd800 && cp <= 0xdfff) out += '\\ufffd';
    else if (cp < 0x10000) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += '\\U' + cp.toString(16).padStart(8, '0');
  }
  return out + '"';
}

// Only characters that Go's strings.TrimSpace removes.
const GO_BLANK = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

const BOOL = {
  '-d': 'decode', '--decode': 'decode',
  '-u': 'url', '--url': 'url',
  '-n': 'noPad', '--no-pad': 'noPad',
  '--data-uri': 'dataUri',
  '--validate': 'validate',
  '-h': 'help', '--help': 'help',
  '-v': 'version', '--version': 'version',
};

// Flags and TEXT may come in any order; "--" ends the flags. Short flags take their value as
// the next argument and can't be combined; long flags also accept --name=value.
function parse(args) {
  const c = { wrap: 0, mime: '', mimeSet: false, input: '', output: '', text: undefined };
  const positional = [];
  let stdinDash = false; // a bare "-" before "--" means standard input
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a === '-' || !a.startsWith('-')) {
      if (a === '-' && positional.length === 0) stdinDash = true;
      positional.push(a);
      continue;
    }
    let name = a;
    let val;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        name = a.slice(0, eq);
        val = a.slice(eq + 1);
      }
    }
    const value = () => {
      if (val !== undefined) return val;
      if (i + 1 >= args.length) throw usage(`option ${name} needs a value`);
      return args[++i];
    };
    if (name in BOOL) {
      if (val !== undefined) throw usage(`option ${name} takes no value`);
      c[BOOL[name]] = true;
    } else if (name === '-w' || name === '--wrap') {
      const v = value();
      const n = /^[+-]?[0-9]+$/.test(v) ? BigInt(v) : -1n;
      if (n < 0n || n > 9223372036854775807n) {
        throw usage(`option ${name} needs a whole number of 0 or more, got ${goQuote(v)}`);
      }
      c.wrap = Number(n);
    } else if (name === '-m' || name === '--mime') {
      c.mime = value();
      c.mimeSet = true;
      if (GO_BLANK.test(c.mime) || /[ \t\r\n,]/.test(c.mime)) {
        throw usage(`option ${name} needs a MIME type like image/png, got ${goQuote(c.mime)}`);
      }
    } else if (name === '-i' || name === '--input') {
      c.input = value();
    } else if (name === '-o' || name === '--output') {
      c.output = value();
    } else if (!a.startsWith('--') && Buffer.byteLength(a) > 2) {
      throw usage(`unknown option ${a} (short options can't be combined)`);
    } else {
      throw usage(`unknown option ${name}`);
    }
    if (c.help || c.version) return c;
  }

  if (positional.length === 1) {
    if (stdinDash) {
      if (c.input !== '' && c.input !== '-') throw usage('give either TEXT or --input, not both');
      c.input = '-';
    } else {
      if (c.input !== '') throw usage('give either TEXT or --input, not both');
      c.text = positional[0];
    }
  } else if (positional.length > 1) {
    throw usage(
      `too many arguments: expected one TEXT, got ${positional.length} (quote TEXT that contains spaces)`,
    );
  }

  if (c.decode && c.validate) throw usage("--decode and --validate can't be combined");
  if (c.decode || c.validate) {
    const mode = c.validate ? '--validate' : '--decode';
    const encodingOnly = [
      [c.url, '--url'], [c.noPad, '--no-pad'], [c.wrap > 0, '--wrap'], [c.dataUri, '--data-uri'], [c.mimeSet, '--mime'],
    ];
    for (const [set, flag] of encodingOnly) {
      if (set) throw usage(`${flag} only applies to encoding, not to ${mode}`);
    }
  }
  if (c.dataUri) {
    for (const [set, flag] of [[c.url, '--url'], [c.noPad, '--no-pad'], [c.wrap > 0, '--wrap']]) {
      if (set) {
        throw usage(`${flag} can't be combined with --data-uri: data URIs use standard padded Base64 on one line`);
      }
    }
  }
  if (c.mimeSet && !c.dataUri) throw usage('--mime needs --data-uri');
  return c;
}

// Error texts as Go's os package prints them ("open FILE: no such file or directory").
const ERRNO = {
  ENOENT: 'no such file or directory',
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
  EISDIR: 'is a directory',
  ENOTDIR: 'not a directory',
  ELOOP: 'too many levels of symbolic links',
  ENAMETOOLONG: 'file name too long',
  EROFS: 'read-only file system',
  ENOSPC: 'no space left on device',
  ETXTBSY: 'text file busy',
  EBUSY: 'device or resource busy',
  EMFILE: 'too many open files',
  EIO: 'input/output error',
};

function osError(op, path, err) {
  if (!err || typeof err.code !== 'string') return err;
  const reason = ERRNO[err.code] || String(err.message).replace(/^[A-Z]+: /, '').replace(/, \w+ .*$/, '');
  return new Failure(`${op} ${path}: ${reason}`);
}

function openInput(c) {
  if (c.text !== undefined || c.input === '' || c.input === '-') return null;
  let fd;
  try {
    fd = openSync(c.input, 'r');
  } catch (err) {
    throw osError('open', c.input, err);
  }
  if (fstatSync(fd).isDirectory()) {
    closeSync(fd);
    throw new Failure(`${c.input} is a directory`);
  }
  return fd;
}

// Opens the -o file. A regular file (or a new one) is removed again when the run fails,
// so no partial output is left behind.
function openOutput(c) {
  if (c.output === '' || c.output === '-') return null;
  let ost;
  let missing = false;
  try {
    ost = statSync(c.output, { bigint: true });
  } catch (err) {
    missing = err.code === 'ENOENT';
  }
  if (ost && c.input !== '' && c.input !== '-') {
    let ist;
    try {
      ist = statSync(c.input, { bigint: true });
    } catch {
      // Not comparable; reading it reports the problem.
    }
    if (ist && ist.dev === ost.dev && ist.ino === ost.ino) {
      throw usage(`input and output are the same file: ${c.output}`);
    }
  }
  const removable = missing || (ost !== undefined && ost.isFile());
  let fd;
  try {
    fd = openSync(c.output, 'w');
  } catch (err) {
    throw osError('open', c.output, err);
  }
  return { fd, removable, path: c.output };
}

async function readInput(c, fd) {
  if (c.text !== undefined) return new TextEncoder().encode(c.text);
  try {
    if (fd !== null) return readFileSync(fd);
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (err) {
    throw osError('read', fd !== null ? c.input : '/dev/stdin', err);
  }
}

// Returns the bytes to write, or null when --validate found the input invalid (already reported).
function transform(c, input) {
  if (c.validate) {
    const r = validate(input);
    if (!r.valid) {
      process.stderr.write(`invalid: ${r.error}\n`);
      return null;
    }
    return Buffer.from(`valid (${r.variant}, ${r.bytes} bytes)\n`);
  }
  if (c.decode) {
    try {
      return decode(input);
    } catch (err) {
      if (err instanceof Base64Error) throw new Failure(err.message);
      throw err;
    }
  }
  if (c.dataUri) return Buffer.from(dataUri(input, c.mime || undefined) + '\n');
  return Buffer.from(encode(input, { url: !!c.url, pad: !c.noPad, wrap: c.wrap }) + '\n');
}

async function run(args) {
  const c = parse(args);
  if (c.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (c.version) {
    process.stdout.write(`b64 ${version}\n`);
    return EXIT_OK;
  }

  const inFd = openInput(c);
  let out = null;
  let failed = true;
  try {
    out = openOutput(c);
    const result = transform(c, await readInput(c, inFd));
    if (result === null) return EXIT_INVALID;
    if (out) {
      try {
        for (let off = 0; off < result.length; ) off += writeSync(out.fd, result, off, result.length - off);
      } catch (err) {
        throw osError('write', out.path, err);
      }
    } else {
      process.stdout.write(result);
    }
    failed = false;
    return EXIT_OK;
  } finally {
    if (inFd !== null) closeSync(inFd);
    if (out) {
      closeSync(out.fd);
      if (failed && out.removable) {
        try {
          unlinkSync(out.path);
        } catch {
          // Already gone.
        }
      }
    }
  }
}

process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE') throw err;
});

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`b64: ${err && err.message ? err.message : err}\n`);
    process.exitCode = err instanceof Failure ? err.code : EXIT_INVALID;
  },
);
