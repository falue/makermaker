import { EXTENSION } from './design';

/** File access goes through here so a desktop wrapper can replace it. */
export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  handle?: FileSystemFileHandle;
}

const types = [{ description: 'MAKERMAKER design', accept: { 'application/zip': [EXTENSION] } }];

const aborted = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

export async function openFile(): Promise<OpenedFile | null> {
  if (!window.showOpenFilePicker) return pickWithInput();
  try {
    const [handle] = await window.showOpenFilePicker({ types });
    return readHandle(handle);
  } catch (err) {
    if (aborted(err)) return null;
    throw err;
  }
}

export async function readHandle(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
}

/** Saves in place when a handle exists. Returns null if the user cancelled. */
export async function saveFile(
  bytes: Uint8Array,
  name: string,
  handle?: FileSystemFileHandle,
): Promise<{ name: string; handle?: FileSystemFileHandle } | null> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  if (!window.showSaveFilePicker) {
    download(blob, name);
    return { name };
  }
  try {
    handle ??= await window.showSaveFilePicker({ suggestedName: name, types });
  } catch (err) {
    if (aborted(err)) return null;
    throw err;
  }
  // Writes go to a swap file until close(), so an interrupted save keeps the last good file.
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { name: handle.name, handle };
}

function pickWithInput(): Promise<OpenedFile | null> {
  return new Promise((done) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: EXTENSION });
    input.onchange = async () => {
      const file = input.files?.[0];
      done(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => done(null);
    input.click();
  });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
