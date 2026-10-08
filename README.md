# Atomic Write

A zero-dependency JavaScript (ESM) library that prevents partial file reads by writing files atomically.

## Usage

```javascript
import { atomicWriteFile } from 'atomic-write';

await atomicWriteFile('config.json', JSON.stringify({ port: 8080 }));
```

The function writes to a temporary file in the same directory as the target, then renames it over the destination. Readers either see the old content or the new content, never a partially written file.

## Why this exists

A common failure mode in long-running services is reading a file while another process is rewriting it. If the writer truncates the file and then writes new content, a reader can observe an empty or partially written file. Atomic writes solve this by writing to a separate temporary file and using an atomic rename operation to swap it into place.

This library trades a small amount of disk overhead (the temporary file) for the guarantee that readers never see partial content. It does not protect against concurrent atomic writes to the same path; the last rename wins.

## Edge cases

- The temporary file is created in the same directory as the target because `rename()` is only guaranteed to be atomic within the same filesystem.
- If the process crashes before the rename, a `.tmp` file may remain in the directory. These files can be safely deleted.
- The function rejects with a `TypeError` if the file path is empty.
- If the parent directory does not exist, the operation rejects with an `ENOENT` error.

## API

### `atomicWriteFile(filePath, data)`

- `filePath` (string): path of the file to write.
- `data` (string | Buffer | Uint8Array): content to write.
- Returns a `Promise<void>` that resolves when the file has been atomically replaced.
- Rejects if the directory does not exist, the file cannot be written, or the rename fails.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

