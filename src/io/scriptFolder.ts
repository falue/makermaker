/** Python scripts as .py files in a folder on disk (File System Access API: Chrome, Edge); the folder is remembered in this browser. */
/** `example`: one that comes with the app (its file's name), not a file in the folder. */
export type Script = { name: string; text: string; example?: string };

export const canUseFolders = () => !!window.showDirectoryPicker;

const open = () =>
  new Promise<IDBDatabase>((done, fail) => {
    const request = indexedDB.open('makermaker-scripts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folder');
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });

export async function rememberFolder(dir: FileSystemDirectoryHandle) {
  const db = await open();
  db.transaction('folder', 'readwrite').objectStore('folder').put(dir, 'scripts');
  db.close();
}

export async function recallFolder() {
  const db = await open();
  return new Promise<FileSystemDirectoryHandle | undefined>((done, fail) => {
    const request = db.transaction('folder').objectStore('folder').get('scripts');
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

export async function writeScript(dir: FileSystemDirectoryHandle, { name, text }: Script) {
  const file = await (await dir.getFileHandle(`${name}.py`, { create: true })).createWritable();
  await file.write(text);
  await file.close();
}

export const removeScript = (dir: FileSystemDirectoryHandle, name: string) => dir.removeEntry(`${name}.py`);

/** A name a file can have everywhere. */
export const cleanName = (name: string) => name.replace(/\.py$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim();
