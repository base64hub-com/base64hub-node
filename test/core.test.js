import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, validate, dataUri, Base64Error } from '../index.js';

const { cases } = JSON.parse(readFileSync(new URL('../testdata/vectors.json', import.meta.url), 'utf8'));
const fromHex = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
const toHex = (bytes) => Buffer.from(bytes).toString('hex');

test('vectors: all cases', async (t) => {
  assert.ok(cases.length > 0);
  for (const [i, c] of cases.entries()) {
    await t.test(`#${i} ${c.op} ${JSON.stringify(c.in ?? c.in_hex).slice(0, 40)}`, () => {
      if (c.op === 'encode') {
        assert.equal(encode(fromHex(c.in_hex), { url: c.url, pad: c.pad, wrap: c.wrap }), c.out);
      } else if (c.op === 'decode') {
        if (c.error) assert.throws(() => decode(c.in), Base64Error);
        else assert.equal(toHex(decode(c.in)), c.out_hex);
      } else if (c.op === 'validate') {
        const r = validate(c.in);
        assert.equal(r.valid, c.valid);
        if (c.valid) {
          assert.deepEqual(r, { valid: true, variant: c.variant, padded: c.padded, bytes: c.bytes });
        } else {
          assert.equal(typeof r.error, 'string');
        }
      } else {
        assert.fail(`unknown op ${c.op}`);
      }
    });
  }
});

test('encode accepts strings and byte views', () => {
  assert.equal(encode('Hello, hub!'), 'SGVsbG8sIGh1YiE=');
  assert.equal(encode('Привет', { url: true, pad: false }), '0J_RgNC40LLQtdGC');
  assert.equal(encode(new Uint8Array([0xfb, 0xff, 0xbf]).buffer, { url: true }), '-_-_');
  assert.equal(encode(new DataView(new Uint8Array([0, 102, 0]).buffer, 1, 1)), 'Zg==');
  assert.equal(encode(Buffer.from('foobar')), 'Zm9vYmFy');
  assert.equal(encode('foobar', { wrap: 100 }), 'Zm9vYmFy');
  assert.equal(encode('foob', { wrap: 3 }), 'Zm9\nvYg\n==');
});

test('encode rejects bad arguments', () => {
  assert.throws(() => encode(42), TypeError);
  assert.throws(() => encode('x', { wrap: -1 }), RangeError);
  assert.throws(() => encode('x', { wrap: 1.5 }), RangeError);
});

test('decode errors carry reason and position', () => {
  const BS = '\\';
  const cases = [
    ['Zm9v!', "invalid character '!' at position 4", 4],
    ['Zm=9v', "unexpected '=' at position 2: padding is only allowed at the end", 2],
    ['Zm9vY', 'invalid length: 5 characters leave a single character in the last group', 4],
    ['Zg===', "too much padding: 3 '=' at position 2, at most 2 are allowed", 2],
    ['====', "too much padding: 4 '=' at position 0, at most 2 are allowed", 0],
    ['data:x;base64,Zm 9é', "invalid character 'é' at position 3", 3],
    ['Zm' + String.fromCharCode(0) + 'v', `invalid character '${BS}x00' at position 2`, 2],
    ['Zm' + String.fromCharCode(11) + 'v', `invalid character '${BS}v' at position 2`, 2],
    ["Zm'v", `invalid character '${BS}'' at position 2`, 2],
    // Left to right: the first problem wins.
    ['Zm9v!=YmFy', "invalid character '!' at position 4", 4],
    ['Zm=!', "unexpected '=' at position 2: padding is only allowed at the end", 2],
    ['Zm9vY!', "invalid character '!' at position 5", 5],
    ['Zm9vY===', "too much padding: 3 '=' at position 5, at most 2 are allowed", 5],
    // Whitespace is only space, tab, CR and LF.
    [String.fromCharCode(0xa0) + 'Zg==', `invalid character '${BS}u00a0' at position 0`, 0],
    ['Zg' + String.fromCharCode(12), `invalid character '${BS}f' at position 2`, 2],
    // ";base64," is matched in lower case only.
    ['data:text/plain;BASE64,SGk=', "invalid character ':' at position 4", 4],
  ];
  for (const [input, message, position] of cases) {
    assert.throws(() => decode(input), (err) => {
      assert.ok(err instanceof Base64Error);
      assert.equal(err.name, 'Base64Error');
      assert.equal(err.message, message);
      assert.equal(err.position, position);
      return true;
    }, JSON.stringify(input));
    assert.deepEqual(validate(input), { valid: false, error: message });
  }
  assert.throws(() => decode(null), TypeError);
});

