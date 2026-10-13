/**
 * Verificação automática da linha temporal, do Loop A-B por tempo e do
 * motor de marcha-atrás "tipo cassete".
 *
 * Executar com:  npm run verify:playback
 *
 * Não usa navegador: o motor é exercitado contra um elemento <video> simulado,
 * com um relógio de `requestAnimationFrame` controlado, o que torna os testes
 * determinísticos e reproduzíveis.
 *
 * Garante, entre outros:
 *  1. Leitura/escrita de tempo ("20", "20.5", "1:20") e normalização do intervalo A-B.
 *  2. Corte de loop em B com precisão (guarda de 60Hz) no vídeo completo e no intervalo.
 *  3. Marcha-atrás com UM ÚNICO seek em voo de cada vez — a regressão que fazia
 *     o vídeo ficar "parado" (seeks sobrepostos que nunca terminavam).
 *  4. Passo adaptativo (rebobinar saltando fotogramas quando a descodificação é lenta).
 *  5. Wrap A→B na marcha-atrás e loop total 0s↔duração.
 */
import { ReversePlaybackEngine } from '../src/components/LiveCameraCapture/modules/reversePlaybackEngine.js';
import { VideoUploadManager } from '../src/components/LiveCameraCapture/modules/videoUploadManager.js';
import {
  buildTimeTicks,
  clampRange,
  clampTime,
  formatRulerTime,
  formatTimecode,
  loopRegionPercent,
  parseTimecode,
  percentOf,
  playbackBounds,
  resolveForwardBoundary,
  resolveReverseTarget,
  resolveTimelineClick,
  resolveTimelineDrag,
} from '../src/components/LiveCameraCapture/modules/playbackTimeline.js';
import {
  MotionSlowdownDetector,
  kneeAngularSpeed,
} from '../src/components/LiveCameraCapture/modules/motionSlowdown.js';
import {
  POSE_PROFILES,
  PoseLoadTuner,
  inferenceSize,
} from '../src/components/LiveCameraCapture/modules/poseLoadTuner.js';

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

// ---------------------------------------------------------------------------
// Relógio de requestAnimationFrame controlado (testes determinísticos)
// ---------------------------------------------------------------------------
const rafQueue = [];
let rafId = 0;
let fakeNow = typeof performance !== 'undefined' ? performance.now() : 0;

// `global` (e não `globalThis`) por ser o identificador declarado no ambiente
// `node` do ESLint do projeto — este script é exclusivamente Node.
global.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return ++rafId;
};
global.cancelAnimationFrame = (id) => {
  void id;
};

