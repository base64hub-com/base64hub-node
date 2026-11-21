import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/b64.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function b64(args, input, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { input: Buffer.from(input ?? ''), cwd });
  return { code: r.status, out: r.stdout.toString('utf8'), raw: r.stdout, err: r.stderr.toString('utf8') };
}

test('contract examples', () => {
  assert.deepEqual(b64(['Hello, hub!']), { code: 0, out: 'SGVsbG8sIGh1YiE=\n', raw: Buffer.from('SGVsbG8sIGh1YiE=\n'), err: '' });
  const d = b64(['-d', 'SGVsbG8sIGh1YiE=']);
  assert.equal(d.code, 0);
  assert.equal(d.out, 'Hello, hub!');
  assert.equal(b64(['--url'], Buffer.from([0xfb, 0xff, 0xbf])).out, '-_-_\n');
  assert.equal(b64(['--url', '--no-pad', 'Привет']).out, '0J_RgNC40LLQtdGC\n');
});

test('encode reads stdin when TEXT is omitted, adds no newline to the input', () => {
  assert.equal(b64([], 'foo').out, 'Zm9v\n');
  assert.equal(b64([], '').out, '\n');
  assert.equal(b64(['--', '-n']).out, 'LW4=\n');
  assert.equal(b64(['-'], 'foo').out, 'Zm9v\n');
});

test('long and short flags', () => {
  assert.equal(b64(['-u', '\xfb\xff']).out, b64(['--url', '\xfb\xff']).out);
  assert.equal(b64(['-n', 'f']).out, 'Zg\n');
  assert.equal(b64(['--no-pad', 'f']).out, 'Zg\n');
  assert.equal(b64(['-w', '4', 'foobar']).out, 'Zm9v\nYmFy\n');
  assert.equal(b64(['--wrap', '4', 'foobar']).out, 'Zm9v\nYmFy\n');
  assert.equal(b64(['--wrap=4', 'foobar']).out, 'Zm9v\nYmFy\n');
  assert.equal(b64(['-w', '0', 'foobar']).out, 'Zm9vYmFy\n');
  assert.equal(b64(['--decode', 'Zm9v']).out, 'foo');
  assert.equal(b64(['foobar', '-w', '4']).out, 'Zm9v\nYmFy\n');
});

test('decode writes raw bytes and reads stdin', () => {
  const r = b64(['-d'], '+/+/\n');
  assert.equal(r.code, 0);
  assert.deepEqual([...r.raw], [0xfb, 0xff, 0xbf]);
  assert.equal(b64(['-d'], 'data:text/plain;base64,SGk=').out, 'Hi');
  assert.equal(b64(['-d', '']).out, '');
});

test('decode errors exit 1 with b64: prefix', () => {
  const r = b64(['-d', 'Zm9v!']);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.equal(r.err, "b64: invalid character '!' at position 4\n");
  assert.equal(b64(['-d'], 'Zm9vY').code, 1);
});

test('--validate', () => {
  assert.deepEqual(b64(['--validate', 'SGVsbG8sIGh1YiE=']), {
    code: 0, out: 'valid (either, 11 bytes)\n', raw: Buffer.from('valid (either, 11 bytes)\n'), err: '',
  });
  assert.equal(b64(['--validate', '--', '-_-_']).out, 'valid (url, 3 bytes)\n');
  assert.equal(b64(['--validate', 'a+b_']).out, 'valid (mixed, 3 bytes)\n');
  assert.equal(b64(['--validate'], '+/+/\n').out, 'valid (standard, 3 bytes)\n');
  const bad = b64(['--validate', 'Zm9v!']);
  assert.equal(bad.code, 1);
  assert.equal(bad.out, '');
  assert.equal(bad.err, "invalid: invalid character '!' at position 4\n");
});

test('--data-uri and --mime', () => {
  assert.equal(b64(['--data-uri', 'Hi']).out, 'data:text/plain;charset=utf-8;base64,SGk=\n');
  assert.equal(b64(['--data-uri', '-m', 'text/x-a', 'Hi']).out, 'data:text/x-a;base64,SGk=\n');
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  assert.equal(b64(['--data-uri'], png).out, 'data:image/png;base64,iVBORw0KGgoAAA==\n');
  const long = 'x'.repeat(200);
  assert.ok(!b64(['--data-uri', long]).out.slice(0, -1).includes('\n'));
});

