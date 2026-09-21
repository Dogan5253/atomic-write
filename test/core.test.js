import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { atomicWriteFile } from '../src/core.js';

async function makeTempDir() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'atomic-write-'));
  return dir;
}

function collectTempFiles(dir) {
  return fs.readdir(dir).then((names) => names.filter((name) => name.endsWith('.tmp')));
}

test('writes file content and returns undefined', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'hello.txt');

  const result = await atomicWriteFile(target, 'hello world');

  assert.equal(result, undefined);
  assert.equal(await fs.readFile(target, 'utf8'), 'hello world');
  assert.deepEqual(await collectTempFiles(dir), []);
});

test('creates parent directory only if it exists; otherwise rejects', async () => {
  const dir = await makeTempDir();
  const missingDir = join(dir, 'missing');
  const target = join(missingDir, 'file.txt');

  await assert.rejects(
    atomicWriteFile(target, 'data'),
    (error) => error instanceof Error && error.code === 'ENOENT'
  );
  assert.deepEqual(await collectTempFiles(dir), []);
});

test('overwrites existing file', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'existing.txt');
  await fs.writeFile(target, 'old');

  await atomicWriteFile(target, 'new');

  assert.equal(await fs.readFile(target, 'utf8'), 'new');
  assert.deepEqual(await collectTempFiles(dir), []);
});

test('cleans up temp file if write fails', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'file.txt');

  const originalOpen = fs.open;
  fs.open = async (path, flags, mode) => {
    if (flags === 'wx') {
      const handle = await originalOpen.call(fs, path, flags, mode);
      await handle.writeFile('partial');
      await handle.close();
      throw new Error('simulated write failure');
    }
    return originalOpen.call(fs, path, flags, mode);
  };

  try {
    await assert.rejects(
      atomicWriteFile(target, 'full data'),
      /simulated write failure/
    );
  } finally {
    fs.open = originalOpen;
  }

  assert.deepEqual(await collectTempFiles(dir), []);
  await assert.rejects(fs.access(target), (error) => error.code === 'ENOENT');
});

test('cleans up temp file if rename fails', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'file.txt');

  const originalRename = fs.rename;
  fs.rename = async () => {
    throw new Error('simulated rename failure');
  };

  try {
    await assert.rejects(
      atomicWriteFile(target, 'data'),
      /simulated rename failure/
    );
  } finally {
    fs.rename = originalRename;
  }

  assert.deepEqual(await collectTempFiles(dir), []);
  await assert.rejects(fs.access(target), (error) => error.code === 'ENOENT');
});

test('rejects with TypeError for empty path', async () => {
  await assert.rejects(
    atomicWriteFile('', 'data'),
    (error) => error instanceof TypeError && error.message === 'filePath must be a non-empty string'
  );
});

test('writes Buffer content', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'buffer.bin');
  const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);

  await atomicWriteFile(target, payload);

  assert.deepEqual(await fs.readFile(target), payload);
  assert.deepEqual(await collectTempFiles(dir), []);
});

test('writes Uint8Array content', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'uint8.bin');
  const payload = new Uint8Array([5, 6, 7, 8]);

  await atomicWriteFile(target, payload);

  assert.deepEqual(await fs.readFile(target), Buffer.from(payload));
  assert.deepEqual(await collectTempFiles(dir), []);
});

test('atomicity: reader never observes partial content', async () => {
  const dir = await makeTempDir();
  const target = join(dir, 'atomic.txt');

  const largeData = 'x'.repeat(10 * 1024 * 1024);
  let writePromise = atomicWriteFile(target, largeData);

  // Repeatedly attempt to read while the write is in flight. On a POSIX system
  // rename is atomic so the reader should either get ENOENT or the full content,
  // never a truncated file. We loop a bounded number of times to keep the test
  // deterministic; we do not assert on timing, only on the observed content.
  for (let i = 0; i < 100; i++) {
    try {
      const content = await fs.readFile(target, 'utf8');
      assert.ok(
        content === largeData || content === '',
        `observed partial content of length ${content.length}`
      );
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await writePromise;
  assert.equal(await fs.readFile(target, 'utf8'), largeData);
  assert.deepEqual(await collectTempFiles(dir), []);
});