/** Avança o relógio e entrega o tempo aos callbacks de rAF pendentes. */
function stepFrame(ms) {
  fakeNow += ms;
  const queue = rafQueue.splice(0, rafQueue.length);
  queue.forEach((cb) => cb(fakeNow));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa ticks de rAF ao ritmo real (16.67ms), alinhando o relógio falso com o
 * relógio verdadeiro — é assim que se mede a fidelidade da velocidade.
 */
async function runPaced(ticks, tickMs = 16.67) {
  const wallStart = Date.now();
  for (let i = 0; i < ticks; i++) {
    await sleep(tickMs);
    fakeNow = wallStart + (Date.now() - wallStart);
    const queue = rafQueue.splice(0, rafQueue.length);
    queue.forEach((cb) => cb(fakeNow));
  }
}

/**
 * Elemento <video> simulado. Reprovando deliberadamente qualquer seek emitido
 * enquanto outro está em curso: era exatamente isso que congelava a imagem.
 */
function makeVideo(duration, startTime, stats = {}, seekLatencyMs = 0, snapSeconds = 0) {
  const listeners = {};
  stats.seeks = 0;
  stats.overlaps = 0;
  stats.maxSimultaneous = 0;
  const element = {
    duration,
    _t: startTime,
    seeking: false,
    paused: true,
    ended: false,
    playCalls: 0,
    pauseCalls: 0,
    // Como num <video> real: a velocidade arranca a 1x.
    playbackRate: 1,
    play() {
      this.playCalls++;
      this.paused = false;
      this.ended = false;
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls++;
      this.paused = true;
    },
    get currentTime() {
      return this._t;
    },
    set currentTime(value) {
      if (this.seeking) {
        stats.overlaps++;
        throw new Error('seek sobreposto: o motor não esperou pelo fotograma anterior');
      }
      this._t = Math.max(0, Math.min(value, duration));
      // `snapSeconds` simula vídeos com fotogramas muito espaçados (1 FPS, câmara de ação):
      // o descodificador arredonda o instante pedido para o fotograma mais próximo.
      if (snapSeconds > 0) this._t = Math.round(this._t / snapSeconds) * snapSeconds;
      this.seeking = true;
      stats.seeks++;
      stats.maxSimultaneous = Math.max(stats.maxSimultaneous, 1);
      // Resolve o seek ao fim da latência simulada (como um descodificador real).
      setTimeout(() => {
        this.seeking = false;
        this._emit('seeked');
      }, seekLatencyMs);
    },
    /**
     * Evento como num <video> real: avisa QUEM SE INSCREVEU por `addEventListener` e o
     * handler atribuído à propriedade (`onseeked`), que é o estilo usado pelo gestor.
     */
    _emit(type) {
      (listeners[type] || []).slice().forEach((fn) => fn());
      const handler = this['on' + type];
      if (typeof handler === 'function') handler({ type, target: this });
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  return element;
}

// ---------------------------------------------------------------------------
console.log('\n== 1. Tempo legível (mm:ss.d) e leitura de tempo ==');
check('formata 20s como 00:20.0', formatTimecode(20) === '00:20.0', formatTimecode(20));
check('formata 45s como 00:45.0', formatTimecode(45) === '00:45.0', formatTimecode(45));
check('formata 80.5s como 01:20.5', formatTimecode(80.5) === '01:20.5', formatTimecode(80.5));
check('formata 3661.2s como 1:01:01.2', formatTimecode(3661.2) === '1:01:01.2', formatTimecode(3661.2));
check('formata valores inválidos como 00:00.0', formatTimecode(undefined) === '00:00.0', formatTimecode(undefined));
check('lê "20" como 20s', parseTimecode('20') === 20);
check('lê "45.5" como 45.5s', parseTimecode('45.5') === 45.5);
check('lê "1:20" como 80s', parseTimecode('1:20') === 80);
check('lê "01:20.5" como 80.5s', parseTimecode('01:20.5') === 80.5);
check('lê vírgula decimal "20,5" como 20.5s', parseTimecode('20,5') === 20.5);
check('rejeita texto inválido', parseTimecode('abc') === null && parseTimecode('') === null && parseTimecode(':') === null);

// ---------------------------------------------------------------------------
console.log('\n== 2. Intervalo A-B por tempo (ex.: A = 20s, B = 45s) ==');
const exact = clampRange(20, 45, 60);
check('aceita A=20 B=45 num vídeo de 60s', exact.valid && exact.start === 20 && exact.end === 45, JSON.stringify(exact));
const swapped = clampRange(45, 20, 60);
check('troca A/B quando vêm invertidos', swapped.start === 20 && swapped.end === 45, JSON.stringify(swapped));
const clamped = clampRange(-5, 999, 60);
check('limita ao vídeo (0 → duração)', clamped.start === 0 && clamped.end === 60, JSON.stringify(clamped));
const tiny = clampRange(30, 30.05, 60);
check('garante o intervalo mínimo de 0.2s', tiny.end - tiny.start >= 0.2 - 1e-9, JSON.stringify(tiny));
check('duração desconhecida => inválido', clampRange(1, 2, 0).valid === false);
check('texto de tempo aceite em A/B', clampRange('1:20', '2:00', 300).start === 80);
check('sem intervalo => âmbito é o vídeo completo', playbackBounds({ loopEnabled: false, duration: 60 }).scoped === false);
check('com intervalo => âmbito A-B', (() => {
  const b = playbackBounds({ loopEnabled: true, loopStart: 20, loopEnd: 45, duration: 60 });
  return b.start === 20 && b.end === 45 && b.scoped === true;
})());
check('percentagem do playhead', percentOf(30, 60) === 50 && percentOf(70, 60) === 100);
check('região A-B em percentagem', (() => {
  const r = loopRegionPercent({ start: 15, end: 45 }, 60);
  return Math.abs(r.left - 25) < 1e-6 && Math.abs(r.width - 50) < 1e-6;
})());

// ---------------------------------------------------------------------------
console.log('\n== 3. Fronteira do sentido normal (avançar) ==');
check('vídeo completo com loop total volta a 0s', (() => {
  const d = resolveForwardBoundary({ currentTime: 59.99, duration: 60, infiniteLoop: true });
  return d && d.seekTo === 0 && !d.stop;
})());
check('sem loop total para no fim', (() => {
  const d = resolveForwardBoundary({ currentTime: 60, duration: 60, infiniteLoop: false });
  return d && d.stop === true;
})());
check('intervalo A-B volta ao ponto A (e não a 0s)', (() => {
  const d = resolveForwardBoundary({ currentTime: 44.99, duration: 60, loopEnabled: true, loopStart: 20, loopEnd: 45, infiniteLoop: true });
  return d && d.seekTo === 20;
})());
check('longe do fim não faz nada', resolveForwardBoundary({ currentTime: 30, duration: 60, infiniteLoop: true }) === null);

// ---------------------------------------------------------------------------
console.log('\n== 4. Passo da marcha-atrás (rebobinar) ==');
const normalStep = resolveReverseTarget({ currentTime: 30, advance: 1 / 60, duration: 60, frameStep: 1 / 30 });
check('acumulador curto => recua exatamente 1 fotograma', Math.abs(normalStep.step - 1 / 30) < 1e-9 && !normalStep.wrapped);
const slowStep = resolveReverseTarget({ currentTime: 30, advance: 0.18, duration: 60, frameStep: 1 / 30 });
check('descodificação lenta => salta fotogramas (0.18s)', Math.abs(slowStep.step - 0.18) < 1e-9, String(slowStep.step));
const capped = resolveReverseTarget({ currentTime: 30, advance: 5, duration: 60, frameStep: 1 / 30, maxStep: 0.5 });
check('passo limitado a 0.5s', capped.step === 0.5);
const wrapTotal = resolveReverseTarget({ currentTime: 0.01, advance: 1 / 30, duration: 60, infiniteLoop: true });
check('no início salta para o fim (loop total)', wrapTotal.wrapped && Math.abs(wrapTotal.target - 60) < 1e-9, JSON.stringify(wrapTotal));
const wrapAb = resolveReverseTarget({ currentTime: 20.01, advance: 1 / 30, duration: 60, loopEnabled: true, loopStart: 20, loopEnd: 45, infiniteLoop: true });
check('no ponto A salta para o ponto B', wrapAb.wrapped && Math.abs(wrapAb.target - 45) < 1e-9, JSON.stringify(wrapAb));
const finishNoLoop = resolveReverseTarget({ currentTime: 0.01, advance: 1 / 30, duration: 60, infiniteLoop: false });
check('sem loop total termina no início', finishNoLoop.finished && finishNoLoop.target === 0);
// Sem duração conhecida NÃO há fim para onde saltar: o wrap artificial para 0 deixava o motor a
// pedir o instante 0 para sempre (imagem parada no início com o painel a dizer "a rebobinar").
const unknownDuration = resolveReverseTarget({ currentTime: 0.01, advance: 1 / 30, duration: 0, infiniteLoop: true });
check('sem duração o recuo termina no início (não finge um loop para o instante 0)',
  unknownDuration.finished === true && unknownDuration.wrapped === false && unknownDuration.target === 0,
  JSON.stringify(unknownDuration));
const unknownDurationNaN = resolveReverseTarget({ currentTime: 0.01, advance: 1 / 30, duration: NaN, infiniteLoop: true });
check('duração NaN é tratada como desconhecida (nunca um loop infinito no início)',
  unknownDurationNaN.finished === true && unknownDurationNaN.wrapped === false);
const unknownDurationMid = resolveReverseTarget({ currentTime: 5, advance: 1 / 30, duration: 0, infiniteLoop: true });
check('sem duração o recuo continua a andar a meio do vídeo (recua 1 fotograma)',
  unknownDurationMid.finished === false && Math.abs(unknownDurationMid.target - (5 - 1 / 30)) < 1e-9);

// ---------------------------------------------------------------------------
console.log('\n== 5. Motor de marcha-atrás: um único seek em voo (anti-congelamento) ==');
const stats1 = {};
const video1 = makeVideo(10, 10, stats1);
const frames1 = [];
const engine1 = new ReversePlaybackEngine({
  getVideo: () => video1,
  getRate: () => 1,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 10, scoped: false, infiniteLoop: true }),
  onFrame: (t) => frames1.push(Number(t.toFixed(3))),
});
engine1.start();
for (let i = 0; i < 120; i++) {
  stepFrame(16.67);
  await flush();
}
engine1.stop();

check('nunca sobrepõe seeks (a causa do vídeo parado)', stats1.overlaps === 0, `sobreposições=${stats1.overlaps}`);
check('apresenta fotogramas a ~1x de velocidade', frames1.length >= 55 && frames1.length <= 65, `fotogramas=${frames1.length}`);
check('cada fotograma foi realmente apresentado (sem valores repetidos)', new Set(frames1).size === frames1.length);
check('o tempo recua sempre', frames1.every((t, i) => i === 0 || t < frames1[i - 1]));
check(
  'recuou ~2s em 2s de relógio',
  frames1.length > 0 && Math.abs(10 - frames1[frames1.length - 1] - 2) < 0.15,
  `final=${frames1[frames1.length - 1]} (recuou ${(10 - frames1[frames1.length - 1]).toFixed(3)}s)`
);
check('em 2s de marcha-atrás a 1x são ~60 fotogramas (não 1 por segundo)', frames1.length > 50, `fotogramas=${frames1.length}`);

// Loop total: ao chegar ao início, recomeça no fim — indefinidamente.
const statsLoop = {};
const videoLoop = makeVideo(2, 0.01, statsLoop);
const framesLoop = [];
const engineLoop = new ReversePlaybackEngine({
  getVideo: () => videoLoop,
  getRate: () => 1,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 4, scoped: false, infiniteLoop: true }),
  onFrame: (t) => framesLoop.push(Number(t.toFixed(3))),
});
engineLoop.start();
// ~5.3s de relógio: um vídeo de 2s tem de dar pelo menos 2 voltas depois do arranque.
for (let i = 0; i < 320; i++) {
  stepFrame(16.67);
  await flush();
}
engineLoop.stop();
// Começa a 0.01s: na primeira passagem tem de saltar para o fim do vídeo (2s).
check('marcha-atrás começa no fim do vídeo', Math.abs(framesLoop[0] - 2) < 0.05, `primeiro=${framesLoop[0]}`);
const wrapCount = framesLoop.filter((t, i) => i > 0 && t > framesLoop[i - 1] + 1).length;
check('marcha-atrás em loop total repete o ciclo (>= 2 voltas)', wrapCount >= 2, `voltas=${wrapCount}`);
check('marcha-atrás em loop total nunca fica negativo', framesLoop.every((t) => t >= 0));

