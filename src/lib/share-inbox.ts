/**
 * Videos shared into the installed app ("Share -> Anti-Timeout"): the service
 * worker (public/sw.js) keeps them in IndexedDB and opens the editor, which
 * takes them from here. Browser only.
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("anti-timeout-share", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<File[]>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      const get = store.get("pending");
      get.onsuccess = () => {
        store.delete("pending");
        resolve(Array.isArray(get.result) ? get.result.filter((f): f is File => f instanceof File) : []);
      };
      get.onerror = () => reject(get.error);
    });
  } finally {
    db.close();
  }
}
