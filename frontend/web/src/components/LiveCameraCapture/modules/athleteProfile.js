/**
 * Perfil do Atleta para Análise Biomecânica Rigorosa (AthleteProfile).
 *
 * PORQUÊ PEDIR ESTES DADOS:
 * - **Peso (obrigatório):** não existe evidência de que o peso altere o alvo angular do joelho,
 *   mas altera a LEITURA mecânica: define o sag de suspensão (25–33% atrás / 15–20% à frente com
 *   o atleta a bordo), a partilha de carga entre selim/mãos e justifica verificar a largura do
 *   selim e o amortecimento de compressão. Fonte:
 *   https://ridefox.com/blogs/academy/fox-academy-video-series-why-setting-sag-for-your-mountain-bike-matters
 * - **Número de sapato (obrigatório):** é o dado que orienta a posição dos travessões em relação
 *   ao eixo do pedal (prática de fit: recuo cresce com o tamanho) e avisa quando o eixo do pedal
 *   está demasiado à frente do 1º metatarso. Fontes:
 *   https://www.stevehoggbikefitting.com/bikefit/2011/04/power-to-the-pedal-cleat-position/
 *   https://www.myvelofit.com/fit-academy/cycling-cleat-positioning-101/
 * - **Cintura / perímetro abdominal (opcional):** não existe regra publicada que a converta num
 *   ângulo. É recolhida como CONTEXTO antropométrico: em posições agressivas é a circunferência
 *   abdominal que costuma limitar a tolerância ao fecho da anca — por isso a nota remete para o
 *   fecho da anca medido às 12h (alvo 50–80°), em vez de inventar um alvo próprio.
 * - **Altura e costura interior (opcionais):** a costura interior é a variável que realmente
 *   alimenta as fórmulas de altura de selim (LeMond: costura × 0,883) e o comprimento de bielas.
 *   Sem ela, a análise ANGULAR continua válida — apenas não se estima altura por fórmula.
 *   A altura serve só para estimar a costura quando esta não é fornecida (≈ 0,47 × altura).
 *
 * REGRA DE HONESTIDADE: nenhum destes dados é usado para alterar os alvos angulares.
 * São usados para (a) notas mecânicas verificáveis e (b) metadados do relatório.
 */

/** Limites plausíveis para validação dos campos (evitam lixo que estraga o relatório). */
export const PROFILE_LIMITS = {
  weightKg: { min: 30, max: 180, step: 0.5 },
  shoeSizeEu: { min: 33, max: 52, step: 0.5 },
  waistCm: { min: 50, max: 160, step: 0.5 },
  heightCm: { min: 130, max: 215, step: 0.5 },
  inseamCm: { min: 55, max: 115, step: 0.5 },
};

/** Rácio prático altura → costura interior, usado apenas quando a costura não é fornecida. */
export const HEIGHT_TO_INSEAM_RATIO = 0.47;

/**
 * Recuo do travessão (mm com que o CENTRO do 1º metatarso fica À FRENTE do eixo do pedal),
 * por faixa de tamanho de sapato — prática de Steve Hogg (orientação de partida, não norma
 * validada; o autor não especifica o sistema de numeração, aqui lido como EU com aviso).
 */
export const CLEAT_SETBACK_BY_SHOE_SIZE = [
  { upTo: 38, min: 7, max: 9, label: '36–38' },
  { upTo: 41, min: 8, max: 10, label: '39–41' },
  { upTo: 43, min: 9, max: 11, label: '42–43' },
  { upTo: 45, min: 10, max: 12, label: '44–45' },
  { upTo: 47, min: 11, max: 14, label: '46–47' },
  { upTo: 50, min: 12, max: 16, label: '48–50' },
];

/** Faixas de sag de suspensão recomendadas (percentagem do curso), com o atleta a bordo. */
export const SUSPENSION_SAG_RANGE = { rear: [25, 33], front: [15, 20] };