// Velocidade reduzida: 0.25x deve recuar 4x mais devagar.
const statsSlow = {};
const videoSlow = makeVideo(20, 20, statsSlow);
const framesSlow = [];
const engineSlow = new ReversePlaybackEngine({
  getVideo: () => videoSlow,
  getRate: () => 0.25,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 20, scoped: false, infiniteLoop: true }),
  onFrame: (t) => framesSlow.push(t),
});
engineSlow.start();
for (let i = 0; i < 120; i++) {
  stepFrame(16.67);
  await flush();
}
engineSlow.stop();
check(
  'a 0.25x recua ~0.5s por 2s de relógio',
  framesSlow.length > 0 && Math.abs(20 - framesSlow[framesSlow.length - 1] - 0.5) < 0.15,
  `recuou=${(20 - framesSlow[framesSlow.length - 1]).toFixed(3)}s`
);

// ---------------------------------------------------------------------------
console.log('\n== 6. Gestor de vídeo: API do intervalo A-B ==');
const manager = new VideoUploadManager({
  onTimeUpdate: () => {},
  onVideoLoaded: () => {},
  onEnded: () => {},
  onPlayStateChange: () => {},
  onDirectionChange: () => {},
  onAutoSlowdownChange: () => {},
});
manager.duration = 60;
check('loop total ligado por omissão', manager.infiniteLoop === true);
check('setLoopRange("20","45") aplica o intervalo', (() => {
  const ok = manager.setLoopRange('20', '45');
  return ok && manager.loopStart === 20 && manager.loopEnd === 45 && manager.loopEnabled === true;
})());
check('getBounds devolve o intervalo ativo', (() => {
  const b = manager.getBounds();
  return b.scoped === true && b.start === 20 && b.end === 45;
})());
check('clearLoop volta ao vídeo completo', (() => {
  manager.clearLoop();
  const b = manager.getBounds();
  return manager.loopEnabled === false && b.scoped === false;
})());
check('toggleInfiniteLoop alterna o loop total', manager.toggleInfiniteLoop() === false && manager.toggleInfiniteLoop() === true);
check('setLoopRange devolve false sem duração conhecida', (() => {
  const m2 = new VideoUploadManager({});
  m2.duration = 0;
  return m2.setLoopRange(1, 2) === false;
})());
check('_reclampLoopToDuration desativa intervalo fora do novo vídeo', (() => {
  const m3 = new VideoUploadManager({});
  m3.duration = 60;
  m3.setLoopRange(20, 45);
  m3.duration = 10; // ficheiro novo, mais curto
  m3._reclampLoopToDuration();
  return m3.loopEnabled === false && m3.loopStart === 0 && m3.loopEnd === 0;
})());
check('loadVideoFile limpa o intervalo A-B do vídeo anterior', (() => {
  const m5 = new VideoUploadManager({});
  m5.duration = 60;
  m5.setLoopRange(20, 45);
  m5.videoElement = {
    src: '',
    playbackRate: 1,
    load: () => {},
  };
  m5.loadVideoFile(new File(['conteudo-de-teste'], 'novo.mp4', { type: 'video/mp4' }));
  return m5.loopEnabled === false && m5.loopStart === 0 && m5.loopEnd === 0 && m5.playbackDirection === 'forward';
})());
check('_reclampLoopToDuration mantém intervalo válido', (() => {
  const m4 = new VideoUploadManager({});
  m4.duration = 60;
  m4.setLoopRange(10, 30);
  m4.duration = 40;
  m4._reclampLoopToDuration();
  return m4.loopEnabled === true && m4.loopStart === 10 && m4.loopEnd === 30;
})());

// ---------------------------------------------------------------------------
console.log('\n== 7. Marcha-atrás com descodificação lenta (a velocidade real mantém-se) ==');
// Simula 45ms por seek (típico em Chromium com 1080p). A ~16.67ms por tick, é
// impossível apresentar todos os fotogramas: o motor tem de saltar fotogramas e
// continuar a recuar 1s de vídeo por cada 1s de relógio.
const statsLatency = {};
const videoLatency = makeVideo(10, 10, statsLatency, 45);
const framesLatency = [];
const engineLatency = new ReversePlaybackEngine({
  getVideo: () => videoLatency,
  getRate: () => 1,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 10, scoped: false, infiniteLoop: true }),
  onFrame: (t) => framesLatency.push(t),
});
engineLatency.start();
await runPaced(180); // ~3s de relógio real
engineLatency.stop();
const recuadoLatency = framesLatency.length ? 10 - framesLatency[framesLatency.length - 1] : 0;
check('nunca sobrepõe seeks mesmo com seeks lentos', statsLatency.overlaps === 0);
check(
  'mantém ~1x de velocidade saltando fotogramas (3s ± 15%)',
  Math.abs(recuadoLatency - 3) < 0.45,
  `recuou=${recuadoLatency.toFixed(3)}s em 3.0s`
);
check(
  'salta fotogramas quando o descodificador é mais lento que o tempo real',
  framesLatency.length < 90 && framesLatency.length > 40,
  `fotogramas apresentados=${framesLatency.length} (máximo possível=90)`
);
check('a imagem continua a mudar (nada de vídeo parado)', new Set(framesLatency.map((t) => t.toFixed(3))).size === framesLatency.length);

