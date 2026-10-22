import type {
  Conversation,
  InferenceSettings,
  LoadedModelBundle,
  StoredModelRecord,
  ThemeId,
} from '../types/local';

const DB_NAME = 'local_ai_ondevice_db_v1';
const STORE_MODELS = 'model_records';
const STORE_BLOBS = 'model_blobs';

const LS_CONVERSATIONS = 'local_ai_conversations_v1';
const LS_SETTINGS = 'local_ai_settings_v1';
const LS_THEME = 'local_ai_theme_v1';

// Session memory cache for huge files (>500MB) or immediate active bundles
const sessionBlobs = new Map<string, Map<string, Blob>>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveModelBundle(
  bundle: LoadedModelBundle,
  persistBlobsToIdb: boolean
): Promise<StoredModelRecord> {
  const updatedRecord: StoredModelRecord = {
    ...bundle.record,
    persistedInIdb: persistBlobsToIdb,
  };

  sessionBlobs.set(updatedRecord.id, bundle.files);

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_MODELS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_MODELS).put(updatedRecord);
    if (persistBlobsToIdb) {
      const blobStore = tx.objectStore(STORE_BLOBS);
      for (const [relPath, blob] of bundle.files.entries()) {
        blobStore.put(blob, `${updatedRecord.id}::${relPath}`);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return updatedRecord;
}

export async function listStoredModels(): Promise<StoredModelRecord[]> {
  try {
    const db = await openDb();
    const records = await new Promise<StoredModelRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, 'readonly');
      const req = tx.objectStore(STORE_MODELS).getAll();
      req.onsuccess = () => resolve((req.result as StoredModelRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

export async function loadModelBundleById(id: string): Promise<LoadedModelBundle | null> {
  const db = await openDb();
  const record = await new Promise<StoredModelRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_MODELS, 'readonly');
    const req = tx.objectStore(STORE_MODELS).get(id);
    req.onsuccess = () => resolve(req.result as StoredModelRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (!record) {
    db.close();
    return null;
  }

  // Check session cache first
  const memFiles = sessionBlobs.get(id);
  if (memFiles && memFiles.size > 0) {
    db.close();
    return { record, files: memFiles };
  }

  if (!record.persistedInIdb) {
    db.close();
    return null;
  }

  const files = new Map<string, Blob>();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_BLOBS);
    let pending = record.entries.length;
    if (pending === 0) {
      resolve();
      return;
    }
    for (const entry of record.entries) {
      const req = store.get(`${id}::${entry.path}`);
      req.onsuccess = () => {
        if (req.result instanceof Blob) {
          files.set(entry.path, req.result);
        }
        pending--;
        if (pending === 0) resolve();
      };
      req.onerror = () => reject(req.error);
    }
  });
  db.close();

  if (files.size === 0) return null;
  sessionBlobs.set(id, files);
  return { record, files };
}

export async function touchModelLastUsed(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, 'readwrite');
      const store = tx.objectStore(STORE_MODELS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result as StoredModelRecord | undefined;
        if (rec) {
          rec.lastUsedAt = Date.now();
          store.put(rec);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore touch errors
  }
}

export async function deleteStoredModel(id: string): Promise<void> {
  sessionBlobs.delete(id);
  const db = await openDb();
  const record = await new Promise<StoredModelRecord | undefined>((resolve) => {
    const tx = db.transaction(STORE_MODELS, 'readonly');
    const req = tx.objectStore(STORE_MODELS).get(id);
    req.onsuccess = () => resolve(req.result as StoredModelRecord | undefined);
    req.onerror = () => resolve(undefined);
  });

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_MODELS, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_MODELS).delete(id);
    if (record) {
      const blobStore = tx.objectStore(STORE_BLOBS);
      for (const entry of record.entries) {
        blobStore.delete(`${id}::${entry.path}`);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getDeviceStorageEstimate(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      return {
        usage: est.usage || 0,
        quota: est.quota || 0,
      };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }
  return { usage: 0, quota: 0 };
}

export function loadSavedConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(LS_CONVERSATIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(LS_CONVERSATIONS, JSON.stringify(conversations));
  } catch {
    // Storage full
  }
}

export const DEFAULT_INFERENCE_SETTINGS: InferenceSettings = {
  systemPrompt:
    'You are Local, a helpful, thoughtful, private AI assistant running 100% locally on the user\'s device. Give clear, well-structured, accurate answers using clean Markdown formatting.',
  temperature: 0.7,
  topP: 0.92,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 1024,
  contextSize: 4096,
  gpuLayers: 99,
  threads: Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)),
};

export function loadInferenceSettings(): InferenceSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return DEFAULT_INFERENCE_SETTINGS;
    return { ...DEFAULT_INFERENCE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INFERENCE_SETTINGS;
  }
}

export function saveInferenceSettings(settings: InferenceSettings): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function loadSavedTheme(): ThemeId {
  const saved = localStorage.getItem(LS_THEME) as ThemeId | null;
  if (
    saved === 'claude-dark' ||
    saved === 'claude-light' ||
    saved === 'chatgpt-dark' ||
    saved === 'chatgpt-light'
  ) {
    return saved;
  }
  return 'claude-dark';
}

export function saveTheme(theme: ThemeId): void {
  localStorage.setItem(LS_THEME, theme);
}
