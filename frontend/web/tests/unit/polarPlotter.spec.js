import { describe, it, expect, beforeEach } from 'vitest';
import { PolarPlotter } from '@/services/polarPlotter';

describe('PolarPlotter (Diagrama Polar 360° e Métricas PSI / TE)', () => {
  let plotter;

  beforeEach(() => {
    plotter = new PolarPlotter(24);
  });

  it('inicializa 24 setores vazios e valores padrão', () => {
    expect(plotter.numSectors).toBe(24);
    expect(plotter.sectorValues.length).toBe(24);
    expect(plotter.calculatePsi()).toBe(82.0); // Valor padrão fisiológico
  });

  it('adiciona amostras radiais e calcula suavidade da pedalada (PSI %)', () => {
    // Adiciona distribuição relativamente suave ao longo do ciclo
    for (let angle = 0; angle < 360; angle += 15) {
      const rad = (angle * Math.PI) / 180;
      const mag = 500 + 200 * Math.sin(rad);
      plotter.addSample(angle, mag);
    }

    const psi = plotter.calculatePsi();
    expect(psi).toBeGreaterThan(50);
    expect(psi).toBeLessThanOrEqual(100);
  });

  it('calcula a eficácia de torque (TE %) distinguindo impulsão e recuperação', () => {
    // Fase de impulsão alta (30° a 150°)
    for (let angle = 30; angle <= 150; angle += 15) {
      plotter.addSample(angle, 800.0);
    }
    // Fase de recuperação (210° a 330°)
    for (let angle = 210; angle <= 330; angle += 15) {
      plotter.addSample(angle, 50.0);
    }

    const te = plotter.calculateTe();
    expect(te).toBeGreaterThan(70);
    expect(te).toBeLessThanOrEqual(99);
  });

  it('faz reset completo de contagens e ângulos', () => {
    plotter.addSample(90, 600.0);
    expect(plotter.currentAngleDeg).toBe(90);

    plotter.reset();
    expect(plotter.currentAngleDeg).toBeNull();
    expect(plotter.sectorCounts.every((c) => c === 0)).toBe(true);
  });
});

