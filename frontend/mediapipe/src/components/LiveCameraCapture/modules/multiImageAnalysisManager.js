/**
 * Gestor de Análise de Múltiplas Imagens de Posições da Pedalada (MultiImageAnalysisManager).
 *
 * Responsabilidade:
 * - Gerir fila de imagens estáticas da pedalada (BDC, 90°, TDC, 270°, Livre).
 * - Carregar e converter ficheiros em elementos de imagem decodificados.
 * - Gerir estado de análise individual e em lote ("a pedido").
 * - Sintetizar relatório comparativo biomecânico entre as diferentes fases da pedalada.
 */

export class MultiImageAnalysisManager {
  static CRANK_POSITIONS = [
    { value: 'bdc', label: 'BDC (Ponto Morto Inferior - 6h / 180°)', shortLabel: 'BDC (6h)', icon: '🔻', keyMetric: 'Extensão Joelho (145°-155°)' },
    { value: '90deg', label: '90° (Fase de Potência - 3h / Cranque Horizontal)', shortLabel: '90° (3h)', icon: '➡️', keyMetric: 'Alinhamento KOPS (±10 mm)' },
    { value: 'tdc', label: 'TDC (Ponto Morto Superior - 12h / 0°)', shortLabel: 'TDC (12h)', icon: '🔺', keyMetric: 'Fecho da Anca (> 50°)' },
    { value: '270deg', label: '270° (Fase de Recuperação - 9h)', shortLabel: '270° (9h)', icon: '⬅️', keyMetric: 'Estabilidade Tornozelo' },
    { value: 'custom', label: 'Posição Livre / Personalizada', shortLabel: 'Livre', icon: '⚪', keyMetric: 'Registo Biomecânico Geral' },
  ];

  constructor() {
    this.items = [];
    this.activeId = null;
    this.isBatchAnalyzing = false;
  }

  /**
   * Adiciona múltiplos ficheiros de imagem e decodifica-os.
   */
  async addFiles(fileList) {
    if (!fileList || !fileList.length) return [];
    const added = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) continue;

      const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const dataUrl = await this.readFileAsDataUrl(file);
      const imgElem = await this.preloadImage(dataUrl);

      // Sugestão automática inteligente de posição da pedaleira
      const lowerName = file.name.toLowerCase();
      let crankPosition = 'custom';
      if (lowerName.includes('bdc') || lowerName.includes('inferior') || lowerName.includes('baixo') || lowerName.includes('180')) {
        crankPosition = 'bdc';
      } else if (lowerName.includes('90') || lowerName.includes('potencia') || lowerName.includes('kops') || lowerName.includes('horizontal')) {
        crankPosition = '90deg';
      } else if (lowerName.includes('tdc') || lowerName.includes('superior') || lowerName.includes('topo') || lowerName.includes('cima') || lowerName.includes('0')) {
        crankPosition = 'tdc';
      } else if (lowerName.includes('270') || lowerName.includes('recupera')) {
        crankPosition = '270deg';
      } else {
        // Atribui sequencialmente caso não haja pista no nome
        const positionKeys = ['bdc', '90deg', 'tdc', '270deg'];
        const existingCount = this.items.length + added.length;
        crankPosition = positionKeys[existingCount % positionKeys.length] || 'custom';
      }

      const item = {
        id,
        file,
        name: file.name,
        sizeText: `${(file.size / 1024).toFixed(0)} KB`,
        dataUrl,
        imageElement: imgElem,
        crankPosition,
        status: 'pending',
        errorMessage: '',
        angles: { joelho: null, costas: null, braco: null, tornozelo: null, cabeca: null, anca: null },
        isFullBodyVisible: false,
        missingSegments: [],
        kopsResult: null,
        report: null,
        analyzedCanvasDataUrl: null,
      };

      this.items.push(item);
      added.push(item);
    }

    if (!this.activeId && this.items.length > 0) {
      this.activeId = this.items[0].id;
    }

    return added;
  }

  readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  removeImage(id) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      if (this.activeId === id) {
        this.activeId = this.items.length ? this.items[0].id : null;
      }
    }
  }

  clearAll() {
    this.items = [];
    this.activeId = null;
  }

  setCrankPosition(id, crankPosition) {
    const item = this.items.find((it) => it.id === id);
    if (item) {
      item.crankPosition = crankPosition;
    }
  }

  getActiveImage() {
    return this.items.find((it) => it.id === this.activeId) || null;
  }

  setActiveImage(id) {
    if (this.items.some((it) => it.id === id)) {
      this.activeId = id;
    }
  }

  getPositionMeta(value) {
    return MultiImageAnalysisManager.CRANK_POSITIONS.find((p) => p.value === value) || MultiImageAnalysisManager.CRANK_POSITIONS[4];
  }

  /**
   * Constrói resumo comparativo entre todas as fotos da pedalada já analisadas.
   */
  getComparisonSummary() {
    const analyzed = this.items.filter((it) => it.status === 'done');
    const bdcItem = analyzed.find((it) => it.crankPosition === 'bdc');
    const ninetyItem = analyzed.find((it) => it.crankPosition === '90deg');
    const tdcItem = analyzed.find((it) => it.crankPosition === 'tdc');

    return {
      totalUploaded: this.items.length,
      totalAnalyzed: analyzed.length,
      bdcItem,
      ninetyItem,
      tdcItem,
      analyzedItems: analyzed,
    };
  }

  /**
   * Formata texto descritivo do relatório comparativo para impressão/cópia.
   */
  formatMultiPositionReport(athleteName = 'Ciclista', bikeModel = 'Bicicleta') {
    const comp = this.getComparisonSummary();
    let txt = `========================================================\n`;
    txt += `  ATHLETE MOTION - AVALIAÇÃO MULTI-POSIÇÃO DA PEDALADA  \n`;
    txt += `========================================================\n`;
    txt += `Atleta: ${athleteName} | Bicicleta: ${bikeModel}\n`;
    txt += `Total de Fotos Analisadas: ${comp.totalAnalyzed} de ${comp.totalUploaded}\n\n`;

    comp.analyzedItems.forEach((it, idx) => {
      const meta = this.getPositionMeta(it.crankPosition);
      txt += `[Foto #${idx + 1}] ${meta.icon} ${meta.label}\n`;
      txt += `  - Ficheiro: ${it.name}\n`;
      txt += `  - Joelho: ${it.angles.joelho !== null ? `${Math.round(it.angles.joelho)}°` : '--'}\n`;
      txt += `  - Anca / Tronco: ${it.angles.anca !== null ? `${Math.round(it.angles.anca)}°` : '--'}\n`;
      txt += `  - Tronco (Horizontal): ${it.angles.costas !== null ? `${Math.round(it.angles.costas)}°` : '--'}\n`;
      txt += `  - Braço: ${it.angles.braco !== null ? `${Math.round(it.angles.braco)}°` : '--'}\n`;
      txt += `  - Tornozelo: ${it.angles.tornozelo !== null ? `${Math.round(it.angles.tornozelo)}°` : '--'}\n`;
      if (it.kopsResult) {
        txt += `  - KOPS: ${it.kopsResult.actionPt} (${it.kopsResult.offsetMm} mm)\n`;
      }
      if (it.report && it.report.verdict) {
        txt += `  - Diagnóstico: ${it.report.verdict} (${it.report.score}%)\n`;
      }
      txt += `--------------------------------------------------------\n`;
    });

    txt += `========================================================\n`;
    return txt;
  }
}
