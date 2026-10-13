/**
 * Rastreio da Dinâmica do Pé — a órbita que o pé desenha ao rodar a roda pedaleira
 * (FootOrbitTrace) e a POSIÇÃO do pé na pedaleira ao longo dessa órbita.
 *
 * PORQUÊ:
 * Cada pedalada completa faz o pé (tornozelo) percorrer um circuito fechado. Ver esse circuito
 * desenhado sobre o vídeo diz de imediato o que nenhum valor instantâneo diz: se o pé sobe e
 * desce na mesma vertical, se a volta é uma elipse torta, para que sentido é que o atleta pedala
 * e qual o diâmetro do círculo que o pé descreve (≈ o diâmetro útil do movimento).
 *
 * A POSIÇÃO NA PEDALEIRA sai da rotação do próprio movimento: o ponto mais alto da órbita é as
 * 12h, o mais baixo as 6h, e os dois intermédios as 3h e as 9h. A conversão para graus é feita
 * pelo `CrankPhaseTracker` (convenção única de toda a aplicação: 0° = 12h, sentido crescente
 * 12h → 3h → 6h → 9h), pelo que a hora mostrada aqui e a posição medida na análise integral
 * não podem divergir.
 *
 * ATENÇÃO À DIREÇÃO DO FILME: quando o atleta está virado para a ESQUERDA da imagem, a 3h (pé à
 * frente, fase de potência) cai no lado esquerdo do ecrã e a 9h no direito. O "espelhamento" é
 * detetado pelo sentido de rotação do pé (o mesmo critério do `CrankPhaseTracker`), pelo que as
 * horas desenhadas seguem a pedaleira real e nunca trocam quando o vídeo é filmado do outro lado.
 *
 * As amostras vêm do varrimento integral do vídeo (uma observação por instante amostrado) e são
 * guardadas em coordenadas NORMALIZADAS (0–1) do fotograma, para a órbita poder ser redesenhada em
 * qualquer resolução do canvas.
 *
 * O módulo é puro (sem DOM nem Vue): desenha com o contexto 2D que lhe for dado, pelo que pode ser
 * verificado fora do navegador (`npm run verify:full-analysis`).
 */
import { CrankPhaseTracker, angularDistance } from './crankPhaseTracker.js';
import { CARDINAL_PHASE_DEG, CRANK_POSITION_RULES, DEFAULT_PHASE_WINDOW_DEG } from './crankPositionRules.js';

/** Hora curta de cada posição cardeal (a mesma nomenclatura da análise). */
export const CARDINAL_HOURS = { tdc: '12h', '90deg': '3h', bdc: '6h', '270deg': '9h' };
/** Posições cardeais por ordem da pedalada: 12h → 3h → 6h → 9h. */
export const CARDINAL_KEYS = ['tdc', '90deg', 'bdc', '270deg'];

/** Pontos máximos guardados (uma análise longa não pode crescer sem fim). */
export const MAX_ORBIT_POINTS = 2000;
/** Pontos mínimos para a órbita ser considerada desenhável. */
export const MIN_ORBIT_POINTS = 8;
/** Pontos máximos desenhados (subamostragem uniforme: a forma do circuito mantém-se). */
export const MAX_DRAWN_POINTS = 400;
/** Resíduo máximo (em fração do raio) para o circuito ser considerado circular. */
export const CIRCULARITY_TOLERANCE = 0.35;

/**
 * Área com sinal do polígono (fórmula do cadarço/shoelace) em coordenadas de ecrã (y para baixo).
 *
 * Em coordenadas de ecrã o sinal positivo corresponde ao sentido **horário** (direita → baixo →
 * esquerda → cima). Numa órbita de várias voltas cada volta contribui com o mesmo sinal, pelo que
 * o sinal do total é o sentido de rotação do pé.
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {number} área com sinal (unidades ao quadrado)
 */