export class AthleteProfile {
  /**
   * Converte um valor escrito pelo utilizador em número ("82,5 kg" → 82.5).
   * @param {*} raw
   * @returns {number|null}
   */
  static parseNumber(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const normalized = String(raw).replace(',', '.').replace(/[^0-9.]/g, '');
    if (!normalized) return null;
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Normaliza/valida um perfil. Campos fora dos limites plausíveis são rejeitados (com motivo)
   * em vez de aceites silenciosamente — um peso mal escrito arruinaria as notas mecânicas.
   * @param {Object} raw
   * @returns {{ weightKg:number|null, shoeSizeEu:number|null, waistCm:number|null, heightCm:number|null, inseamCm:number|null, complete:boolean, missingRequired:string[], issues:Array<{field:string, message:string}> }}
   */
  static normalize(raw = {}) {
    const issues = [];
    const parsed = {};
    const fields = {
      weightKg: 'Peso',
      shoeSizeEu: 'Número de sapato',
      waistCm: 'Cintura',
      heightCm: 'Altura',
      inseamCm: 'Costura interior',
    };

    Object.keys(fields).forEach((field) => {
      const value = this.parseNumber(raw[field]);
      const limits = PROFILE_LIMITS[field];
      if (value === null) {
        parsed[field] = null;
        return;
      }
      if (value < limits.min || value > limits.max) {
        issues.push({
          field,
          message: `${fields[field]} fora do intervalo plausível (${limits.min} a ${limits.max}).`,
        });
        parsed[field] = null;
        return;
      }
      parsed[field] = value;
    });

    const missingRequired = [];
    if (parsed.weightKg === null) missingRequired.push('weightKg');
    if (parsed.shoeSizeEu === null) missingRequired.push('shoeSizeEu');

    const validCleatPositions = ['rearward', 'neutral', 'forward'];
    const rawCleatPos = String(raw.cleatPosition ?? raw.cleat_position ?? '').trim().toLowerCase();
    const cleatPosition = validCleatPositions.includes(rawCleatPos) ? rawCleatPos : null;

    return {
      weightKg: parsed.weightKg,
      shoeSizeEu: parsed.shoeSizeEu,
      waistCm: parsed.waistCm,
      heightCm: parsed.heightCm,
      inseamCm: parsed.inseamCm,
      cleatPosition,
      complete: missingRequired.length === 0,
      missingRequired,
      issues,
    };
  }

  /** O perfil tem o mínimo obrigatório (peso + número de sapato)? */
  static isComplete(raw = {}) {
    return this.normalize(raw).complete;
  }

  /**
   * Costura interior efetiva: a fornecida ou, em alternativa, estimada da altura (≈ 0,47).
   * @returns {{ value:number|null, estimated:boolean }}
   */
  static resolveInseam(raw = {}) {
    const profile = this.normalize(raw);
    if (profile.inseamCm) return { value: profile.inseamCm, estimated: false };
    if (profile.heightCm) {
      return { value: Math.round(profile.heightCm * HEIGHT_TO_INSEAM_RATIO * 10) / 10, estimated: true };
    }
    return { value: null, estimated: false };
  }

  /**
   * Estimativa de altura de selim (centro do eixo do pedal → topo do selim) pelo método LeMond.
   * @returns {{ mm:number, cm:number, estimatedFromHeight:boolean }|null}
   */
  static saddleHeightFromInseam(raw = {}) {
    const inseam = this.resolveInseam(raw);
    if (!inseam.value) return null;
    const mm = Math.round(inseam.value * 0.883 * 10);
    return { mm, cm: Math.round(mm / 10), estimatedFromHeight: inseam.estimated };
  }

  /**
   * Faixa de recuo de travessão recomendada para o tamanho de sapato, ou `null` sem dado.
   * @returns {{ min:number, max:number, band:string }|null}
   */
  static cleatSetbackForShoeSize(shoeSizeEu) {
    const size = this.parseNumber(shoeSizeEu);
    if (size === null) return null;
    const band = CLEAT_SETBACK_BY_SHOE_SIZE.find((entry) => size <= entry.upTo);
    if (!band) return null;
    return { min: band.min, max: band.max, band: band.label };
  }

  /**
   * Comprimento aproximado do pé (cm) a partir do número EU — só para contexto do relatório.
   * Aproximação prática: comprimento ≈ (tamanho − 2) × 2/3.
   */
  static footLengthCm(shoeSizeEu) {
    const size = this.parseNumber(shoeSizeEu);
    if (size === null) return null;
    return Math.round(((size - 2) * 2) / 3 * 10) / 10;
  }

  /**
   * Notas mecânicas derivadas do perfil, prontas a apresentar e a exportar.
   * Cada nota declara o dado que a originou e a fonte da recomendação.
   * @returns {Array<{ key:string, icon:string, label:string, text:string, source:string }>}
   */
  static describe(raw = {}) {
    const profile = this.normalize(raw);
    const notes = [];

    if (profile.weightKg !== null) {
      const heavy = profile.weightKg >= 90;
      notes.push({
        key: 'weightSag',
        icon: '⚖️',
        label: `Peso ${profile.weightKg} kg`,
        text: heavy
          ? `Atleta pesado (≥ 90 kg): verificar o sag de suspensão com o atleta a bordo — ${SUSPENSION_SAG_RANGE.rear[0]}–${SUSPENSION_SAG_RANGE.rear[1]}% atrás e ${SUSPENSION_SAG_RANGE.front[0]}–${SUSPENSION_SAG_RANGE.front[1]}% à frente — e reforçar o amortecimento de compressão. Confirmar também a largura do selim e a carga nas mãos.`
          : `Confirmar o sag com o atleta a bordo (${SUSPENSION_SAG_RANGE.rear[0]}–${SUSPENSION_SAG_RANGE.rear[1]}% atrás, ${SUSPENSION_SAG_RANGE.front[0]}–${SUSPENSION_SAG_RANGE.front[1]}% à frente). O peso não altera os alvos angulares do joelho.`,
        source: 'FOX — sag de suspensão',
      });
    }

    if (profile.shoeSizeEu !== null) {
      const setback = this.cleatSetbackForShoeSize(profile.shoeSizeEu);
      const foot = this.footLengthCm(profile.shoeSizeEu);
      notes.push({
        key: 'cleat',
        icon: '👟',
        label: `Sapato ${profile.shoeSizeEu} EU${foot ? ` (≈ ${foot} cm de pé)` : ''}`,
        text: setback
          ? `Referência de partida para os travessões nesta faixa (${setback.band}): centro do 1º metatarso ${setback.min}–${setback.max} mm À FRENTE do eixo do pedal, com o sapato nivelado; e manter o eixo do pedal mais de 10 mm atrás do 1º metatarso. Mexer o travessão para trás encurta o alcance ao pedal: reavaliar a altura do selim depois.`
          : 'Tamanho fora das faixas publicadas: medir o recuo do travessão diretamente no sapato.',
        source: 'Steve Hogg / MyVeloFit (prática de fit)',
      });
    }

    if (profile.waistCm !== null) {
      notes.push({
        key: 'waist',
        icon: '📏',
        label: `Cintura ${profile.waistCm} cm`,
        text: `Perímetro abdominal à altura do umbigo: contexto antropométrico, não um alvo angular. Em posições agressivas é esta medida que costuma limitar a tolerância ao FECHO DA ANCA — ler em conjunto com o fecho da anca medido às 12h (alvo 50–80°). Nenhum alvo desta análise muda por causa da cintura.`,
        source: 'Antropometria clínica (contexto — sem regra de fit publicada que a converta em ângulo)',
      });
    }

    if (profile.cleatPosition !== null) {
      const cleatLabels = {
        rearward: 'Recuados (Atrás)',
        neutral: 'Neutro (Centro)',
        forward: 'Avançados (Frente)',
      };
      const label = cleatLabels[profile.cleatPosition] || profile.cleatPosition;
      const explanations = {
        rearward:
          'Travessões já recuados: reduzem o momento de alavanca no tendão de Aquiles e encurtam o alcance vertical ao pedal. Se houver extensão persistente do tornozelo, evitar recuar mais e verificar se o selim não está alto.',
        neutral:
          'Travessões em posição neutra: calha com margem bilateral para avanço ou recuo em ajustes finos (2–5 mm).',
        forward:
          'Travessões avançados: aumentam o braço de alavanca e a solicitação dos gémeos. Em caso de sobrecarga ou calcanhar descaído, considerar recuo dos travessões.',
      };
      notes.push({
        key: 'cleatPosition',
        icon: '⚙️',
        label: `Posição dos travessões: ${label}`,
        text: explanations[profile.cleatPosition] || `Travessões registados em posição ${label}.`,
        source: 'Steve Hogg / MyVeloFit (biomecânica de cleats)',
      });
    }

    const saddle = this.saddleHeightFromInseam(profile);
    if (saddle) {
      notes.push({
        key: 'leMond',
        icon: '📏',
        label: 'Altura de selim por fórmula',
        text: `Método LeMond (costura interior × 0,883) ⇒ ≈ ${saddle.cm} cm do centro do eixo do pedal ao topo do selim.${
          saddle.estimatedFromHeight
            ? ' ATENÇÃO: a costura foi estimada a partir da altura (≈ 0,47 × altura) — usar apenas como ponto de partida e preferir medir a costura.'
            : ''
        } Fórmula é estimativa inicial, não substitui a medição angular em pedalada.`,
        source: 'LeMond / Cycling Weekly',
      });
    } else if (profile.heightCm === null && profile.inseamCm === null) {
      notes.push({
        key: 'leMondMissing',
        icon: '📏',
        label: 'Altura de selim por fórmula',
        text: 'Não calculada: sem costura interior (nem altura) não há estimativa por fórmula. A análise angular do vídeo não é afetada.',
        source: '—',
      });
    }

    return notes;
  }

  /** Linha curta do perfil para cabeçalhos/relatórios exportados. */
  static formatLine(raw = {}) {
    const profile = this.normalize(raw);
    const parts = [];
    if (profile.weightKg !== null) parts.push(`${profile.weightKg} kg`);
    if (profile.shoeSizeEu !== null) parts.push(`sapato ${profile.shoeSizeEu} EU`);
    if (profile.waistCm !== null) parts.push(`cintura ${profile.waistCm} cm`);
    if (profile.heightCm !== null) parts.push(`${profile.heightCm} cm`);
    if (profile.inseamCm !== null) parts.push(`costura ${profile.inseamCm} cm`);
    if (profile.cleatPosition !== null) parts.push(`cleats ${profile.cleatPosition}`);
    return parts.length ? parts.join(' | ') : 'Perfil não preenchido';
  }

  /** Nomes legíveis dos campos obrigatórios em falta. */
  static missingLabels(missingRequired = []) {
    const labels = { weightKg: 'peso', shoeSizeEu: 'número de sapato' };
    return missingRequired.map((key) => labels[key] || key);
  }
}

export default AthleteProfile;