// ---------------------------------------------------------------------------
console.log('\n== 8. Régua temporal e zonas (navegação por minutos na barra) ==');
check('relógio de régua sem décimas (mm:ss)', formatRulerTime(80.5) === '01:20', formatRulerTime(80.5));
check('relógio de régua em vídeos longos (h:mm:ss)', formatRulerTime(3725) === '1:02:05', formatRulerTime(3725));
check('sem duração não há marcações', buildTimeTicks(0).length === 0);
check('vídeo de 45s => marcas de 5 em 5 segundos', (() => {
  const ticks = buildTimeTicks(45, { maxTicks: 12 });
  return ticks.length >= 9 && ticks[1].time === 5 && ticks[ticks.length - 1].time === 45;
})(), JSON.stringify(buildTimeTicks(45, { maxTicks: 12 }).map((t) => t.time)));
check('vídeo de 10min => marcas de minuto em minuto', (() => {
  const ticks = buildTimeTicks(600, { maxTicks: 12 });
  return ticks.length === 11 && ticks[1].time === 60 && ticks.every((t) => t.major);
})(), JSON.stringify(buildTimeTicks(600, { maxTicks: 12 }).map((t) => t.label)));
check('a última marca fecha na duração real', (() => {
  const ticks = buildTimeTicks(125, { maxTicks: 12 });
  return ticks[ticks.length - 1].time === 125 && ticks[ticks.length - 1].percent === 100;
})());
check('marcações ficam entre 0% e 100%', buildTimeTicks(600, { maxTicks: 12 }).every((t) => t.percent >= 0 && t.percent <= 100));
check('clampTime prende o instante ao vídeo', clampTime(-3, 60) === 0 && clampTime(999, 60) === 60 && clampTime(NaN, 60) === 0);

// ---------------------------------------------------------------------------
console.log('\n== 9. Escolher o intervalo A-B na barra (dois pontos) ==');
check('um clique simples salta para o instante', (() => {
  const g = resolveTimelineDrag({ startTime: 22.4, endTime: 22.5, duration: 60, movedPx: 0 });
  return g.mode === 'seek' && g.seekTo === 22.4;
})(), JSON.stringify(resolveTimelineDrag({ startTime: 22.4, endTime: 22.5, duration: 60, movedPx: 0 })));
check('um arrasto define o intervalo (dois pontos)', (() => {
  const g = resolveTimelineDrag({ startTime: 12, endTime: 18.5, duration: 60, movedPx: 90 });
  return g.mode === 'loop' && g.range.valid && g.range.start === 12 && g.range.end === 18.5;
})(), JSON.stringify(resolveTimelineDrag({ startTime: 12, endTime: 18.5, duration: 60, movedPx: 90 })));
check('arrastar para trás também define o intervalo (A/B trocados)', (() => {
  const g = resolveTimelineDrag({ startTime: 40, endTime: 25, duration: 60, movedPx: -120 });
  return g.mode === 'loop' && g.range.start === 25 && g.range.end === 40;
})());
check('arrasto minúsculo (2px) ainda é um clique', resolveTimelineDrag({ startTime: 5, endTime: 6, duration: 60, movedPx: 2 }).mode === 'seek');
check('sem duração não há gesto', resolveTimelineDrag({ startTime: 1, endTime: 2, duration: 0, movedPx: 40 }).mode === 'none');
check('intervalo escolhido fora do vídeo é limitado', (() => {
  const g = resolveTimelineDrag({ startTime: -4, endTime: 999, duration: 60, movedPx: 200 });
  return g.range.start === 0 && g.range.end === 60;
})());

// ---------------------------------------------------------------------------
console.log('\n== 9b. Clique ao estilo VLC: 1.º clique marca A, 2.º fecha o intervalo ==');
check('sem ponto pendente, o clique fixa o A', (() => {
  const c = resolveTimelineClick({ time: 22, duration: 60, pendingStart: null });
  return c.mode === 'pending' && c.start === 22 && c.seekTo === 22;
})(), JSON.stringify(resolveTimelineClick({ time: 22, duration: 60, pendingStart: null })));
check('o segundo clique fecha o intervalo A-B', (() => {
  const c = resolveTimelineClick({ time: 41.5, duration: 60, pendingStart: 22 });
  return c.mode === 'loop' && c.range.enabled && c.range.start === 22 && c.range.end === 41.5 && c.seekTo === 22;
})(), JSON.stringify(resolveTimelineClick({ time: 41.5, duration: 60, pendingStart: 22 })));
check('clique antes do A também fecha (A/B trocados automaticamente)', (() => {
  const c = resolveTimelineClick({ time: 8, duration: 60, pendingStart: 30 });
  return c.mode === 'loop' && c.range.start === 8 && c.range.end === 30;
})());
check('dois cliques no mesmo instante ainda originam um intervalo válido', (() => {
  const c = resolveTimelineClick({ time: 12, duration: 60, pendingStart: 12 });
  return c.mode === 'loop' && Math.abs(c.range.end - c.range.start - 0.2) < 1e-6;
})(), JSON.stringify(resolveTimelineClick({ time: 12, duration: 60, pendingStart: 12 })));
check('clique fora do vídeo é limitado à duração', (() => {
  const c = resolveTimelineClick({ time: 999, duration: 60, pendingStart: 10 });
  return c.mode === 'loop' && c.range.end === 60;
})());
check('sem vídeo não há clique', resolveTimelineClick({ time: 5, duration: 0, pendingStart: 1 }).mode === 'none');
check('o intervalo fechado confina a reprodução (bounds A-B)', (() => {
  const c = resolveTimelineClick({ time: 41.5, duration: 60, pendingStart: 22 });
  const bounds = playbackBounds({ loopEnabled: c.range.enabled, loopStart: c.range.start, loopEnd: c.range.end, duration: 60 });
  return bounds.scoped && bounds.start === 22 && bounds.end === 41.5;
})());