export function signedArea(points = []) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Sentido de rotação a partir da ordem temporal dos pontos.
 * @param {Array<{x:number,y:number}>} points - pontos por ordem de tempo
 * @returns {'cw'|'ccw'|null} `cw` = horário (ecrã), `ccw` = anti-horário, `null` se não for possível
 */
export function directionOf(points = []) {
  if (points.length < 3) return null;
  const area = signedArea(points);
  // Uma órbita praticamente degenerada (linha) não tem sentido de rotação defensável.
  if (Math.abs(area) < 1e-9) return null;
  return area > 0 ? 'cw' : 'ccw';
}

/**
 * Voltas acumuladas: soma do ângulo percorrido em torno do centro da órbita, dividida por 360°.
 *
 * Não depende do tempo nem da cadência (que a análise já mede em separado): mede só quantas voltas
 * a sequência de pontos deu, o que continua correto mesmo com amostragem irregular.
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {number} número de voltas (ex.: 3.4)
 */
export function turnsOf(points = []) {
  if (points.length < 3) return 0;
  let sx = 0;
  let sy = 0;
  points.forEach((p) => {
    sx += p.x;
    sy += p.y;
  });
  const cx = sx / points.length;
  const cy = sy / points.length;

  let previous = null;
  let travelled = 0;
  points.forEach((p) => {
    const angle = Math.atan2(p.y - cy, p.x - cx);
    if (previous !== null) {
      let delta = angle - previous;
      // Escolher sempre o passo mais curto evita saltos de 2π quando o ângulo cruza ±π.
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      travelled += delta;
    }
    previous = angle;
  });
  return Math.abs(travelled) / (2 * Math.PI);
}

/**
 * Ajuste algébrico de um círculo (Kasa/least squares) a um conjunto de pontos.
 *
 * É o que transforma "o pé anda às voltas" num número: o **diâmetro** do circuito e o **resíduo**
 * (quanto o percurso se afasta do círculo). Um resíduo alto é reportado como tal — não se finge
 * que a órbita é um círculo perfeito.
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {{cx:number, cy:number, r:number, residual:number}|null} resíduo em fração do raio
 */
export function fitCircle(points = []) {
  if (points.length < 3) return null;

  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sz = 0;
  let sxz = 0;
  let syz = 0;

  points.forEach((p) => {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sz += z;
    sxz += p.x * z;
    syz += p.y * z;
  });

  // Sistema linear do ajuste algébrico (Kasa): x² + y² = A·x + B·y + C.
  const matrix = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const vector = [sxz, syz, sz];
  const determinant =
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) return null;

  /** Substituição de Cramer para a incógnita `column`. */
  const solve = (column) => {
    const m = matrix.map((row) => row.slice());
    for (let row = 0; row < 3; row++) m[row][column] = vector[row];
    const local =
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    return local / determinant;
  };

  const a = solve(0) / 2;
  const b = solve(1) / 2;
  const c = solve(2);
  const r2 = c + a * a + b * b;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(r2) || r2 <= 0) return null;

  const r = Math.sqrt(r2);
  let sumSq = 0;
  points.forEach((p) => {
    const d = Math.hypot(p.x - a, p.y - b) - r;
    sumSq += d * d;
  });
  const residual = Math.sqrt(sumSq / n) / r;
  return { cx: a, cy: b, r, residual };
}

export class FootOrbitTrace {
  /** @param {{ maxPoints?: number }} [options] */
  constructor({ maxPoints = MAX_ORBIT_POINTS } = {}) {
    this.maxPoints = maxPoints;
    this.reset();
  }

  /** Esquece a órbita (novo vídeo, nova análise). */
  reset() {
    this._points = [];
    this.frame = null;
    this._phaseModel = null;
  }

