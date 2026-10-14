import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authToken } from '@/services/authToken';

describe('AuthTokenService', () => {
  beforeEach(() => {
    authToken.clearToken();
  });

  it('armazena e recupera o token em memória', () => {
    expect(authToken.hasToken()).toBe(false);
    expect(authToken.getToken()).toBeNull();

    authToken.setToken('test-secret-token-123');
    expect(authToken.hasToken()).toBe(true);
    expect(authToken.getToken()).toBe('test-secret-token-123');

    authToken.clearToken();
    expect(authToken.hasToken()).toBe(false);
    expect(authToken.getToken()).toBeNull();
  });

  it('guarda em sessionStorage quando explicitamente solicitado', () => {
    authToken.setToken('session-token-abc', true);
    expect(window.sessionStorage.getItem('athletemotion_auth_token')).toBe('session-token-abc');

    authToken.clearToken();
    expect(window.sessionStorage.getItem('athletemotion_auth_token')).toBeNull();
  });

  it('formata URLs do WebSocket com token e wss:// em páginas HTTPS', () => {
    authToken.setToken('my-ws-token');
    const wsUrl = authToken.buildWsUrl('ws://127.0.0.1:8000/ws/live-inference');
    expect(wsUrl).toContain('token=my-ws-token');
  });

  it('dispara evento onUnauthorized ao receber 401', () => {
    const handler = vi.fn();
    const unsubscribe = authToken.onUnauthorized(handler);

    authToken.notifyUnauthorized({ status: 401, detail: 'Token inválido' });
    expect(handler).toHaveBeenCalledWith({ status: 401, detail: 'Token inválido' });

    unsubscribe();
    authToken.notifyUnauthorized({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispara evento onRateLimit com tempo de retry', () => {
    const handler = vi.fn();
    const unsubscribe = authToken.onRateLimit(handler);

    authToken.notifyRateLimit(15);
    expect(handler).toHaveBeenCalledWith(15);

    unsubscribe();
  });
});
