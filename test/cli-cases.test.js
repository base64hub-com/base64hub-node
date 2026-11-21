// Runs every case of testdata/cli.json (generated from the Go reference build) against bin/b64.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/b64.js', import.meta.url));
const { cases } = JSON.parse(readFileSync(new URL('../testdata/cli.json', import.meta.url), 'utf8'));

test('cli.json: all cases match the Go build', async (t) => {
  assert.ok(cases.length > 0);
  // An empty working directory, so relative paths in the cases never touch real files.
  const cwd = mkdtempSync(join(tmpdir(), 'b64-cases-'));
  try {
    for (const [i, c] of cases.entries()) {
      await t.test(`#${i} b64 ${JSON.stringify(c.args)}`, () => {
        const r = spawnSync(process.execPath, [BIN, ...c.args], { cwd, input: Buffer.from(c.stdin_hex, 'hex') });
        assert.equal(r.stdout.toString('hex'), c.stdout_hex, 'stdout');
        assert.equal(r.stderr.toString('utf8'), c.stderr, 'stderr');
        assert.equal(r.status, c.exit, 'exit code');
      });
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