  /**
   * Guarda um ponto da órbita em coordenadas normalizadas (0–1) do fotograma.
   * @param {number} time - instante do vídeo (s)
   * @param {number} x - 0–1 (esquerda → direita)
   * @param {number} y - 0–1 (topo → fundo)
   */
  addPoint(time, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (this._points.length >= this.maxPoints) this._points.shift();
    this._points.push({ time: Number(time) || 0, x, y });
    // A fase depende do conjunto todo (caixa da órbita e sentido): deixa de valer a cada ponto.
    this._phaseModel = null;
    return true;
  }

  /**
   * Guarda uma observação do varrimento (ponto do tornozelo em píxeis + resolução do fotograma).
   * @param {{ time:number, ankle?:{x:number,y:number} }} observation
   * @param {{ width:number, height:number }} [frame]
   */
  addObservation(observation = {}, frame = null) {
    const ankle = observation.ankle;
    if (!ankle || !Number.isFinite(ankle.x) || !Number.isFinite(ankle.y)) return false;
    const width = frame?.width || observation.frameWidth || 0;
    const height = frame?.height || observation.frameHeight || 0;
    if (!width || !height) return false;
    if (!this.frame) this.frame = { width, height };
    return this.addPoint(observation.time, ankle.x / width, ankle.y / height);
  }

  /** Pontos por ordem de inserção (que é a ordem temporal do varrimento). */
  get points() {
    return this._points.slice();
  }

  get length() {
    return this._points.length;
  }

  /** Há pontos suficientes para desenhar uma órbita? */
  get isDrawable() {
    return this._points.length >= MIN_ORBIT_POINTS;
  }

