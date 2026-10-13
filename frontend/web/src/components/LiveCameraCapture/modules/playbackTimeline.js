/**
 * Lógica pura da linha temporal do vídeo (PlaybackTimeline).
 *
 * Este módulo NÃO toca no DOM: concentra as regras de tempo (leitura/escrita em
 * `mm:ss.d`, validação do intervalo A-B e decisão de fronteiras do loop), para
 * poder ser verificado automaticamente com `npm run verify:playback`.
 *
 * Regras de desenho:
 * - O intervalo A-B é sempre normalizado para `0 <= A < B <= duração`.
 * - Um intervalo válido tem no mínimo 0.2s (abaixo disso o loop seria ruído).
 * - Se o utilizador escrever A e B trocados, são trocados automaticamente.
 */

/** Duração mínima aceitável para um intervalo A-B (segundos). */
export const MIN_LOOP_SPAN = 0.2;

/** Relógio legível: `mm:ss.d` (ou `h:mm:ss.d` em vídeos longos). */
export function formatTimecode(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const tenths = Math.floor((total * 10) % 10);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}.${tenths}`;
}

/**
 * Aceita segundos puros ("20", "45.5"), `m:ss` ("1:20") ou `h:mm:ss`
 * ("01:02:03.4"). Devolve `null` se não for interpretável.
 */
export function parseTimecode(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== 'string') return null;

  const raw = input.trim().replace(',', '.');
  if (!raw) return null;

  // `m:ss.d` ou `h:mm:ss.d`
  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length > 3) return null;
    // `:` sozinho (ou `::`) não é um tempo: devolve `null` em vez de 0.
    if (parts.every((part) => part.trim() === '')) return null;
    let total = 0;
    for (const part of parts) {
      const value = part.trim() === '' ? 0 : Number(part);
      if (!Number.isFinite(value)) return null;
      total = total * 60 + value;
    }
    return total;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Converte um texto de tempo em segundos válidos dentro de `[0, duration]`. */
export function normalizeTime(input, duration) {
  const parsed = parseTimecode(input);
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  if (parsed === null) return null;
  return Math.max(0, Math.min(parsed, max));
}

/**
 * Normaliza um par A-B. Nunca devolve um intervalo degenerado e nunca falha:
 * em caso de dados inválidos devolve o vídeo completo.
 */
export function clampRange(start, end, duration, minSpan = MIN_LOOP_SPAN) {
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (!max) return { start: 0, end: 0, valid: false };

  let a = parseTimecode(start);
  let b = parseTimecode(end);

  if (a === null && b === null) return { start: 0, end: max, valid: false };
  if (a === null) a = 0;
  if (b === null) b = max;

  // A e B trocados => troca automática (o utilizador queria o intervalo, não um erro).
  if (b < a) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  a = Math.max(0, Math.min(a, max));
  b = Math.max(0, Math.min(b, max));

  if (b - a < minSpan) {
    // Garante o mínimo: encosta B ao fim se houver espaço, senão recua A.
    if (a + minSpan <= max) {
      b = a + minSpan;
    } else {
      a = Math.max(0, max - minSpan);
      b = max;
    }
  }

  return { start: a, end: b, valid: true };
}

/** Percentagem (0-100) de um instante dentro da duração. */
export function percentOf(time, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const pct = ((Number(time) || 0) / duration) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Geometria da região A-B para o CSS (percentagens). */
export function loopRegionPercent(range, duration) {
  if (!range || !(range.end > range.start) || !Number.isFinite(duration) || duration <= 0) {
    return { left: 0, width: 100 };
  }
  const left = percentOf(range.start, duration);
  const right = percentOf(range.end, duration);
  return { left, width: Math.max(0, right - left) };
}

/** Converte um instante em segundos válidos dentro de `[0, duration]`. */
export function clampTime(time, duration) {
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const value = Number(time);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, max));
}

/** Relógio de régua: `mm:ss` (ou `h:mm:ss`), sem décimas — texto curto para as marcações. */
export function formatRulerTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Marcações da régua temporal: passos "bonitos" (5s, 10s, 30s, 1min, 2min...) sem
 * nunca ultrapassar `maxTicks`. É esta régua que dá as zonas temporais clicáveis.
 * @returns {Array<{time:number, percent:number, label:string, major:boolean}>}
 */
export function buildTimeTicks(duration, { maxTicks = 12, minStep = 1 } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  let step = nice[nice.length - 1];
  for (const candidate of nice) {
    if (duration / candidate <= maxTicks) {
      step = candidate;
      break;
    }
  }
  step = Math.max(step, minStep);

  const ticks = [];
  for (let time = 0; time <= duration + 1e-6; time += step) {
    ticks.push({
      time: Math.min(time, duration),
      percent: percentOf(time, duration),
      label: formatRulerTime(time),
      major: step >= 60,
    });
  }
  // A última marca fecha a régua na duração real do vídeo (evita um vazio no fim).
  const last = ticks[ticks.length - 1];
  if (!last || Math.abs(last.time - duration) > 1e-6) {
    ticks.push({ time: duration, percent: 100, label: formatRulerTime(duration), major: step >= 60 });
  }
  return ticks;
}

/** Limite de movimento (px) a partir do qual um clique na barra passa a ser um arrasto de intervalo. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Resolve um CLIQUE simples na barra ao estilo de um leitor de vídeo (VLC):
 *  - 1.º clique  => fixa o ponto A e deixa a marca pendente (a reprodução salta para lá);
 *  - 2.º clique  => fixa o ponto B e FECHA o intervalo (a reprodução passa a andar só dentro dele);
 *  - clique seguinte, com o intervalo já fechado => recomeça (novo A).
 *
 * É uma função pura para poder ser verificada em `npm run verify:playback`.
 * @returns {{mode:'none'}|{mode:'pending', start:number, seekTo:number}|{mode:'loop', range:{start:number,end:number,enabled:boolean}, seekTo:number}}
 */
export function resolveTimelineClick({ time, duration, pendingStart = null, minSpan = MIN_LOOP_SPAN }) {
  if (!Number.isFinite(duration) || duration <= 0) return { mode: 'none' };
  const at = clampTime(time, duration);
  if (!Number.isFinite(pendingStart)) {
    return { mode: 'pending', start: at, seekTo: at };
  }
  const range = clampRange(pendingStart, at, duration, minSpan);
  if (!range.valid) return { mode: 'pending', start: at, seekTo: at };
  // `valid` acompanha o intervalo: quem o aplica (o painel) valida-o antes de mexer no motor.
  return { mode: 'loop', range: { start: range.start, end: range.end, enabled: true, valid: true }, seekTo: range.start };
}

/**
 * Decide o que um gesto na barra temporal significa:
 *  - sem movimento  => salto simples para esse instante (comportamento clássico);
 *  - com arrasto    => intervalo A-B com DOIS pontos (início e fim escolhidos na barra).
 */
export function resolveTimelineDrag({
  startTime,
  endTime,
  duration,
  movedPx = 0,
  thresholdPx = DRAG_THRESHOLD_PX,
}) {
  if (!Number.isFinite(duration) || duration <= 0) return { mode: 'none' };
  const moved = Math.abs(Number(movedPx) || 0) >= thresholdPx;
  if (!moved) return { mode: 'seek', seekTo: clampTime(startTime, duration) };
  return { mode: 'loop', range: clampRange(startTime, endTime, duration) };
}

/**
 * Limites efetivos da reprodução: o intervalo A-B quando ativo, senão o vídeo inteiro.
 */
export function playbackBounds({ loopEnabled, loopStart, loopEnd, duration }) {
  const full = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (loopEnabled && loopEnd > loopStart) {
    return { start: loopStart, end: loopEnd, scoped: true };
  }
  return { start: 0, end: full, scoped: false };
}

/**
 * Decide o que fazer no sentido NORMAL ao chegar ao fim do âmbito de reprodução.
 * Devolve `null` (nada a fazer), `{ seekTo }` (loop infinito) ou `{ stop: true }`.
 */
export function resolveForwardBoundary({
  currentTime,
  duration,
  loopEnabled = false,
  loopStart = 0,
  loopEnd = 0,
  infiniteLoop = true,
  guard = 0.05,
}) {
  const bounds = playbackBounds({ loopEnabled, loopStart, loopEnd, duration });
  if (!bounds.end) return null;

  const atEnd = currentTime >= bounds.end - guard;
  if (!atEnd) return null;

  if (!infiniteLoop) {
    return { stop: true, seekTo: bounds.end };
  }
  return { seekTo: bounds.start };
}

/**
 * Decide o alvo da marcha-atrás depois de recuar `advance` segundos.
 * Passo adaptativo: se o acumulador for maior que um fotograma, salta fotogramas
 * (rebobinar) em vez de acumular atraso. `maxStep` limita saltos absurdos.
 */
export function resolveReverseTarget({
  currentTime,
  advance,
  duration,
  loopEnabled = false,
  loopStart = 0,
  loopEnd = 0,
  infiniteLoop = true,
  frameStep = 1 / 30,
  maxStep = 0.5,
  guard = 0.02,
}) {
  const bounds = playbackBounds({ loopEnabled, loopStart, loopEnd, duration });
  const step = Math.max(frameStep, Math.min(advance, maxStep));
  let target = currentTime - step;
  let wrapped = false;
  // Só há para onde saltar quando o FIM é conhecido. Sem duração (ficheiro ainda não indexado) o
  // âmbito é 0–0: um "loop" para o fim saltaria para 0 e o motor pedia o instante 0 para sempre
  // — imagem parada no início enquanto o painel dizia "a rebobinar".
  const hasKnownEnd = Number.isFinite(bounds.end) && bounds.end > bounds.start;

  if (target <= bounds.start + guard) {
    if (!infiniteLoop || !hasKnownEnd) {
      return { target: bounds.start, wrapped: false, finished: true, step };
    }
    target = bounds.end;
    wrapped = true;
  }

  return { target, wrapped, finished: false, step };
}