// ---------------------------------------------------------------------------
console.log('\n== 10. O relógio segue o fotograma APRESENTADO, não o instante pedido ==');
const published = [];
const clockVideo = makeVideo(60, 0, {}, 0);
const clockMgr = new VideoUploadManager({
  onTimeUpdate: (t) => published.push(Number(t.toFixed(3))),
  onFramePresented: () => {},
});
clockMgr.attachVideo(clockVideo);
clockMgr.duration = 60;
clockMgr.seekTo(12.5);
check(
  'não anuncia um instante antes de a imagem existir (o relógio não se adianta)',
  published.filter((t) => t === 12.5).length === 0,
  `publicado=${JSON.stringify(published)}`
);
await flush();
check('publica o instante quando o seek termina (fotograma pronto)', published[published.length - 1] === 12.5, JSON.stringify(published));
clockMgr.seekTo(12.5);
check('um seek sem mudança publica logo (não há `seeked`)', published[published.length - 1] === 12.5);

// ---------------------------------------------------------------------------
console.log('\n== 11. Marcha-atrás: nunca depende de requestAnimationFrame ==');
const statsNoRaf = {};
const videoNoRaf = makeVideo(30, 30, statsNoRaf, 0);
const framesNoRaf = [];
const engineNoRaf = new ReversePlaybackEngine({
  getVideo: () => videoNoRaf,
  getRate: () => 1,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 30, scoped: false, infiniteLoop: true }),
  onFrame: (t) => framesNoRaf.push(Number(t.toFixed(3))),
});
engineNoRaf.start();
// NENHUM tick de rAF é entregue (janela sem foco / separador oculto): quem move o vídeo é o
// batimento por temporizador. Antes desta correção ficavam 0 fotogramas — imagem parada.
const noRafStart = Date.now();
await sleep(1200);
const noRafElapsed = (Date.now() - noRafStart) / 1000;
engineNoRaf.stop();
const noRafRecuado = 30 - (framesNoRaf.length ? framesNoRaf[framesNoRaf.length - 1] : 30);
check('com rAF estrangulado a imagem continua a andar', framesNoRaf.length >= 12, `fotogramas=${framesNoRaf.length}`);
check(
  'mantém ~1x de velocidade real sem rAF',
  noRafElapsed > 0 && Math.abs(noRafRecuado - noRafElapsed) / noRafElapsed < 0.25,
  `recuou=${noRafRecuado.toFixed(2)}s em ${noRafElapsed.toFixed(2)}s`
);
check('sem seeks sobrepostos sem rAF', statsNoRaf.overlaps === 0);
check('cada fotograma apresentado é diferente do anterior', new Set(framesNoRaf).size === framesNoRaf.length);
check('stop() libertou o temporizador do motor', engineNoRaf.heartbeatId === null && engineNoRaf.rafId === null);
// Depois de parado, nada pode continuar a mexer no vídeo em segundo plano.
const framesAfterStop = framesNoRaf.length;
await sleep(150);
check('depois de stop() não há fotogramas novos', framesNoRaf.length === framesAfterStop, `antes=${framesAfterStop} depois=${framesNoRaf.length}`);

// ---------------------------------------------------------------------------
console.log('\n== 12. Gestor de vídeo: ligar/desligar a marcha-atrás ==');
const dirVideo = makeVideo(40, 20, {}, 0);
const dirPubs = [];
const dirMgr = new VideoUploadManager({
  onTimeUpdate: (t) => dirPubs.push(Number(t.toFixed(3))),
  onDirectionChange: () => {},
});
dirMgr.attachVideo(dirVideo);
dirMgr.duration = 40;
dirMgr.playReverse();
check('playReverse inicia o motor e marca a direção', (() => {
  const d = dirMgr.getReverseDebug();
  return d.isReversePlaying === true && d.running === true && d.direction === 'reverse';
})(), JSON.stringify(dirMgr.getReverseDebug()));
dirMgr.pauseReverse();
check('pauseReverse para o motor', (() => {
  const d = dirMgr.getReverseDebug();
  return d.isReversePlaying === false && d.running === false;
})());
dirMgr.play();
check('voltar a reproduzir no sentido normal para o motor', dirMgr.getReverseDebug().direction === 'forward' && dirMgr.getReverseDebug().running === false);
dirMgr.playReverse();
// 350ms: o veredicto de cada fotograma sai no tick seguinte ao `seeked` (posição já fixada),
// por isso o relógio leva um tick a mais a publicar o primeiro instante.
await sleep(350);
dirMgr.pauseReverse();
check('a marcha-atrás publica tempo real ao vídeo', dirPubs.length > 0 && dirPubs.every((t) => t >= 0 && t <= 40), JSON.stringify(dirPubs.slice(0, 4)));
check('a marcha-atrás recua (o tempo diminui)', dirPubs.length >= 2 && dirPubs[dirPubs.length - 1] < dirPubs[0], JSON.stringify(dirPubs.slice(0, 4)));

// ---------------------------------------------------------------------------
console.log('\n== 13. Escolher o sentido é um comando de transporte ==');
const selVideo = makeVideo(40, 20, {}, 0);
const selMgr = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
selMgr.attachVideo(selVideo);
selMgr.duration = 40;
selVideo.pause();
selMgr.pause();
selMgr.selectDirection('reverse');
check('com o vídeo parado, escolher "recuar" arranca já a marcha-atrás', (() => {
  const d = selMgr.getReverseDebug();
  return d.isReversePlaying === true && d.running === true;
})(), JSON.stringify(selMgr.getReverseDebug()));
selVideo.pause();
selMgr.pause();
selMgr.setPlaybackDirection('reverse');
check('(controlo) só mudar o sentido não arranca nada', selMgr.isReversePlaying === false);
selMgr.selectDirection('forward');
check('escolher "avançar" arranca a reprodução normal', selMgr.playbackDirection === 'forward' && selVideo.playCalls >= 1 && selMgr.getReverseDebug().running === false);
selMgr.selectDirection('reverse');
check('trocar para "recuar" com o vídeo a andar arranca a marcha-atrás', selMgr.getReverseDebug().isReversePlaying === true);
selMgr.selectDirection('reverse');
check('voltar a escolher o mesmo sentido não reinicia nada', selMgr.getReverseDebug().running === true);
selMgr.selectDirection('lateral');
check('sentido inválido é ignorado', selMgr.getReverseDebug().direction === 'reverse');
selMgr.pauseReverse();

