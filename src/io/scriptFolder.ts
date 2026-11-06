/** Python scripts as .py files in a folder on disk (File System Access API: Chrome, Edge); the folder is remembered in this browser. */
/** `example`: one that comes with the app (its file's name); `file`: a file picked by itself, not in the folder; `locked`: its permission still to be given (that takes a click). */
export type Script = { name: string; text: string; example?: string; file?: FileSystemFileHandle; locked?: boolean };

export const canUseFolders = () => !!window.showDirectoryPicker;

const open = () =>
  new Promise<IDBDatabase>((done, fail) => {
    const request = indexedDB.open('makermaker-scripts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folder');
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });

/** A value kept in this browser (folder handles and such) under `key`. */
export async function remember(key: string, value: unknown) {
  const db = await open();
  db.transaction('folder', 'readwrite').objectStore('folder').put(value, key);
  db.close();
}

export async function recall<T>(key: string) {
  const db = await open();
  return new Promise<T | undefined>((done, fail) => {
    const request = db.transaction('folder').objectStore('folder').get(key);
    request.onsuccess = () => (db.close(), done(request.result));
    request.onerror = () => (db.close(), fail(request.error));
  });
}

/** The folder's scripts, by name; only its .py files, not its sub-folders. */
export async function listScripts(dir: FileSystemDirectoryHandle): Promise<Script[]> {
  const out: Script[] = [];
  for await (const entry of dir.values())
    if (entry.kind === 'file' && /\.py$/i.test(entry.name)) out.push({ name: entry.name.slice(0, -3), text: await (await (entry as FileSystemFileHandle).getFile()).text() });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const rememberFolder = (dir: FileSystemDirectoryHandle) => remember('scripts', dir);
export const recallFolder = () => recall<FileSystemDirectoryHandle>('scripts');
export const rememberFiles = (files: FileSystemFileHandle[]) => remember('files', files);
export const recallFiles = async () => (await recall<FileSystemFileHandle[]>('files')) ?? [];

/** Writes a picked file, asking for permission if it takes that. */
export async function writeFile(handle: FileSystemFileHandle, text: string) {
  if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await handle.requestPermission({ mode: 'readwrite' });
  const file = await handle.createWritable();
  await file.write(text);
  await file.close();
}

export const writeScript = async (dir: FileSystemDirectoryHandle, { name, text }: Script) => writeFile(await dir.getFileHandle(`${name}.py`, { create: true }), text);

export const removeScript = (dir: FileSystemDirectoryHandle, name: string) => dir.removeEntry(`${name}.py`);

/** A name a file can have everywhere. */
export const cleanName = (name: string) => name.replace(/\.py$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim();
