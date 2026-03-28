const DB_NAME = "shift-scheduler";
const DB_VERSION = 1;
const STORE = "history";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "monthKey" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveHistoryCsv({ monthKey, csvText }) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({
    monthKey,
    csvText,
    importedAt: Date.now(),
  });
  await txDone(tx);
  db.close();
}

export async function getHistoryCsv(monthKey) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).get(monthKey);

  const row = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();
  return row;
}

export async function deleteHistoryMonth(monthKey) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(monthKey);
  await txDone(tx);
  db.close();
}

export async function listHistoryMonths() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);

  const keys = await new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();
  return keys.map(String).sort();
}

export async function listHistoryEntries() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);

  const rows = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();

  return rows
    .map((r) => ({
      monthKey: String(r.monthKey),
      csvText: String(r.csvText ?? ""),
      importedAt: Number(r.importedAt ?? 0),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}