test('decode and validate accept bytes; invalid UTF-8 is shown as a byte', () => {
  assert.deepEqual([...decode(new Uint8Array([0x5a, 0x67]))], [0x66]);
  assert.deepEqual(validate(Buffer.from('-_-_')), { valid: true, variant: 'url', padded: true, bytes: 3 });
  assert.deepEqual(validate(new Uint8Array([0x5a, 0x67, 0xff])), { valid: false, error: "invalid character '\\xff' at position 2" });
});

test('validate shape and edge cases', () => {
  assert.deepEqual(validate('Zg='), { valid: true, variant: 'either', padded: false, bytes: 1 });
  assert.deepEqual(validate('=='), { valid: true, variant: 'either', padded: false, bytes: 0 });
  assert.deepEqual(validate(' \t\r\nZm9v YmFy\n'), { valid: true, variant: 'either', padded: true, bytes: 6 });
  assert.deepEqual(validate('DATA:image/png;base64,iVBORw0KGgo='), { valid: true, variant: 'either', padded: true, bytes: 8 });
  assert.deepEqual(Object.keys(validate('!')), ['valid', 'error']);
});

test('decode returns a Uint8Array', () => {
  const out = decode('SGk=');
  assert.ok(out instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(out), 'Hi');
  assert.equal(decode('').length, 0);
});

test('round trip of every length 0..300', () => {
  const all = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255);
  for (let n = 0; n <= all.length; n++) {
    const bytes = all.subarray(0, n);
    for (const url of [false, true]) {
      for (const pad of [false, true]) {
        const text = encode(bytes, { url, pad, wrap: n % 7 === 0 ? 0 : 76 });
        assert.equal(toHex(decode(text)), toHex(bytes));
        let ref = Buffer.from(bytes).toString('base64');
        if (url) ref = ref.replace(/\+/g, '-').replace(/\//g, '_');
        if (!pad) ref = ref.replace(/=+$/, '');
        assert.equal(text.replace(/\n/g, ''), ref);
      }
    }
  }
});

test('dataUri sniffs MIME types', () => {
  const b = (...xs) => Uint8Array.from(xs);
  const ascii = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
  assert.equal(dataUri(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'data:image/png;base64,iVBORw0KGgo=');
  assert.match(dataUri(b(0xff, 0xd8, 0xff, 0xe0)), /^data:image\/jpeg;base64,/);
  assert.match(dataUri(ascii('GIF89a...')), /^data:image\/gif;base64,/);
  assert.match(dataUri(ascii('GIF87a...')), /^data:image\/gif;base64,/);
  assert.match(dataUri(ascii('RIFF\x00\x00\x00\x00WEBPVP8 ')), /^data:image\/webp;base64,/);
  assert.match(dataUri(ascii('%PDF-1.7')), /^data:application\/pdf;base64,/);
  assert.match(dataUri('<svg xmlns="http://www.w3.org/2000/svg"/>'), /^data:image\/svg\+xml;base64,/);
  assert.match(dataUri('<?xml version="1.0"?>\n<svg/>'), /^data:image\/svg\+xml;base64,/);
  assert.match(dataUri('<?xml version="1.0"?><note/>'), /^data:text\/plain;charset=utf-8;base64,/);
  assert.match(dataUri(' \n<svg/>'), /^data:image\/svg\+xml;base64,/);
  assert.match(dataUri(b(0x3c, 0x73, 0x76, 0x67, 0xff)), /^data:image\/svg\+xml;base64,/);
  assert.equal(dataUri('Hi\tthere\r\n'), 'data:text/plain;charset=utf-8;base64,SGkJdGhlcmUNCg==');
  assert.equal(dataUri(''), 'data:text/plain;charset=utf-8;base64,');
  assert.match(dataUri(b(0x48, 0x00)), /^data:application\/octet-stream;base64,/);
  assert.match(dataUri(b(0xc3, 0x28)), /^data:application\/octet-stream;base64,/);
  assert.equal(dataUri('Hi', 'text/x-custom'), 'data:text/x-custom;base64,SGk=');
});

test('dataUri output decodes back', () => {
  const uri = dataUri('Привет');
  assert.equal(new TextDecoder().decode(decode(uri)), 'Привет');
});
