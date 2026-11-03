import type { PhotoSphere } from '../doc/types';

/**
 * Photo spheres added in this browser, for every design: in IndexedDB, as localStorage holds only about 5 MB in all.
 */
const open = () =>
  new Promise<IDBDatabase>((done, fail) => {
    const request = indexedDB.open('makermaker', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });

async function store<T>(mode: IDBTransactionMode, work: (photos: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((done, fail) => {
    const request = work(db.transaction('photos', mode).objectStore('photos'));
    request.onsuccess = () => (db.close(), done(request.result));
    request.onerror = () => (db.close(), fail(request.error));
  });
}

export const loadPhotos = () => store<PhotoSphere[]>('readonly', (p) => p.getAll());
export const keepPhoto = (photo: PhotoSphere) => store('readwrite', (p) => p.put(photo));
export const dropPhoto = (id: string) => store('readwrite', (p) => p.delete(id));
