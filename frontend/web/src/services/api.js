import axios from 'axios';
import { offlineStorage } from './offlineStorage';

// Detecta o IP do servidor automaticamente para suportar telemóveis e tablets na mesma rede Wi-Fi
const getBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return `http://${window.location.hostname}:8000`;
  }
  return process.env.VUE_APP_API_URL || 'http://localhost:8000';
};

const apiClient = axios.create({
  baseURL: getBaseUrl(),
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// O cliente é partilhado: quem precisa de uma rota da API (ex.: compilação do GIF) tem de usar a
// MESMA base URL, senão o pedido relativo cai no servidor de desenvolvimento (404) e a exportação
// degrada silenciosamente para um fotograma estático.
export { apiClient, getBaseUrl };

export const apiService = {
  // Estimativa biomecânica teórica imediata
  async estimateTheoreticalFit(payload) {
    try {
      const response = await apiClient.post('/api/v1/biomechanics/estimate', payload);
      return response.data;
    } catch (err) {
      console.warn('Fallback offline para estimativa teórica:', err.message);
      // Fórmulas biomecânicas locais se o backend estiver inacessível
      const inseam = payload.inseam_cm || 80.0;
      const height = payload.height_cm || 175.0;
      return {
        theoretical_saddle_height_lemond: Math.round(inseam * 0.883 * 10) / 10,
        theoretical_saddle_height_109: Math.round(inseam * 1.09 * 10) / 10,
        recommended_frame_size: Math.round(inseam * 0.65 * 10) / 10,
        recommended_crank_length: inseam < 78 ? 170.0 : (inseam <= 86 ? 172.5 : 175.0),
        recommended_handlebar_width: (payload.shoulder_width_cm ? payload.shoulder_width_cm * 10 : 420.0),
        saddle_reach_estimate: Math.round((height * 0.32) * 10) / 10,
        is_offline: true,
      };
    }
  },

  // Criar ciclista
  async createAthlete(athleteData) {
    try {
      const response = await apiClient.post('/api/v1/athletes', athleteData);
      return response.data;
    } catch (err) {
      console.warn('Guardando ciclista em modo offline:', err.message);
      return {
        id: `offline-ath-${Date.now()}`,
        ...athleteData,
        is_offline: true,
      };
    }
  },

  // Criar bicicleta
  async createBike(bikeData) {
    try {
      const response = await apiClient.post('/api/v1/bikes', bikeData);
      return response.data;
    } catch (err) {
      console.warn('Guardando bicicleta em modo offline:', err.message);
      return {
        id: `offline-bike-${Date.now()}`,
        ...bikeData,
        is_offline: true,
      };
    }
  },

  // Iniciar sessão de fit (ACID com fallback offline)
  async startFitSession(athleteId, bikeId) {
    try {
      const response = await apiClient.post('/api/v1/sessions', {
        athlete_id: athleteId,
        bike_id: bikeId,
      });
      return response.data;
    } catch (err) {
      console.warn('Backend indisponível, criando sessão offline IndexedDB:', err.message);
      const offlineId = `offline-sess-${Date.now()}`;
      const sessionRecord = {
        id: offlineId,
        athlete_id: athleteId,
        bike_id: bikeId,
        status: 'in_progress',
        is_offline: true,
        created_at: new Date().toISOString(),
      };
      await offlineStorage.saveOfflineSession(sessionRecord);
      return sessionRecord;
    }
  },

  // Registar snapshot
  async recordSnapshot(sessionId, snapshotData) {
    try {
      const response = await apiClient.post(`/api/v1/sessions/${sessionId}/snapshot`, snapshotData);
      return response.data;
    } catch (err) {
      console.warn('Guardando snapshot em IndexedDB offline:', err.message);
      await offlineStorage.saveOfflineSnapshot(sessionId, snapshotData);
      return { status: 'recorded_offline', session_id: sessionId, is_offline: true };
    }
  },

  // Concluir sessão e gerar relatório consolidado (ACID Commit)
  async completeFitSession(sessionId) {
    try {
      const response = await apiClient.post(`/api/v1/sessions/${sessionId}/complete`);
      return response.data;
    } catch (err) {
      console.warn('Concluindo sessão em IndexedDB offline:', err.message);
      const sessions = await offlineStorage.getOfflineSessions();
      const target = sessions.find((s) => s.id === sessionId) || { id: sessionId };
      target.status = 'completed';
      target.completed_at = new Date().toISOString();
      await offlineStorage.saveOfflineSession(target);
      return {
        session_id: sessionId,
        status: 'completed_offline',
        is_offline: true,
      };
    }
  },

  // Consultar relatório de sessão
  async getReport(sessionId) {
    try {
      const response = await apiClient.get(`/api/v1/sessions/${sessionId}/report`);
      return response.data;
    } catch (err) {
      console.warn('A carregar relatório do cache IndexedDB offline:', err.message);
      const sessions = await offlineStorage.getOfflineSessions();
      const s = sessions.find((item) => item.id === sessionId);
      if (s) {
        return {
          session_id: sessionId,
          is_offline: true,
          status: 'completed_offline',
          athlete: { name: 'Ciclista Local (Offline)' },
          bike: { model_brand: 'Bicicleta Local' },
          compliance_score: 88.0,
          diagnostics: [],
          recommendations: ['Sessão guardada em IndexedDB offline. Sincronize quando online para gerar o PDF oficial.'],
        };
      }
      throw err;
    }
  },

  // Obter parecer narrativo do Treinador de IA (FEAT-21)
  async getAiCoachReport(sessionId, lang = 'pt') {
    try {
      const response = await apiClient.get(`/api/v1/sessions/${sessionId}/ai-coach?lang=${lang}`);
      return response.data;
    } catch (err) {
      console.warn('Falha ao obter parecer do Treinador de IA:', err.message);
      return null;
    }
  },

  // Consultar histórico de sessões do atleta (FEAT-16 Comparador)
  async getAthleteSessions(athleteId) {
    try {
      const response = await apiClient.get(`/api/v1/sessions/by-athlete/${athleteId}`);
      return response.data;
    } catch (err) {
      console.warn('Falha ao obter histórico online, buscando offline:', err.message);
      const sessions = await offlineStorage.getOfflineSessions();
      return sessions.filter((s) => s.athlete_id === athleteId);
    }
  },

  // Obter sessões salvas em IndexedDB
  async getOfflineStoredSessions() {
    return offlineStorage.getOfflineSessions();
  },

  // Sincronizar sessões pendentes com o servidor backend
  async syncOfflineSessions() {
    const offlineList = await offlineStorage.getOfflineSessions();
    const unsynced = offlineList.filter((s) => !s.isSynced);
    let syncedCount = 0;

    for (const session of unsynced) {
      try {
        await apiClient.post('/api/v1/sessions', {
          athlete_id: session.athlete_id,
          bike_id: session.bike_id,
        });
        session.isSynced = true;
        await offlineStorage.saveOfflineSession(session);
        syncedCount += 1;
      } catch (e) {
        console.warn('Não foi possível sincronizar sessão:', session.id, e.message);
      }
    }
    return syncedCount;
  },

  // Obter URL para descarregar relatório PDF oficial (FEAT-09)
  getPdfDownloadUrl(sessionId, { lang = 'pt', kopsOffset = null, saddleDrop = null, cadence = null, power = null } = {}) {
    const base = getBaseUrl();
    const params = new URLSearchParams();
    params.set('lang', lang);
    if (kopsOffset !== null) params.set('kops_offset', kopsOffset);
    if (saddleDrop !== null) params.set('saddle_drop', saddleDrop);
    if (cadence !== null) params.set('cadence_rpm', cadence);
    if (power !== null) params.set('power_watts', power);
    return `${base}/api/v1/sessions/${sessionId}/pdf?${params.toString()}`;
  },

  // Verificação de saúde da API
  async checkHealth() {
    try {
      const response = await apiClient.get('/health');
      return response.data?.status === 'ok';
    } catch {
      return false;
    }
  },
};



