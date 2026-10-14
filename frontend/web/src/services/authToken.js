/**
 * Gestão de Autenticação e Tokens para a API REST e WebSockets (R16 / R04).
 *
 * Princípios de Segurança:
 * - O token é mantido primariamente em memória RAM (variável de módulo).
 * - Opcionalmente guardado em `sessionStorage` (limpo ao fechar o separador).
 * - NUNCA guardado em `localStorage` (evita persistência em disco sem controlo).
 * - Suporta listeners para eventos de 401 (Unauthorized) e 429 (Rate Limited).
 */

const TOKEN_SESSION_KEY = 'athletemotion_auth_token';

class AuthTokenService {
  constructor() {
    this._token = null;
    this._authListeners = new Set();
    this._unauthorizedListeners = new Set();
    this._rateLimitListeners = new Set();
    this._loadInitialToken();
  }

  _loadInitialToken() {
    // 1. Variável de ambiente de build (.env VUE_APP_API_TOKEN)
    const envToken = typeof process !== 'undefined' && process.env?.VUE_APP_API_TOKEN;
    if (envToken) {
      this._token = envToken;
      return;
    }

    // 2. sessionStorage (se utilizador optou por guardar na sessão do separador)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const stored = window.sessionStorage.getItem(TOKEN_SESSION_KEY);
        if (stored) {
          this._token = stored;
        }
      } catch (err) {
        console.warn('[authToken] sessionStorage inacessível:', err.message);
      }
    }
  }

  /**
   * Obtém o token de autenticação atual.
   * @returns {string|null}
   */
  getToken() {
    return this._token;
  }

  /**
   * Define o token de autenticação.
   * @param {string|null} token
   * @param {boolean} [persistInSession=false] Se true, guarda no sessionStorage do separador
   */
  setToken(token, persistInSession = false) {
    this._token = token ? String(token).trim() : null;

    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        if (this._token && persistInSession) {
          window.sessionStorage.setItem(TOKEN_SESSION_KEY, this._token);
        } else {
          window.sessionStorage.removeItem(TOKEN_SESSION_KEY);
        }
      } catch (err) {
        console.warn('[authToken] Erro ao persistir no sessionStorage:', err.message);
      }
    }

    this._notifyAuthChanged(this._token);
  }

  /**
   * Remove o token em memória e sessão.
   */
  clearToken() {
    this.setToken(null, false);
  }

  /**
   * Verifica se existe um token configurado.
   * @returns {boolean}
   */
  hasToken() {
    return Boolean(this._token);
  }

  /**
   * Formata a URL do WebSocket garantindo wss:// se em https e incluindo query/subprotocolo.
   * @param {string} rawWsUrl
   * @returns {string} URL segura pronta a usar
   */
  buildWsUrl(rawWsUrl) {
    let url = rawWsUrl;
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      url = url.replace(/^ws:\/\//i, 'wss://');
    }

    if (this._token) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}token=${encodeURIComponent(this._token)}`;
    }
    return url;
  }

  /**
   * Regista listener para alteração de token.
   * @param {(token: string|null) => void} callback
   * @returns {() => void} unsubscribe
   */
  onAuthChange(callback) {
    this._authListeners.add(callback);
    return () => this._authListeners.delete(callback);
  }

  /**
   * Regista listener para erros 401 Unauthorized.
   * @param {(errorInfo: Object) => void} callback
   * @returns {() => void} unsubscribe
   */
  onUnauthorized(callback) {
    this._unauthorizedListeners.add(callback);
    return () => this._unauthorizedListeners.delete(callback);
  }

  /**
   * Notifica listeners de um erro 401.
   * @param {Object} details
   */
  notifyUnauthorized(details = {}) {
    for (const listener of this._unauthorizedListeners) {
      try {
        listener(details);
      } catch (err) {
        console.warn('[authToken] Erro no listener onUnauthorized:', err);
      }
    }
  }

  /**
   * Regista listener para erros 429 Too Many Requests (Rate Limit).
   * @param {(retryAfterSec: number) => void} callback
   * @returns {() => void} unsubscribe
   */
  onRateLimit(callback) {
    this._rateLimitListeners.add(callback);
    return () => this._rateLimitListeners.delete(callback);
  }

  /**
   * Notifica listeners de um erro 429 com o tempo Retry-After.
   * @param {number} retryAfterSec
   */
  notifyRateLimit(retryAfterSec = 5) {
    for (const listener of this._rateLimitListeners) {
      try {
        listener(retryAfterSec);
      } catch (err) {
        console.warn('[authToken] Erro no listener onRateLimit:', err);
      }
    }
  }

  _notifyAuthChanged(token) {
    for (const listener of this._authListeners) {
      try {
        listener(token);
      } catch (err) {
        console.warn('[authToken] Erro no listener onAuthChange:', err);
      }
    }
  }
}

export const authToken = new AuthTokenService();
export default authToken;
