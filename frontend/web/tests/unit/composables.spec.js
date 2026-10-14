import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCamera } from '@/composables/useCamera';
import { useCycleDisplay } from '@/composables/useCycleDisplay';
import { useInferenceSocket } from '@/composables/useInferenceSocket';
import { useSessionRecorder } from '@/composables/useSessionRecorder';
import { setActivePinia, createPinia } from 'pinia';
import { apiService } from '@/services/api';

describe('Composables (R16 Decomposition)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  describe('useCamera', () => {
    it('inicia e pára câmara libertando tracks de hardware', async () => {
      const stopTrackSpy = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: stopTrackSpy, kind: 'video' }],
      };

      global.navigator.mediaDevices = {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'cam-1', kind: 'videoinput', label: 'Webcam 1080p' },
        ]),
      };

      const camera = useCamera();
      await camera.listDevices();
      expect(camera.devices.value.length).toBe(1);

      const videoEl = document.createElement('video');
      videoEl.play = vi.fn().mockResolvedValue(undefined);

      await camera.startCamera(videoEl, 'cam-1');
      expect(camera.isCameraActive.value).toBe(true);

      camera.stopCamera(videoEl);
      expect(camera.isCameraActive.value).toBe(false);
      expect(stopTrackSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('useCycleDisplay', () => {
    it('atualiza fases de pedalada e cadência a partir da telemetria R10', () => {
      const cycle = useCycleDisplay();

      // Fase de potência: 3h
      cycle.updateFromTelemetry({
        clock_position: 3,
        is_bdc: false,
        is_tdc: false,
        cycle: { cadence_rpm: 89.2, periodicity_confidence: 0.92, knee_rom_deg: 72.5 },
      });
      expect(cycle.pedalingPhase.value).toBe('power');
      expect(cycle.cadenceRpm.value).toBe(89);
      expect(cycle.isCadenceReliable.value).toBe(true);

      // BDC (Ponto Morto Inferior): 6h
      cycle.updateFromTelemetry({
        clock_position: 6,
        is_bdc: true,
        is_tdc: false,
      });
      expect(cycle.pedalingPhase.value).toBe('bottom_dead');
      expect(cycle.phaseLabel.value).toContain('BDC');
    });
  });

  describe('useSessionRecorder', () => {
    it('inicia sessão, grava snapshots e completa', async () => {
      vi.spyOn(apiService, 'startFitSession').mockResolvedValue({ id: 'sess-test-99' });
      vi.spyOn(apiService, 'recordSnapshot').mockResolvedValue({ status: 'ok' });
      vi.spyOn(apiService, 'completeFitSession').mockResolvedValue({ id: 'sess-test-99', status: 'completed' });

      const recorder = useSessionRecorder();
      await recorder.startSession('ath-1', 'bike-1');

      expect(recorder.currentSessionId.value).toBe('sess-test-99');
      expect(recorder.isRecording.value).toBe(true);

      await recorder.captureSnapshot({ angles: { knee: 148 }, is_bdc: true });
      expect(recorder.snapshotCount.value).toBe(1);

      const report = await recorder.completeSession();
      expect(report.status).toBe('completed');
      expect(recorder.isRecording.value).toBe(false);
    });
  });

  describe('useInferenceSocket', () => {
    it('controla estado de envio e rejeita frame quando desconectado', async () => {
      const socket = useInferenceSocket();
      expect(socket.isConnected.value).toBe(false);

      const fakeBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
      const sent = await socket.dispatchFrame(fakeBlob, 100);
      expect(sent).toBe(false);
    });
  });
});