  /** Caixa envolvente em coordenadas normalizadas (largura × altura do movimento). */
  bounds() {
    if (!this._points.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    this._points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  /** Sentido de rotação do pé (`cw`/`ccw`) ou `null` se não for defensável. */
  direction() {
    return directionOf(this._points);
  }

  /** Voltas acumuladas. */
  turns() {
    return turnsOf(this._points);
  }

  /**
   * Círculo ajustado no espaço NORMALIZADO (ou `null`). Só é usado quando a resolução do
   * fotograma não é conhecida; com resolução, `circlePixels()` é a resposta correta.
   */
  circle() {
    return fitCircle(this._points);
  }

  /**
   * Círculo ajustado em PÍXEIS do fotograma (centro e raio), ou `null` sem resolução conhecida.
   *
   * O ajuste é feito em píxeis, e não em coordenadas normalizadas: com um fotograma 16:9 os
   * eixos têm escalas diferentes e um círculo de píxeis transformar-se-ia numa elipse — o raio
   * sairia errado (e o desenho não corresponderia ao ajuste).
   *
   * @param {{ residual?: boolean }} [options]
   */
  circlePixels() {
    if (!this.frame || !this.frame.width || !this.frame.height) return null;
    const px = this._points.map((p) => ({ x: p.x * this.frame.width, y: p.y * this.frame.height }));
    return fitCircle(px);
  }

  /**
   * Modelo da fase da pedaleira: caixa da órbita, sentido (espelhado) e fase de cada amostra.
   *
   * Reutiliza o `CrankPhaseTracker` (mesma convenção da análise integral): a fase é medida em
   * coordenadas normalizadas PELA CAIXA DA ÓRBITA, o que equivale a normalizar pela elipse quando
   * a câmara não está perfeitamente de perfil; se a fase correr no sentido negativo, o atleta está
   * virado para a esquerda e a fase é espelhada (3h ↔ 9h).
   *
   * ATENÇÃO À ESCALA: as amostras da órbita estão NORMALIZADAS (0–1), mas a caixa de órbita do
   * `CrankPhaseTracker` tem um mínimo de 0,5 PÍXEIS (evita dividir por zero em órbitas de ruído).
   * Em unidades normalizadas esse mínimo vale meia imagem e achatava TODOS os ângulos — a fase
   * deixava de rodar com o pé (45° de movimento liam-se 26°, por exemplo). Por isso as amostras
   * são levadas a píxeis antes de entrar no tracker. A fase é invariante a escalas por eixo
   * (o tracker divide pela meia-caixa), pelo que sem resolução conhecida basta uma moldura
   * sintética quadrada:
   * a hora lida não depende dela.
   *
   * O resultado é guardado em cache (uma análise chega a ter centenas de amostras e o desenho
   * corre a cada quadro).
   *
   * @returns {{bounds:Object, box:Object, mirrored:boolean, phases:number[], observations:Array}|null}
   */
  phaseModel() {
    if (!this.isDrawable) return null;
    if (this._phaseModel) return this._phaseModel;

    // Moldura de trabalho: a real, quando é conhecida; quadrada sintética caso contrário (a fase
    // é invariante à escala, o que interessa é que a caixa deixe de ser achatada pelo mínimo).
    const frame = this.frame?.width && this.frame?.height ? this.frame : { width: 1000, height: 1000 };
    const observations = this._points.map((p) => ({
      time: p.time,
      ankle: { x: p.x * frame.width, y: p.y * frame.height },
    }));
    const bounds = CrankPhaseTracker.computeOrbitBounds(observations);
    if (!bounds) return null;

    const raw = observations.map((obs) => CrankPhaseTracker.phaseAt(obs.ankle, bounds));
    // Sentido de rotação pela soma dos deltas de arco curto (mesmo critério do tracker).
    let signedSum = 0;
    for (let i = 1; i < raw.length; i++) {
      signedSum += ((raw[i] - raw[i - 1] + 540) % 360) - 180;
    }
    const mirrored = signedSum < 0;
    const phases = mirrored ? raw.map((phase) => (360 - phase) % 360) : raw;

    // `bounds` (píxeis, do tracker) serve o cálculo da fase; `box` (normalizado, medido aqui, sem
    // mínimo nenhum) é a geometria que o DESENHO usa para colocar as horas na órbita.
    this._phaseModel = { bounds, box: this.bounds(), mirrored, phases, observations };
    return this._phaseModel;
  }

  /**
   * Posição do pé na pedaleira num instante do vídeo.
   *
   * A amostra mais próxima desse instante é convertida em graus de fase (0° = 12h) e comparada
   * com as quatro posições cardeais: devolve a mais próxima, a distância angular e se cai dentro
   * da janela de tolerância (a fase é estimada por vídeo — exigir o grau exato seria falsa
   * precisão).
   *
   * @param {number} time - instante do vídeo (s)
   * @param {{ windowDeg?:number }} [options]
   * @returns {{ time:number, x:number, y:number, phaseDeg:number, key:string, hour:string,
   *            label:string, footPositionPt:string, deltaDeg:number, atCardinal:boolean,
   *            mirrored:boolean }|null}
   */
  positionAt(time, { windowDeg = DEFAULT_PHASE_WINDOW_DEG } = {}) {
    const model = this.phaseModel();
    if (!model || !this._points.length) return null;

    let index = 0;
    let bestDelta = Infinity;
    this._points.forEach((p, i) => {
      const delta = Math.abs(p.time - (Number(time) || 0));
      if (delta < bestDelta) {
        bestDelta = delta;
        index = i;
      }
    });

    const point = this._points[index];
    const phaseDeg = model.phases[index];
    let nearestKey = CARDINAL_KEYS[0];
    let smallest = Infinity;
    CARDINAL_KEYS.forEach((key) => {
      const distance = angularDistance(phaseDeg, CARDINAL_PHASE_DEG[key]);
      if (distance < smallest) {
        smallest = distance;
        nearestKey = key;
      }
    });
    const rule = CRANK_POSITION_RULES[nearestKey];

    return {
      time: point.time,
      x: point.x,
      y: point.y,
      phaseDeg: Math.round(phaseDeg * 10) / 10,
      key: nearestKey,
      hour: CARDINAL_HOURS[nearestKey],
      label: rule.label,
      footPositionPt: rule.footPositionPt,
      deltaDeg: Math.round(smallest * 10) / 10,
      atCardinal: smallest <= windowDeg,
      mirrored: model.mirrored,
    };
  }

  /**
   * As quatro posições cardeais marcadas na órbita (o que o utilizador lê sobre o vídeo).
   *
   * As 12h e as 6h são sempre o topo e o fundo da órbita; as 3h/9h trocam de lado quando o atleta
   * está virado para a esquerda (a 3h é o pé à frente, não "o lado direito do ecrã"):
   * com o pé a subir à direita do ecrã a pedalada é horária e a 3h fica à direita.
   *
   * @returns {Array<{key:string, hour:string, phaseDeg:number, x:number, y:number}>}
   */
  cardinalMarks() {
    const model = this.phaseModel();
    const box = model?.box;
    if (!box) return [];
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const halfSize = { x: (box.maxX - box.minX) / 2, y: (box.maxY - box.minY) / 2 };
    const side = model.mirrored ? -1 : 1;
    return [
      { key: 'tdc', hour: CARDINAL_HOURS.tdc, phaseDeg: 0, x: center.x, y: center.y - halfSize.y },
      { key: '90deg', hour: CARDINAL_HOURS['90deg'], phaseDeg: 90, x: center.x + side * halfSize.x, y: center.y },
      { key: 'bdc', hour: CARDINAL_HOURS.bdc, phaseDeg: 180, x: center.x, y: center.y + halfSize.y },
      { key: '270deg', hour: CARDINAL_HOURS['270deg'], phaseDeg: 270, x: center.x - side * halfSize.x, y: center.y },
    ];
  }

  /** Ponto da órbita mais próximo de um instante do vídeo (para o marcador em reprodução). */
  nearestTo(time) {
    if (!this._points.length || !Number.isFinite(time)) return null;
    let best = this._points[0];
    let bestDelta = Math.abs(best.time - time);
    this._points.forEach((p) => {
      const delta = Math.abs(p.time - time);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = p;
      }
    });
    return { ...best, delta: bestDelta };
  }

  /**
   * Resumo honesto da dinâmica do pé. Sem pontos suficientes devolve `null` (nada é inventado) e
   * sem círculo ajustável reporta apenas o que a caixa envolvente permite afirmar.
   * @returns {{samples:number, turns:number, direction:string|null, diameterPx:number|null,
   *            diameterMm:number|null, travelPx:{width:number,height:number}|null,
   *            circularity:number|null, isCircular:boolean}}
   */
  summary({ pixelsPerMm = null } = {}) {
    // Menos de `MIN_ORBIT_POINTS` pontos não é uma órbita: não se reporta meia volta inventada.
    if (!this.isDrawable) return null;
    const box = this.bounds();
    // O círculo é medido em píxeis; sem resolução conhecida fica `null` (não se adivinha).
    const circle = this.circlePixels();
    const frame = this.frame;
    const travelPx = frame
      ? { width: box.width * frame.width, height: box.height * frame.height }
      : null;
    const diameterPx = circle ? circle.r * 2 : null;
    return {
      samples: this._points.length,
      turns: Math.round(this.turns() * 10) / 10,
      direction: this.direction(),
      diameterPx: diameterPx !== null ? Math.round(diameterPx) : null,
      diameterMm:
        diameterPx !== null && pixelsPerMm > 0 ? Math.round((diameterPx / pixelsPerMm) * 10) / 10 : null,
      travelPx: travelPx
        ? { width: Math.round(travelPx.width), height: Math.round(travelPx.height) }
        : null,
      circularity: circle ? Math.round(circle.residual * 100) / 100 : null,
      isCircular: Boolean(circle && circle.residual <= CIRCULARITY_TOLERANCE),
      // Direção do filme: uma pedalada vista do lado direito do ecrã é horária; do outro lado, a
      // 3h (pé à frente) cai no lado esquerdo e as horas desenhadas acompanham essa troca.
      facing: this.phaseModel() ? (this.phaseModel().mirrored ? 'left' : 'right') : null,
    };
  }

  /**
   * Constrói uma órbita a partir das observações do varrimento integral (por ordem temporal).
   * @param {Array} observations
   * @param {{ frame?:{width:number,height:number}, maxPoints?:number }} [options]
   */
  static fromObservations(observations = [], { frame = null, maxPoints = MAX_ORBIT_POINTS } = {}) {
    const trace = new FootOrbitTrace({ maxPoints });
    const ordered = observations
      .filter((o) => o && Number.isFinite(o.time) && o.ankle)
      .slice()
      .sort((a, b) => a.time - b.time);
    ordered.forEach((o) => trace.addObservation(o, frame));
    return trace;
  }
}

/** Subamostragem uniforme de pontos (a forma do circuito mantém-se, o desenho fica leve). */
export function subsample(points = [], maxPoints = MAX_DRAWN_POINTS) {
  if (points.length <= maxPoints) return points;
  const stride = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[Math.floor(i)]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Desenha a órbita do pé no contexto indicado (píxeis do fotograma).
 *
 * O rasto é uma LINHA FINA desenhada como a lápis: cada pedalada é traçada como uma passagem
 * própria e translúcida, pelo que as voltas repetidas se sobrepõem e o traço ganha corpo onde o pé
 * passou mais vezes (é o que o utilizador pediu: um círculo desenhado múltiplas vezes).
 * Desenha também as horas da pedaleira (12h em cima, 6h em baixo, 3h/9h nos intermédios), o
 * círculo ajustado e o marcador do instante em reprodução com a posição do pé.
 *
 * As coordenadas guardadas são normalizadas, pelo que o desenho serve qualquer resolução.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FootOrbitTrace|{points:Array}} trace
 * @param {{ width:number, height:number, currentTime?:number|null, color?:string,
 *           colorSoft?:string, showCircle?:boolean, showHours?:boolean, scale?:number,
 *           alpha?:number, currentLabel?:string }} options
 * @returns {number} número de pontos desenhados (0 = nada desenhado)
 */
export function drawFootOrbit(ctx, trace, options = {}) {
  const points = (trace?.points || []).slice();
  if (!ctx || points.length < MIN_ORBIT_POINTS) return 0;
  const width = options.width || 0;
  const height = options.height || 0;
  if (width <= 0 || height <= 0) return 0;

  const scale = options.scale || Math.max(1, Math.min(3.5, Math.max(width, height) / 720));
  const color = options.color || '#00d2ff';
  const colorSoft = options.colorSoft || 'rgba(0, 210, 255, 0.65)';
  const shade = options.shade || 'rgba(2, 6, 23, 0.65)';
  const alpha = typeof options.alpha === 'number' ? options.alpha : 0.85;
  const lineWidth = Math.max(1.1, Math.min(2.2, 1.45 * scale));
  const drawn = subsample(points, MAX_DRAWN_POINTS);
  const laps = Math.max(1, Math.round(typeof trace.turns === 'function' ? trace.turns() : 1));
  const chunk = Math.max(2, Math.ceil(drawn.length / laps));

  /**
   * Traça o rasto do circuito completo do pé. As passagens sobrepõem-se com traço azul elétrico nítido,
   * permitindo ver o circuito percorrido pelo pé em todo o seu percurso a 360°.
   */
  const strokeLaps = ({ strokeStyle, width: strokeWidth, alpha: strokeAlpha }) => {
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = strokeWidth;
    for (let start = 0; start < drawn.length - 1; start += chunk) {
      // Uma amostra de sobreposição liga cada passagem à seguinte (não fica corte na linha).
      const slice = drawn.slice(start, Math.min(drawn.length, start + chunk + 1));
      ctx.beginPath();
      slice.forEach((p, i) => {
        const x = p.x * width;
        const y = p.y * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1a. Sombra/contraste escuro por baixo: mantém o desenho bem destacado sobre qualquer fundo.
  strokeLaps({ strokeStyle: shade, width: Math.min(3.0, lineWidth + Math.max(0.4, 0.5 * scale)), alpha: 1 });

  // 1b. O traço azul vibrante contínuo de todo o circuito (o utilizador vê a linha azul nítida).
  strokeLaps({ strokeStyle: color, width: lineWidth, alpha });

  // 2. Círculo ajustado + centro: é aqui que se vê se a volta é redonda e de que tamanho é.
  // O ajuste é feito em píxeis do fotograma e depois escalado para o canvas do desenho.
  const frame = trace?.frame;
  const scaleX = frame?.width ? width / frame.width : width;
  const scaleY = frame?.height ? height / frame.height : height;
  const circle = frame?.width && frame?.height ? fitCircle(points.map((p) => ({ x: p.x * frame.width, y: p.y * frame.height }))) : null;
  if (circle && options.showCircle !== false) {
    const radius = frame?.width ? circle.r * scaleX : circle.r * width;
    const circleX = frame?.width ? circle.cx * scaleX : circle.cx * width;
    const circleY = frame?.height ? circle.cy * scaleY : circle.cy * height;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.strokeStyle = colorSoft;
    ctx.lineWidth = Math.max(0.8, 0.9 * scale);
    ctx.arc(circleX, circleY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    const half = Math.max(3, 5 * scale);
    ctx.moveTo(circleX - half, circleY);
    ctx.lineTo(circleX + half, circleY);
    ctx.moveTo(circleX, circleY - half);
    ctx.lineTo(circleX, circleY + half);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 2b. As quatro horas da pedaleira, marcadas na própria órbita (12h em cima, 6h em baixo e os
  //     intermédios 3h/9h): é o que permite ler a posição do pé sobre o vídeo.
  const marks = typeof trace.cardinalMarks === 'function' ? trace.cardinalMarks() : [];
  const model = typeof trace.phaseModel === 'function' ? trace.phaseModel() : null;
  if (marks.length && model?.box && options.showHours !== false) {
    const centerX = ((model.box.minX + model.box.maxX) / 2) * width;
    const centerY = ((model.box.minY + model.box.maxY) / 2) * height;
    ctx.font = `bold ${Math.round(11 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    marks.forEach((mark) => {
      const mx = mark.x * width;
      const my = mark.y * height;
      const dx = mx - centerX;
      const dy = my - centerY;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const tick = Math.max(3, 4.5 * scale);
      // Traço perpendicular à órbita (marca o ponto) + a hora escrita por fora.
      ctx.beginPath();
      ctx.strokeStyle = colorSoft;
      ctx.lineWidth = Math.max(1, 1.3 * scale);
      ctx.moveTo(mx - uy * tick, my + ux * tick);
      ctx.lineTo(mx + uy * tick, my - ux * tick);
      ctx.stroke();

      const labelX = mx + ux * (tick + Math.max(10, 14 * scale));
      const labelY = my + uy * (tick + Math.max(10, 14 * scale));
      ctx.fillStyle = shade;
      ctx.fillText(mark.hour, labelX + 1, labelY + 1);
      ctx.fillStyle = color;
      ctx.fillText(mark.hour, labelX, labelY);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 3. Marcador do instante em reprodução: mostra a dinâmica (o pé a andar na órbita).
  const current = Number.isFinite(options.currentTime) ? trace.nearestTo(options.currentTime) : null;
  if (current) {
    const x = current.x * width;
    const y = current.y * height;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, Math.max(3, 6 * scale), 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.arc(x, y, Math.max(6, 12 * scale), 0, 2 * Math.PI);
    ctx.stroke();
    if (options.currentLabel) {
      ctx.font = `bold ${Math.round(11 * scale)}px monospace`;
      ctx.fillStyle = color;
      ctx.fillText(options.currentLabel, x + Math.max(10, 16 * scale), y - Math.max(6, 10 * scale));
    }
  }

  ctx.restore();
  return drawn.length;
}

export default FootOrbitTrace;
