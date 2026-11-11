import { recall, remember } from './scriptFolder';

/** Designs opened or saved lately in this browser, newest first, kept as handles to open them again. */
const MOST = 100;
let list: FileSystemFileHandle[] = [];
/** Changes one after another, the first after the stored list is read. */
let queue = recall<FileSystemFileHandle[]>('recent')
  .then((l) => void (list = l ?? []))
  .catch(() => {});

const change = (next: () => Promise<FileSystemFileHandle[]>) =>
  (queue = queue.then(async () => {
    list = await next();
    await remember('recent', list);
  }));

export const recentFiles = () => list;

/** `h` first, the same file further down gone. */
export const addRecent = (h: FileSystemFileHandle) =>
  change(async () => {
    const same = await Promise.all(list.map((o) => o.isSameEntry(h)));
    return [h, ...list.filter((_, i) => !same[i])].slice(0, MOST);
  });

export const dropRecent = (h: FileSystemFileHandle) => change(async () => list.filter((o) => o !== h));

export const clearRecent = () => change(async () => []);
