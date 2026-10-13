/**
 * Repositório Local de Persistência Offline via IndexedDB nativo (FEAT-22).
 *
 * Permite a oficinas, garagens e velódromos sem cobertura de rede móvel/Wi-Fi
 * executar avaliações completas e guardar os registos localmente no dispositivo.
 */
class OfflineStorageService {
  constructor() {
    this.dbName = 'AthleteMotionDB';
    this.version = 1;
    this.db = null;
  }

  async getDb() {
    if (this.db) return this.db;
    if (typeof window === 'undefined' || !window.indexedDB) return null;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('offline_sessions')) {
          db.createObjectStore('offline_sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('offline_snapshots')) {
          const snapStore = db.createObjectStore('offline_snapshots', { autoIncrement: true });
          snapStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async saveOfflineSession(sessionData) {
    try {
      const db = await this.getDb();
      if (!db) return false;

      return new Promise((resolve, reject) => {
        const tx = db.transaction(['offline_sessions'], 'readwrite');
        const store = tx.objectStore('offline_sessions');
        const sessionRecord = {
          ...sessionData,
          id: sessionData.id || `offline-${Date.now()}`,
          offlineSavedAt: new Date().toISOString(),
          isSynced: false,
        };

        const req = store.put(sessionRecord);
        req.onsuccess = () => resolve(sessionRecord);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Falha ao salvar sessão offline:', e);
      return false;
    }
  }

  async getOfflineSessions() {
    try {
      const db = await this.getDb();
      if (!db) return [];

      return new Promise((resolve) => {
        const tx = db.transaction(['offline_sessions'], 'readonly');
        const store = tx.objectStore('offline_sessions');
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async saveOfflineSnapshot(sessionId, snapshot) {
    try {
      const db = await this.getDb();
      if (!db) return false;

      return new Promise((resolve) => {
        const tx = db.transaction(['offline_snapshots'], 'readwrite');
        const store = tx.objectStore('offline_snapshots');
        store.add({
          sessionId,
          ...snapshot,
          timestamp: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }
}

export const offlineStorage = new OfflineStorageService();

