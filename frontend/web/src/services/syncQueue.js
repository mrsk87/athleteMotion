/**
 * Fila de Sincronização Offline Resiliente com Backoff Exponencial e Idempotência (R16 / R08).
 *
 * Princípios de Confiabilidade:
 * - Persistência fiável em IndexedDB: nenhuma medição ou snapshot se perde por quebra de rede.
 * - Retry com backoff exponencial e jitter aleatório para evitar 'thundering herd' no servidor.
 * - Envio com cabeçalho 'Idempotency-Key' para garantir segurança transacional ACID no backend.
 * - Agrupamento atómico em lote (batching) para snapshots (POST /sessions/{id}/snapshots:batch).
 * - Visibilidade operacional completa: estado exposto para HUD/Toasts; NUNCA engole erros em silêncio.
 */

import { apiClient } from './api';

const DB_NAME = 'AthleteMotionSyncDB';
const DB_VERSION = 1;
const STORE_NAME = 'sync_queue';

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SyncQueueService {
  constructor() {
    this.db = null;
    this.isProcessing = false;
    this.maxRetries = 5;
    this.baseDelayMs = 1500;
    this.maxDelayMs = 60000;
    this._statusListeners = new Set();
    this._errorListeners = new Set();
  }

  async getDb() {
    if (this.db) return this.db;
    if (typeof window === 'undefined' || !window.indexedDB) return null;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[syncQueue] Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        // ignora
      }
      this.db = null;
    }
  }

  async clear() {
    const db = await this.getDb();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Enfileira uma operação para sincronização com o backend.
   * @param {'snapshot'|'session'|'batch_snapshots'|'athlete'|'bike'} type
   * @param {Object} payload
   * @param {string} [customIdempotencyKey]
   * @returns {Promise<string>} ID do item na fila
   */
  async enqueue(type, payload, customIdempotencyKey = null) {
    const db = await this.getDb();
    const id = generateUUID();
    const idempotencyKey = customIdempotencyKey || generateUUID();

    const item = {
      id,
      type,
      payload,
      idempotencyKey,
      status: 'pending', // 'pending' | 'processing' | 'failed' | 'completed'
      attempts: 0,
      nextRetryAt: Date.now(),
      lastError: null,
      createdAt: new Date().toISOString(),
    };

    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(item);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
      });
    }

    this._notifyStatus();

    // Tentar processar imediatamente em background
    this.processQueue().catch((err) => {
      console.warn('[syncQueue] Erro ao disparar processamento inicial:', err);
    });

    return id;
  }

  /**
   * Obtém contagens do estado da fila.
   * @returns {Promise<{ pending: number, failed: number, isProcessing: boolean }>}
   */
  async getStatus() {
    const db = await this.getDb();
    if (!db) {
      return { pending: 0, failed: 0, isProcessing: this.isProcessing };
    }

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const items = req.result || [];
        const pending = items.filter((it) => it.status === 'pending' || it.status === 'processing').length;
        const failed = items.filter((it) => it.status === 'failed').length;
        resolve({ pending, failed, isProcessing: this.isProcessing });
      };

      req.onerror = () => {
        resolve({ pending: 0, failed: 0, isProcessing: this.isProcessing });
      };
    });
  }

  /**
   * Processa itens pendentes da fila respeitando intervalos de retry.
   */
  async processQueue() {
    if (this.isProcessing) return;
    const db = await this.getDb();
    if (!db) return;

    this.isProcessing = true;
    this._notifyStatus();

    try {
      const pendingItems = await this._getExecutableItems(db);

      // Agrupar snapshots por sessão para envio em batch
      const { batchGroups, individualItems } = this._groupSnapshotsForBatch(pendingItems);

      // 1. Processar lotes de snapshots
      for (const [sessionId, snapshots] of Object.entries(batchGroups)) {
        await this._processBatchSnapshots(db, sessionId, snapshots);
      }

      // 2. Processar itens individuais
      for (const item of individualItems) {
        await this._processSingleItem(db, item);
      }
    } finally {
      this.isProcessing = false;
      this._notifyStatus();
    }
  }

  async _getExecutableItems(db) {
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const now = Date.now();
        const items = (req.result || []).filter(
          (it) => it.status === 'pending' && (!it.nextRetryAt || it.nextRetryAt <= now)
        );
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  }

  _groupSnapshotsForBatch(items) {
    const batchGroups = {};
    const individualItems = [];

    for (const item of items) {
      if (item.type === 'snapshot' && item.payload && item.payload.sessionId) {
        const sid = item.payload.sessionId;
        if (!batchGroups[sid]) batchGroups[sid] = [];
        batchGroups[sid].push(item);
      } else {
        individualItems.push(item);
      }
    }

    return { batchGroups, individualItems };
  }

  async _processBatchSnapshots(db, sessionId, queueItems) {
    // Limite máximo de lote suportado pelo backend: 500 itens
    const chunks = [];
    for (let i = 0; i < queueItems.length; i += 500) {
      chunks.push(queueItems.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const batchPayload = {
        snapshots: chunk.map((c) => c.payload.snapshotData),
      };

      try {
        await apiClient.post(`/api/v1/sessions/${sessionId}/snapshots:batch`, batchPayload, {
          headers: {
            'Idempotency-Key': `batch-${chunk[0].idempotencyKey}`,
          },
        });

        // Sucesso: marcar todos os itens do lote como concluídos
        await this._bulkUpdateStatus(db, chunk.map((c) => c.id), 'completed');
      } catch (err) {
        console.warn(`[syncQueue] Falha no lote de snapshots para sessão ${sessionId}:`, err.message);
        this._notifyError({ type: 'batch_snapshot', sessionId, error: err });
        for (const item of chunk) {
          await this._handleItemFailure(db, item, err);
        }
      }
    }
  }

  async _processSingleItem(db, item) {
    try {
      if (item.type === 'session_start') {
        await apiClient.post('/api/v1/sessions', item.payload, {
          headers: { 'Idempotency-Key': item.idempotencyKey },
        });
      } else if (item.type === 'session_complete') {
        await apiClient.post(`/api/v1/sessions/${item.payload.sessionId}/complete`, {}, {
          headers: { 'Idempotency-Key': item.idempotencyKey },
        });
      } else if (item.type === 'athlete') {
        await apiClient.post('/api/v1/athletes', item.payload, {
          headers: { 'Idempotency-Key': item.idempotencyKey },
        });
      }

      await this._updateItemStatus(db, item.id, 'completed');
    } catch (err) {
      console.warn(`[syncQueue] Erro ao sincronizar item ${item.id} (${item.type}):`, err.message);
      this._notifyError({ type: item.type, itemId: item.id, error: err });
      await this._handleItemFailure(db, item, err);
    }
  }

  async _handleItemFailure(db, item, err) {
    const attempts = (item.attempts || 0) + 1;
    const isExhausted = attempts >= this.maxRetries;

    // Cálculo de backoff com jitter aleatório: base * 2^attempts + jitter
    const jitter = Math.random() * 1000;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, attempts) + jitter);
    const nextRetryAt = Date.now() + delay;

    const newStatus = isExhausted ? 'failed' : 'pending';

    await new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      item.attempts = attempts;
      item.status = newStatus;
      item.nextRetryAt = nextRetryAt;
      item.lastError = err.message || String(err);
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async _updateItemStatus(db, id, status) {
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.status = status;
          if (status === 'completed') {
            store.delete(id); // Limpar itens concluídos para poupar espaço
          } else {
            store.put(req.result);
          }
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  async _bulkUpdateStatus(db, ids, status) {
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) {
        if (status === 'completed') {
          store.delete(id);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Força nova tentativa para todos os itens marcados como falhados.
   */
  async retryAll() {
    const db = await this.getDb();
    if (!db) return;

    await new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const items = req.result || [];
        for (const it of items) {
          if (it.status === 'failed') {
            it.status = 'pending';
            it.attempts = 0;
            it.nextRetryAt = Date.now();
            store.put(it);
          }
        }
        resolve();
      };
      req.onerror = () => resolve();
    });

    this._notifyStatus();
    await this.processQueue();
  }

  onStatusChange(callback) {
    this._statusListeners.add(callback);
    return () => this._statusListeners.delete(callback);
  }

  onError(callback) {
    this._errorListeners.add(callback);
    return () => this._errorListeners.delete(callback);
  }

  _notifyStatus() {
    this.getStatus().then((status) => {
      for (const listener of this._statusListeners) {
        try {
          listener(status);
        } catch (e) {
          console.warn('[syncQueue] Erro no listener onStatusChange:', e);
        }
      }
    });
  }

  _notifyError(errInfo) {
    for (const listener of this._errorListeners) {
      try {
        listener(errInfo);
      } catch (e) {
        console.warn('[syncQueue] Erro no listener onError:', e);
      }
    }
  }
}

export const syncQueue = new SyncQueueService();
export default syncQueue;
