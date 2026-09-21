import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write a file atomically by writing to a temporary file in the same directory
 * and then renaming it over the destination.
 *
 * Why temp file in same directory? rename() is atomic only within the same
 * filesystem. A temp file in a different directory (e.g. /tmp) may reside on
 * a different filesystem, making rename fall back to copy+delete which is not
 * atomic. Using the destination directory guarantees the rename is atomic on
 * POSIX systems.
 *
 * The temp file name is randomised to avoid collisions between concurrent
 * writers. We use a fixed prefix so stale temp files can be identified if a
 * process crashes mid-write.
 *
 * @param {string} filePath - absolute or relative path of the destination file
 * @param {string | Buffer | Uint8Array} data - content to write
 * @returns {Promise<void>}
 */
export async function atomicWriteFile(filePath, data) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('filePath must be a non-empty string');
  }

  const directory = dirname(filePath);
  const tempName = `.${filePath.split('/').pop()}.${randomBytes(6).toString('hex')}.tmp`;
  const tempPath = `${directory}/${tempName}`;

  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', 0o666);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