test('--input and --output files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b64-test-'));
  try {
    const src = join(dir, 'in.bin');
    const dst = join(dir, 'out.txt');
    writeFileSync(src, Buffer.from([0, 1, 2, 250]));
    let r = b64(['-i', src, '-o', dst]);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    assert.equal(readFileSync(dst, 'utf8'), 'AAEC+g==\n');
    r = b64(['--decode', '--input', dst, '--output', join(dir, 'back.bin')]);
    assert.equal(r.code, 0);
    assert.deepEqual([...readFileSync(join(dir, 'back.bin'))], [0, 1, 2, 250]);
    assert.equal(b64(['-i', '-'], 'foo').out, 'Zm9v\n');
    assert.equal(b64(['-o', '-', 'foo']).out, 'Zm9v\n');
    assert.equal(b64(['-'], 'foo').out, 'Zm9v\n');
    assert.equal(b64(['-i', '-', '-'], 'foo').out, 'Zm9v\n');
    assert.equal(b64(['--', '-']).out, 'LQ==\n');
    r = b64(['-i', 'missing'], '', dir);
    assert.deepEqual([r.code, r.out, r.err], [1, '', 'b64: open missing: no such file or directory\n']);
    r = b64(['-i', dir]);
    assert.deepEqual([r.code, r.err], [1, `b64: ${dir} is a directory\n`]);
    r = b64(['-o', dir, 'x']);
    assert.deepEqual([r.code, r.err], [1, `b64: open ${dir}: is a directory\n`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same file for -i and -o is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b64-test-'));
  try {
    const f = join(dir, 'data.txt');
    writeFileSync(f, 'Zm9v');
    const r = b64(['-d', '-i', f, '-o', f]);
    assert.deepEqual([r.code, r.out, r.err], [2, '', `b64: input and output are the same file: ${f}\n`]);
    assert.equal(readFileSync(f, 'utf8'), 'Zm9v');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed run removes the -o file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b64-test-'));
  try {
    const dst = join(dir, 'out.bin');
    let r = b64(['-d', '-o', dst, 'Zm9v!']);
    assert.deepEqual([r.code, r.err], [1, "b64: invalid character '!' at position 4\n"]);
    assert.ok(!existsSync(dst));
    writeFileSync(dst, 'old');
    r = b64(['--validate', '-o', dst, 'Zm9vY']);
    assert.deepEqual([r.code, r.err], [1, 'invalid: invalid length: 5 characters leave a single character in the last group\n']);
    assert.ok(!existsSync(dst));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('help and version', () => {
  const h = b64(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /\nUsage: b64 \[flags\] \[TEXT\]\n/);
  assert.equal(b64(['-h']).out, h.out);
  assert.equal(b64(['-v']).out, `b64 ${version}\n`);
  assert.equal(b64(['--version']).out, `b64 ${version}\n`);
  assert.equal(b64(['a', 'b', '-h']).out, h.out);
  assert.equal(b64(['-x', '-h']).code, 2);
});

test('usage errors exit 2', () => {
  const cases = [
    [['--mime', 'text/x-a', 'Hi'], '--mime needs --data-uri'],
    [['--wrap=+4', '-d', 'x'], '--wrap only applies to encoding, not to --decode'],
    [['--validate', '--data-uri', 'a'], '--data-uri only applies to encoding, not to --validate'],
    [['--validate', '-m', 'a/b', 'a'], '--mime only applies to encoding, not to --validate'],
    [['--data-uri', '-m', 'a b', 'x'], 'option -m needs a MIME type like image/png, got "a b"'],
    [['--data-uri', '--mime=', 'x'], 'option --mime needs a MIME type like image/png, got ""'],
    [['-w', '4\t', 'x'], 'option -w needs a whole number of 0 or more, got "4\\t"'],
    [['-w', '99999999999999999999', 'x'], 'option -w needs a whole number of 0 or more, got "99999999999999999999"'],
    [['-w=4', 'x'], "unknown option -w=4 (short options can't be combined)"],
    [['--bogus=1'], 'unknown option --bogus'],
    [['-i', 'a', '-'], 'give either TEXT or --input, not both'],
    [['-o'], 'option -o needs a value'],
  ];
  for (const [args, message] of cases) {
    const r = b64(args);
    assert.deepEqual([r.code, r.out, r.err], [2, '', `b64: ${message}\n`], args.join(' '));
  }
});