// ---------------------------------------------------------------------------
console.log('\n== 14b. Vídeo com fotogramas muito espaçados: o motor não fica preso ==');
// Cada `currentTime` pedido é arredondado para o fotograma de 1 em 1 segundo mais próximo —
// é o que acontece num vídeo de 1 FPS. Um passo de 1/30s volta sempre ao MESMO fotograma:
// sem deteção de "seek que não mudou a imagem", a marcha-atrás ficaria parada para sempre.
const statsSparse = {};
const videoSparse = makeVideo(20, 20, statsSparse, 0, 1);
const framesSparse = [];
const engineSparse = new ReversePlaybackEngine({
  getVideo: () => videoSparse,
  getRate: () => 1,
  getFrameStep: () => 1 / 30,
  getBounds: () => ({ start: 0, end: 20, scoped: false, infiniteLoop: true }),
  onFrame: (t) => framesSparse.push(Number(t.toFixed(3))),
});
engineSparse.start();
await runPaced(150);
engineSparse.stop();
const recuadoSparse = framesSparse.length ? framesSparse[0] - framesSparse[framesSparse.length - 1] : 0;
check('não fica preso no mesmo fotograma (sai do primeiro)', framesSparse.length >= 3, `fotogramas=${JSON.stringify(framesSparse)}`);
check('avança pelo menos 2 fotogramas de 1s', recuadoSparse >= 2, `recuou=${recuadoSparse.toFixed(2)}s`);
check('registou os seeks que devolveram o mesmo fotograma', engineSparse.statStalls > 0, `stalls=${engineSparse.statStalls}`);
check('nunca anuncia o mesmo fotograma duas vezes (relógio não mente)', new Set(framesSparse).size === framesSparse.length);
check('o tempo recua sempre', framesSparse.every((t, i) => i === 0 || t < framesSparse[i - 1]));

// ---------------------------------------------------------------------------
console.log('\n== 14. Varrimento integral bloqueia o transporte (nada de seeks a competir) ==');
const lockVideo = makeVideo(60, 30, {}, 0);
const lockMgr = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
lockMgr.attachVideo(lockVideo);
lockMgr.duration = 60;
lockVideo.pause();
lockMgr.seekTo(10);
await flush();
const ctDepoisDoSeek = lockVideo.currentTime;
lockMgr.setTransportLocked(true);
check('bloquear pára tudo o que já estava a andar', lockMgr.isReversePlaying === false && lockMgr.isPlaying === false);
lockMgr.selectDirection('reverse');
check('durante o varrimento "recuar" não arranca o motor', lockMgr.getReverseDebug().running === false && lockMgr.isReversePlaying === false);
lockMgr.play();
check('durante o varrimento a reprodução normal não arranca', lockVideo.playCalls === 0 && lockMgr.isPlaying === false);
lockMgr.seekTo(50);
lockMgr.seekRelative(5);
lockMgr.stepRangeSeconds(1);
await flush();
check('durante o varrimento nenhum seek mexe no vídeo (o varrimento é o dono)', lockVideo.currentTime === ctDepoisDoSeek, `antes=${ctDepoisDoSeek} agora=${lockVideo.currentTime}`);
lockMgr.setTransportLocked(false);
lockMgr.seekTo(50);
await flush();
check('no fim do varrimento o transporte volta a funcionar', Math.abs(lockVideo.currentTime - 50) < 0.001, String(lockVideo.currentTime));
lockMgr.selectDirection('reverse');
check('e a marcha-atrás volta a arrancar', lockMgr.getReverseDebug().running === true);
lockMgr.pauseReverse();

// ---------------------------------------------------------------------------
console.log('\n== 15. Ficheiro ainda não indexado: recuar só depois de saber onde é o fim ==');
/**
 * <video> de um ficheiro que ainda não revelou a duração (`Infinity`/`NaN`, como os WebM gravados
 * no browser e MP4 sem índice). O seek para lá do fim obriga o descodificador a indexar o ficheiro
 * — é isso que a aplicação faz antes de recuar.
 */
