import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDualCamera } from '@/composables/useDualCamera';

describe('useDualCamera (Sincronização Estéreo Dual-Câmara)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enumera múltiplos dispositivos de vídeo e seleciona primário e secundário', async () => {
    global.navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { deviceId: 'cam-sagittal', kind: 'videoinput', label: 'Câmara Sagital 1080p' },
        { deviceId: 'cam-frontal', kind: 'videoinput', label: 'Câmara Frontal 720p' },
      ]),
    };

    const dualCam = useDualCamera();
    const devList = await dualCam.listDevices();

    expect(devList.length).toBe(2);
    expect(dualCam.primaryDeviceId.value).toBe('cam-sagittal');
    expect(dualCam.secondaryDeviceId.value).toBe('cam-frontal');
  });

  it('inicia streams primário e secundário e liberta todas as tracks ao parar', async () => {
    const stopSpy1 = vi.fn();
    const stopSpy2 = vi.fn();

    const mockStream1 = { getTracks: () => [{ stop: stopSpy1, kind: 'video' }] };
    const mockStream2 = { getTracks: () => [{ stop: stopSpy2, kind: 'video' }] };

    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockImplementation((constraints) => {
        if (constraints.video?.deviceId?.exact === 'cam-frontal') {
          return Promise.resolve(mockStream2);
        }
        return Promise.resolve(mockStream1);
      }),
    };

    const dualCam = useDualCamera();
    const video1 = document.createElement('video');
    video1.play = vi.fn().mockResolvedValue(undefined);
    const video2 = document.createElement('video');
    video2.play = vi.fn().mockResolvedValue(undefined);

    await dualCam.startPrimary(video1, 'cam-sagittal');
    await dualCam.startSecondary(video2, 'cam-frontal');

    expect(dualCam.isPrimaryActive.value).toBe(true);
    expect(dualCam.isSecondaryActive.value).toBe(true);
    expect(dualCam.isDualActive.value).toBe(true);

    dualCam.stopAll();
    expect(dualCam.isPrimaryActive.value).toBe(false);
    expect(dualCam.isSecondaryActive.value).toBe(false);
    expect(dualCam.isDualActive.value).toBe(false);

    expect(stopSpy1).toHaveBeenCalledTimes(1);
    expect(stopSpy2).toHaveBeenCalledTimes(1);
  });
});

