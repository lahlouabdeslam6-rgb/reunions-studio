(() => {
  'use strict';
  const storeName = 'recordings';

  function open() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('reunions-studio-transfer',1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transaction(mode,action) {
    const db = await open();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction(storeName,mode);
        const request = action(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error || new Error('Transfert audio interrompu.'));
      });
    } finally { db.close(); }
  }

  window.RoomDraft = {
    async save(audio) {
      const id = crypto.randomUUID();
      await transaction('readwrite',store=>store.add(audio,id));
      return id;
    },
    load(id) { return transaction('readonly',store=>store.get(id)); },
    remove(id) { return transaction('readwrite',store=>store.delete(id)); }
  };
})();
