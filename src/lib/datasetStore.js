// datasetStore.js
// Persist and load base engine inputs (Project List + Demand Matrix) across sessions.
// Uses IndexedDB to avoid localStorage size limits.

const DB_NAME = 'spark_datasets_v1'
const DB_VERSION = 1
const STORE = 'datasets'
const BASE_KEY = 'base'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
  })
}

export async function loadBaseDataset() {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  const req = store.get(BASE_KEY)
  const value = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'))
  })
  await txDone(tx)
  db.close()
  return value
}

export async function saveBaseDataset(payload) {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.put(payload, BASE_KEY)
  await txDone(tx)
  db.close()
}

export async function clearBaseDataset() {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.delete(BASE_KEY)
  await txDone(tx)
  db.close()
}