function makeUnindexedVideo(realDuration, startTime = 0, yieldsDuration = true) {
  const listeners = {};
  const stats = { seeks: 0, indexSeeks: 0, maxTime: startTime };
  const element = {
    _indexed: false,
    _realDuration: realDuration,
    _t: startTime,
    seeking: false,
    paused: true,
    ended: false,
    playCalls: 0,
    get duration() {
      return this._indexed ? this._realDuration : NaN;
    },
    get currentTime() {
      return this._t;
    },
    set currentTime(value) {
      stats.seeks++;
      this.seeking = true;
      const beyond = value > this._realDuration * 10;
      if (beyond) stats.indexSeeks++;
      // Só a indexação (seek além do fim) revela a duração — como no browser real.
      if (beyond && yieldsDuration) this._indexed = true;
      this._t = Math.max(0, Math.min(value, yieldsDuration ? this._realDuration : realDuration));
      stats.maxTime = Math.max(stats.maxTime, this._t);
      setTimeout(() => {
        this.seeking = false;
        this._emit('durationchange');
        this._emit('seeked');
        this._emit('timeupdate');
      }, 0);
    },
    play() {
      this.playCalls++;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    _emit(type) {
      (listeners[type] || []).slice().forEach((fn) => fn());
      const handler = this['on' + type];
      if (typeof handler === 'function') handler({ type, target: this });
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  return { element, stats };
}

const indexLogs = [];
const indexClock = [];
const unindexed = makeUnindexedVideo(12, 0);
const indexMgr = new VideoUploadManager({
  onTimeUpdate: (t, d) => indexClock.push({ t, d }),
  onDirectionChange: () => {},
  onDebugLog: (type, msg) => indexLogs.push(`${type}:${msg}`),
});
indexMgr.attachVideo(unindexed.element);
indexMgr.duration = 0;
const indexFrames = [];
indexMgr.reverseEngine.onFrame = (t) => indexFrames.push(Number(t.toFixed(3)));
check('o ficheiro começa sem duração conhecida (é este o caso que congelava)', indexMgr.duration === 0 && !Number.isFinite(unindexed.element.duration));
indexMgr.playReverse();
check('recuar sem duração avisa que está a resolver o ficheiro', indexLogs.some((l) => /a resolver a duração/.test(l)), indexLogs.join(' | '));
check('e NÃO arranca o motor às cegas (nada de imagem parada a fingir de recuo)', indexMgr.getReverseDebug().running === false);
await sleep(60);
const resolvedDuration = await indexMgr.resolveDuration();
check('a duração fica resolvida (12s) e o ficheiro foi indexado', resolvedDuration === 12 && indexMgr.duration === 12 && unindexed.stats.indexSeeks >= 1,
  `duração=${indexMgr.duration} seeks=${unindexed.stats.seeks}`);
await sleep(120);
check('depois de resolvida, o recuo arranca e recua de verdade', indexMgr.getReverseDebug().running === true, JSON.stringify(indexMgr.getReverseDebug()));
await sleep(400);
indexMgr.pauseReverse();
check('os fotogramas apresentados recuam (o tempo diminui)',
  indexFrames.length >= 3 && indexFrames[indexFrames.length - 1] < indexFrames[0],
  JSON.stringify(indexFrames.slice(0, 6)));
check('nunca anuncia o mesmo instante duas vezes', new Set(indexFrames).size === indexFrames.length);
check('a duração descoberta chega à interface (relógio e régua deixam de ficar vazios)',
  indexClock.some((entry) => entry.d === 12),
  JSON.stringify(indexClock.slice(0, 3)));
check('o seek de indexação é interno: o recuo começa no FIM do vídeo, não no sítio do seek',
  unindexed.stats.indexSeeks >= 1 && indexFrames.length > 0 && indexFrames[0] <= 12 && indexFrames[0] >= 11.5,
  `primeiro=${indexFrames[0]} seeksDeIndexacao=${unindexed.stats.indexSeeks}`);

// Um ficheiro que nunca revela a duração não pode deixar o painel a mentir para sempre.
const hopeless = makeUnindexedVideo(12, 0, false);
const hopelessLogs = [];
const hopelessMgr = new VideoUploadManager({
  onTimeUpdate: () => {},
  onDirectionChange: () => {},
  onDebugLog: (type, msg) => hopelessLogs.push(`${type}:${msg}`),
});
hopelessMgr.attachVideo(hopeless.element);
hopelessMgr.duration = 0;
hopelessMgr.playReverse();
await sleep(2400);
const hopelessState = hopelessMgr.getReverseDebug();
check('ficheiro sem duração: a ordem de recuar é desfeita com aviso (não fica "a rebobinar" parado)',
  hopelessState.running === false && hopelessMgr.isReversePlaying === false &&
    hopelessLogs.some((l) => /duração do vídeo é desconhecida/.test(l)),
  `running=${hopelessState.running} isReverse=${hopelessMgr.isReversePlaying} logs=${hopelessLogs.join(' | ')}`);

// ---------------------------------------------------------------------------
console.log('\n== 16. A ordem do utilizador sobrevive à automação (varrimento e retomada) ==');
// Cenário relatado: carregar o vídeo, pedir "recuar" — e a aplicação volta a pôr o vídeo a andar
// para a frente por conta própria (análise integral a arrancar / retomada automática no fim).
const ordemVideo = makeVideo(30, 15, {}, 0);
const ordemLogs = [];
const ordemMgr = new VideoUploadManager({
  onTimeUpdate: () => {},
  onDirectionChange: () => {},
  onDebugLog: (type, msg) => ordemLogs.push(`${type}:${msg}`),
});
ordemMgr.attachVideo(ordemVideo);
ordemMgr.duration = 30;
ordemMgr.setTransportLocked(true);
ordemMgr.playReverse();
check('durante o varrimento nenhum seek arranca (o varrimento manda)', ordemMgr.getReverseDebug().running === false);
check('mas a ordem de recuar NÃO se perde', ordemMgr.requestedDirection === 'reverse');
ordemMgr.setTransportLocked(false);
check('ao libertar o vídeo, o recuo pedido arranca sozinho',
  ordemMgr.getReverseDebug().running === true && ordemMgr.isReversePlaying === true,
  JSON.stringify(ordemMgr.getReverseDebug()));
await sleep(200);
const recuoAntes = ordemVideo.currentTime;
// A retomada automática do fim da análise não pode forçar o sentido normal.
ordemMgr.play({ automatic: true });
await sleep(200);
check('a retomada automática respeita a ordem (continua a recuar)',
  ordemMgr.isReversePlaying === true && ordemMgr.getReverseDebug().running === true && ordemVideo.currentTime <= recuoAntes,
  `antes=${recuoAntes.toFixed(3)} agora=${ordemVideo.currentTime.toFixed(3)}`);
ordemMgr.pauseReverse();
ordemMgr.play({ automatic: true });
check('sem ordem de recuar, a retomada automática continua a avançar como sempre',
  ordemMgr.getReverseDebug().direction === 'forward' && ordemVideo.playCalls >= 1);

// Escolher "avançar" depois de ter pedido recuar tem de ser cumprido (ordem mais recente ganha).
const trocaVideo = makeVideo(30, 15, {}, 0);
const trocaMgr = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
trocaMgr.attachVideo(trocaVideo);
trocaMgr.duration = 30;
trocaMgr.setTransportLocked(true);
trocaMgr.selectDirection('reverse');
trocaMgr.selectDirection('forward');
check('a ÚLTIMA ordem é a que fica registada', trocaMgr.requestedDirection === 'forward');
trocaMgr.setTransportLocked(false);
check('ao libertar, a ordem de AVANÇAR não arranca o motor de recuo', trocaMgr.getReverseDebug().running === false);
trocaMgr.play({ automatic: true });
check('e a retomada automática avança no sentido normal', trocaMgr.playbackDirection === 'forward' && trocaVideo.playCalls >= 1);
// A pausa do utilizador limpa a ordem: uma pausa é "não andes agora", não "anda ao contrário".
const pausaMgr = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
pausaMgr.attachVideo(makeVideo(30, 15, {}, 0));
pausaMgr.duration = 30;
pausaMgr.playReverse();
pausaMgr.pauseReverse();
check('pausar o recuo limpa a ordem (a retomada automática não volta a recuar sozinha)', pausaMgr.requestedDirection === null);
// Já a pausa AUTOMÁTICA (varrimento a tomar o vídeo) preserva a ordem do utilizador.
const autoPausaMgr = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
autoPausaMgr.attachVideo(makeVideo(30, 15, {}, 0));
autoPausaMgr.duration = 30;
autoPausaMgr.playReverse();
autoPausaMgr.setTransportLocked(true);
check('a pausa automática do varrimento preserva a ordem de recuar', autoPausaMgr.requestedDirection === 'reverse' && autoPausaMgr.isReversePlaying === false);
check('sentido inválido não estraga a ordem registada', (() => {
  const m = new VideoUploadManager({ onTimeUpdate: () => {}, onDirectionChange: () => {} });
  m.duration = 30;
  m.selectDirection('reverse');
  m.selectDirection('diagonal');
  return m.requestedDirection === 'reverse';
})());

// ---------------------------------------------------------------------------
console.log('\n== 17. Auto-Slowdown: o travão larga e prende na altura certa ==');
// A velocidade é medida em TEMPO DE VÍDEO. Com o tempo de relógio, o próprio abrandamento
// reduzia a velocidade medida e o motor largava o travão — a oscilação que impedia o
// auto-slowdown de servir para alguma coisa.
check('velocidade angular do joelho (graus por segundo de vídeo)',
  Math.abs(kneeAngularSpeed(90, 110, 0.1) - 200) < 1e-6);
check('sem leitura anterior não se mede movimento', kneeAngularSpeed(null, 110, 0.1) === null);
check('tempo parado não é movimento', kneeAngularSpeed(90, 110, 0) === null);
check('um seek (salto de tempo) não conta como movimento da perna', kneeAngularSpeed(90, 110, 3) === null);

const detector = new MotionSlowdownDetector();
check('perna parada não abranda o vídeo', detector.addSample({ angle: 90, time: 0 }).slowed === false);
check('movimento calmo também não', detector.addSample({ angle: 95, time: 0.1 }).slowed === false);
const entrou = detector.addSample({ angle: 145, time: 0.2 });
check('movimento rápido entra em câmara lenta (1.ª vez)', entrou.enter === true && entrou.slowed === true,
  JSON.stringify(entrou));
check('já travado, não se volta a travar (uma travagem por vez)',
  detector.addSample({ angle: 145.5, time: 0.3 }).enter === false);
// Uma leitura calma isolada NÃO pode largar o travão (histerese): só depois de movimento calmo sustentado.
check('uma leitura calma isolada não larga o travão',
  detector.addSample({ angle: 145.2, time: 0.4 }).release === false);
let saiu = null;
for (let i = 0; i < 12 && !saiu; i++) {
  const decision = detector.addSample({ angle: 145.2 + i * 0.001, time: 0.5 + i * 0.1 });
  if (decision.release) saiu = decision;
}
check('movimento calmo sustentado larga o travão', saiu !== null && saiu.slowed === false, JSON.stringify(saiu));
check('depois de largar, o travão volta a prender se a perna acelerar',
  detector.addSample({ angle: 260, time: 1.5 }).enter === true);
const semAngulo = new MotionSlowdownDetector();
semAngulo.addSample({ angle: 90, time: 0 });
check('uma pose perdida (sem ângulo) não inventa movimento nem desliga nada',
  semAngulo.addSample({ angle: null, time: 0.1 }).speed === null);

// O motor de vídeo só abranda com o interruptor ligado E o vídeo a andar.
// (Este era o defeito: o interruptor nascia ligado na interface e DESLIGADO no motor
// — faltava semear o estado do componente no gestor ao carregar o vídeo.)
const slowVideo = makeVideo(60, 10, {}, 0);
const slowMgr = new VideoUploadManager({ onTimeUpdate: () => {} });
slowMgr.attachVideo(slowVideo);
slowMgr.duration = 60;
check('auto-slowdown desligado no motor: não abranda', slowMgr.triggerMotionSlowdown() === false && slowVideo.playbackRate === 1);
slowMgr.setAutoSlowdown(true, 0.25);
slowMgr.pause();
check('vídeo em pausa não entra em câmara lenta', slowMgr.triggerMotionSlowdown() === false);
slowMgr.play();
slowVideo.onplay(); // como o navegador faz ao arrancar a reprodução
check('com tudo pronto, o travão prende a 0.25x', slowMgr.triggerMotionSlowdown() === true && slowVideo.playbackRate === 0.25,
  `rate=${slowVideo.playbackRate}`);
check('não se prende duas vezes (uma notificação por travagem)', slowMgr.triggerMotionSlowdown() === false);
slowMgr.pause();
check('a pausa larga o travão (nada de "câmara lenta" sobre imagem parada)',
  slowMgr.isSlowedDownByMotion === false && slowVideo.playbackRate === 1);
// A velocidade escolhida pelo utilizador é guardada mesmo com a câmara lenta automática ativa.
const baseVideo = makeVideo(60, 10, {}, 0);
const baseMgr = new VideoUploadManager({ onTimeUpdate: () => {} });
baseMgr.attachVideo(baseVideo);
baseMgr.duration = 60;
baseMgr.setAutoSlowdown(true, 0.25);
baseMgr.setUserPlaybackRate(0.5);
baseMgr.play();
baseVideo.onplay();
baseMgr.triggerMotionSlowdown();
check('durante a câmara lenta o vídeo fica a 0.25x', baseVideo.playbackRate === 0.25);
baseMgr.setUserPlaybackRate(0.75);
check('mudar de velocidade durante a câmara lenta não quebra o abrandamento', baseVideo.playbackRate === 0.25);
baseMgr.releaseMotionSlowdown();
check('ao largar, volta à velocidade escolhida (0.75x, não a antiga)', baseVideo.playbackRate === 0.75,
  `rate=${baseVideo.playbackRate}`);

// ---------------------------------------------------------------------------
console.log('\n== 18. Velocidade e rigor: a imagem enviada à IA deixa de ser o vídeo inteiro ==');
check('1080p é reduzido ao lado de trabalho (mesma proporção)', (() => {
  const s = inferenceSize(1920, 1080, 640);
  return s.width === 640 && s.height === 360;
})(), JSON.stringify(inferenceSize(1920, 1080, 640)));
check('vídeo vertical também é reduzido pelo lado maior', (() => {
  const s = inferenceSize(1080, 1920, 640);
  return s.width === 360 && s.height === 640;
})());
check('nunca se amplia uma fonte pequena', (() => {
  const s = inferenceSize(320, 240, 640);
  return s.width === 320 && s.height === 240;
})());
check('sem dimensões conhecidas não há tamanho', inferenceSize(0, 0, 640).width === 0);

const tuner = new PoseLoadTuner({ floorFps: 20, ceilFps: 34, window: 3, minSamples: 2, maxSwitches: 2 });
check('começa no perfil rigoroso (modelo completo)', tuner.profile.modelComplexity === 1 && tuner.profile.workingWidth === 640);
check('uma leitura só não decide nada', tuner.addFpsSample(12).switched === false);
const baixou = tuner.addFpsSample(12);
check('IA a 12 FPS: desce a carga para acompanhar a perna', baixou.switched === true && baixou.profile.modelComplexity === 1 && baixou.profile.workingWidth === 480,
  JSON.stringify(baixou.profile));
check('o modelo só desce a último recurso (rigor primeiro)',
  POSE_PROFILES[2].modelComplexity === 0 && tuner.profile.modelComplexity === 1);
tuner.addFpsSample(10);
const baixou2 = tuner.addFpsSample(10);
check('se continuar lento, desce ao modelo rápido', baixou2.switched === true && baixou2.profile.modelComplexity === 0,
  JSON.stringify(baixou2.profile));
check('não anda a trocar de modelo sem parar (limite de trocas)', tuner.addFpsSample(10).switched === false);
const subiu = new PoseLoadTuner({ floorFps: 20, ceilFps: 34, window: 3, minSamples: 2, maxSwitches: 4 });
subiu.addFpsSample(12);
subiu.addFpsSample(12);
subiu.addFpsSample(12);
subiu.addFpsSample(12);
check('com a máquina no limite, o modelo rápido é o escolhido', subiu.profile.modelComplexity === 0);
subiu.addFpsSample(60);
const recuperou = subiu.addFpsSample(60);
check('máquina que sobra capacidade volta ao modelo rigoroso',
  recuperou.switched === true && recuperou.profile.modelComplexity === 1,
  JSON.stringify(recuperou.profile));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
