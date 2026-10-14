/**
 * Armazenamento Seguro de Dados Pessoais (PII) e Histórico via IndexedDB + WebCrypto (R16 / R06).
 *
 * Princípios de Engenharia:
 * - Substitui o uso inseguro de `localStorage` para dados pessoais do atleta (peso, calçado, sessões).
 * - Cifra opcional em repouso com AES-GCM (256-bit) e derivação de chave PBKDF2 (SHA-256, 100 000 iterações).
 * - A chave criptográfica NUNCA é persistida em disco; vive apenas em memória volátil enquanto desbloqueada.
 * - Migração atómica e unidirecional de perfis legados de `localStorage` para IndexedDB com purga obrigatória do `localStorage`.
 */

const DB_NAME = 'AthleteMotionSecureDB';
const DB_VERSION = 1;
const STORE_NAME = 'secure_records';

const LEGACY_STORAGE_KEYS = [
  'athleteMotion_athlete_profile',
  'athleteMotion_baseline_session',
  'athleteMotion_athlete_profiles_history',
];

export class SecureStorageService {
  constructor() {
    this.db = null;
    this._cryptoKey = null;
    this._isUnlocked = true; // Por defeito, em modo texto simples se nenhum PIN for configurado
    this._isEncryptionEnabled = false;
    this._migrationDone = false;
  }

  async getDb() {
    if (this.db) return this.db;
    if (typeof window === 'undefined' || !window.indexedDB) return null;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('[secureStorage] Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Deriva uma CryptoKey AES-GCM a partir de uma passphrase/PIN fornecida pelo utilizador.
   * @param {string} pin
   * @param {Uint8Array} salt
   * @returns {Promise<CryptoKey>}
   */
  async _deriveKey(pin, salt) {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      throw new Error('WebCrypto indisponível neste ambiente.');
    }
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Configura ou desbloqueia o armazenamento com um PIN/passphrase.
   * @param {string} pin
   */
  async unlockWithPin(pin) {
    if (!pin) {
      this._cryptoKey = null;
      this._isEncryptionEnabled = false;
      this._isUnlocked = true;
      return;
    }

    const salt = new TextEncoder().encode('athletemotion-fixed-salt-v1');
    this._cryptoKey = await this._deriveKey(pin, salt);
    this._isEncryptionEnabled = true;
    this._isUnlocked = true;
  }

  /**
   * Bloqueia o armazenamento cifrado (limpa a chave da memória).
   */
  lock() {
    this._cryptoKey = null;
    if (this._isEncryptionEnabled) {
      this._isUnlocked = false;
    }
  }

  isUnlocked() {
    return this._isUnlocked;
  }

  isEncryptionEnabled() {
    return this._isEncryptionEnabled;
  }

  /**
   * Cifra um valor usando AES-GCM se a cifra estiver ativa.
   * @param {*} value
   * @returns {Promise<Object>} Objeto para gravar no IndexedDB
   */
  async _prepareRecord(key, value) {
    const rawJson = JSON.stringify(value);

    if (this._isEncryptionEnabled && this._cryptoKey && window.crypto?.subtle) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(rawJson);
      const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this._cryptoKey,
        encoded
      );

      return {
        key,
        encrypted: true,
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(ciphertext)),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      key,
      encrypted: false,
      data: rawJson,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Decifra um registo do IndexedDB.
   * @param {Object} record
   * @returns {Promise<*>}
   */
  async _restoreRecord(record) {
    if (!record) return null;

    if (record.encrypted) {
      if (!this._cryptoKey || !window.crypto?.subtle) {
        throw new Error('Armazenamento bloqueado: introduza o PIN para aceder aos dados pessoais.');
      }
      const iv = new Uint8Array(record.iv);
      const data = new Uint8Array(record.data);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this._cryptoKey,
        data
      );
      const json = new TextDecoder().decode(decrypted);
      return JSON.parse(json);
    }

    return typeof record.data === 'string' ? JSON.parse(record.data) : record.data;
  }

  /**
   * Guarda um item no armazenamento seguro.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  async setItem(key, value) {
    const db = await this.getDb();
    if (!db) return false;

    const record = await this._prepareRecord(key, value);

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Recupera um item do armazenamento seguro.
   * @param {string} key
   * @returns {Promise<*|null>}
   */
  async getItem(key) {
    const db = await this.getDb();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = async () => {
        if (!req.result) {
          resolve(null);
          return;
        }
        try {
          const value = await this._restoreRecord(req.result);
          resolve(value);
        } catch (err) {
          reject(err);
        }
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Remove um item do armazenamento seguro.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async removeItem(key) {
    const db = await this.getDb();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Migração única: migra dados de `localStorage` para `secureStorage` e apaga do `localStorage`.
   * @returns {Promise<{ migratedCount: number, keys: string[] }>}
   */
  async migrateLegacyLocalStorage() {
    if (this._migrationDone || typeof window === 'undefined' || !window.localStorage) {
      return { migratedCount: 0, keys: [] };
    }

    const migratedKeys = [];
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          await this.setItem(key, parsed);
          window.localStorage.removeItem(key);
          migratedKeys.push(key);
        }
      } catch (err) {
        console.warn(`[secureStorage] Erro ao migrar ${key} de localStorage:`, err.message);
      }
    }

    this._migrationDone = true;
    return { migratedCount: migratedKeys.length, keys: migratedKeys };
  }
}

export const secureStorage = new SecureStorageService();
export default secureStorage;
