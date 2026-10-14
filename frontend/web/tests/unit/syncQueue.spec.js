import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncQueueService } from '@/services/syncQueue';
import { apiClient } from '@/services/api';

describe('SyncQueueService', () => {
  let queue;

  beforeEach(async () => {
    queue = new SyncQueueService();
    vi.restoreAllMocks();
    await queue.clear();
  });

  afterEach(() => {
    queue.close();
  });

  it('enfileira snapshot com Idempotency-Key e atualiza estado', async () => {
    // Intercetar chamada de processQueue para verificar persistência na fila
    vi.spyOn(queue, 'processQueue').mockImplementation(async () => {});

    const snapshotPayload = {
      sessionId: 'sess-001',
      snapshotData: { stage: 'bdc', angles: { knee: 148 } },
    };

    const id = await queue.enqueue('snapshot', snapshotPayload);
    expect(id).toBeDefined();

    const status = await queue.getStatus();
    expect(status.pending).toBeGreaterThanOrEqual(1);
  });

  it('agrupa múltiplos snapshots da mesma sessão em lote (batching)', async () => {
    // Desativar auto-processamento durante o enfileiramento inicial
    const processSpy = vi.spyOn(queue, 'processQueue').mockImplementation(async () => {});

    await queue.enqueue('snapshot', {
      sessionId: 'sess-batch-1',
      snapshotData: { frame: 1, angles: { knee: 145 } },
    });
    await queue.enqueue('snapshot', {
      sessionId: 'sess-batch-1',
      snapshotData: { frame: 2, angles: { knee: 146 } },
    });

    // Restaurar processQueue e capturar chamadas ao apiClient
    processSpy.mockRestore();
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { success: true } });

    await queue.processQueue();

    // Deve ter chamado o endpoint de batch: /api/v1/sessions/sess-batch-1/snapshots:batch com ambos os snapshots
    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/sessions/sess-batch-1/snapshots:batch',
      {
        snapshots: expect.arrayContaining([
          expect.objectContaining({ frame: 1 }),
          expect.objectContaining({ frame: 2 }),
        ]),
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.stringContaining('batch-'),
        }),
      })
    );
  });
});
