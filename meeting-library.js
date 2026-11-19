(() => {
  'use strict';
  const limit = 5;
  const idPattern = /^[a-f0-9-]{36}$/;
  let connection;

  function open() {
    if (!connection) {
      connection = new Promise((resolve,reject) => {
        const request = indexedDB.open('reunions-studio-library',1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('meetings',{keyPath:'id'}).createIndex('createdAt','createdAt');
          db.createObjectStore('audio');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); connection = null; };
          resolve(db);
        };
        request.onerror = () => { connection = null; reject(request.error); };
      });
    }
    return connection;
  }

  async function archive() {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('meetings','readonly');
      const rows = [];
      const request = tx.objectStore('meetings').index('createdAt').openCursor(null,'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        rows.push(cursor.value);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(rows);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function load(id) {
    if (!idPattern.test(id)) return null;
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['meetings','audio'],'readonly');
      const record = tx.objectStore('meetings').get(id);
      const audio = tx.objectStore('audio').get(id);
      tx.oncomplete = () => resolve(record.result ? {...record.result,audio:audio.result} : null);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function save(record, create, audio) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['meetings','audio'],'readwrite');
      const meetings = tx.objectStore('meetings'), recordings = tx.objectStore('audio');
      let saved = false;
      const previous = meetings.get(record.id);
      previous.onsuccess = () => {
        if (!previous.result && !create) return;
        meetings.put(record);
        saved = true;
        if (previous.result) return;
        if (audio) recordings.put(audio,record.id);
        let position = 0;
        const entries = meetings.index('createdAt').openKeyCursor(null,'prev');
        entries.onsuccess = () => {
          const cursor = entries.result;
          if (!cursor) return;
          if (++position > limit) {
            meetings.delete(cursor.primaryKey);
            recordings.delete(cursor.primaryKey);
            if (cursor.primaryKey === record.id) saved = false;
          }
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () => reject(tx.error || new Error('Sauvegarde interrompue.'));
    });
  }

  async function remove(id) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['meetings','audio'],'readwrite');
      tx.objectStore('meetings').delete(id);
      tx.objectStore('audio').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Suppression interrompue.'));
    });
  }

  window.MeetingLibrary = {archive,load,save,remove};
})();
