/**
 * Verificação automática do motor de recomendações coerentes e das regras por posição da pedaleira.
 *
 * Executar com:  npm run verify:coherence
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. A altura do selim só é prescrita a partir da posição 6h (extensão) e nunca às 3h.
 *  2. O Stack (tronco) e o Reach (cotovelo) estão desacoplados (sem ordens contraditórias).
 *  3. A prescrição consolidada exige no mínimo 2 fotos.
 *  4. Fotos que divergem entre si produzem um aviso e NENHUMA ordem contraditória.
 *  5. O selim é autoritativo: altura pela foto 6h, recuo/avanço pela foto 3h (KOPS).
 */
import { CoherentRecommendationEngine } from '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js';
import { LiveTuningReportManager } from '../src/components/LiveCameraCapture/modules/liveTuningReportManager.js';
import { getCrankRule, getKneeTargetForPosition } from '../src/components/LiveCameraCapture/modules/crankPositionRules.js';

const targets = { knee: [145, 155], back: [40, 50], elbow: [150, 165], ankle: [95, 105], head: [35, 55] };
let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

const photo = (over) => ({
  status: 'done',
  name: over.name,
  crankPosition: over.crankPosition,
  angles: { joelho: null, costas: null, braco: null, tornozelo: null, anca: null, ...over.angles },
  kopsResult: over.kopsResult || null,
});

// ---------------------------------------------------------------------------
console.log('\n== 1. Regras por posição (3h vs 6h) ==');
check('BDC é modo extensão', getCrankRule('bdc').kneeMode === 'extension');
check('90° é modo flexão média', getCrankRule('90deg').kneeMode === 'midflexion');
check('BDC devolve alvo de extensão', JSON.stringify(getKneeTargetForPosition('bdc', targets.knee)) === '[145,155]');
check('90° NÃO devolve alvo de extensão', getKneeTargetForPosition('90deg', targets.knee) === null);

const report3h = LiveTuningReportManager.generateReport({
  liveAngles: { joelho: 108, costas: 45, braco: 155, tornozelo: 100, cabeca: 45 },
  crankPosition: '90deg',
  targets,
});
const saddle3h = report3h.items.find((i) => i.component === 'Altura do Selim');
check('3h não prescreve subir/descer selim', saddle3h && saddle3h.status === 'ok' && /CONTEXTO/.test(saddle3h.badge), saddle3h?.action);

const report6h = LiveTuningReportManager.generateReport({
  bdcKneeAngle: 130,
  liveAngles: { joelho: 130, costas: 45, braco: 155, tornozelo: 100, cabeca: 45 },
  crankPosition: 'bdc',
  targets,
});
const saddle6h = report6h.items.find((i) => i.component === 'Altura do Selim');
check('6h prescreve subir selim quando joelho baixo', /Subir selim/.test(saddle6h?.action || ''), saddle6h?.action);

// ---------------------------------------------------------------------------
console.log('\n== 2. Stack ≠ Reach (fim da contradição de avanço) ==');
const reclined = LiveTuningReportManager.generateReport({
  bdcKneeAngle: 150,
  liveAngles: { joelho: 150, costas: 30, braco: 155, tornozelo: 100, cabeca: 45 },
  crankPosition: 'bdc',
  targets,
});
const upright = LiveTuningReportManager.generateReport({
  bdcKneeAngle: 150,
  liveAngles: { joelho: 150, costas: 58, braco: 155, tornozelo: 100, cabeca: 45 },
  crankPosition: 'bdc',
  targets,
});
check('Tronco rebaixado => Stack com espaçadores', /espaçadores/i.test(reclined.items.find((i) => i.component.includes('Stack'))?.whatToDo || ''));
check('Tronco ereto => Stack com remoção de espaçadores', /Remover|remover/i.test(upright.items.find((i) => i.component.includes('Stack'))?.whatToDo || ''));
const stackOrdersStem = [reclined, upright].some((r) => r.items.some((i) => i.component.includes('Stack') && /alongar|encurtar/i.test(i.whatToDo)));
check('Stack nunca manda alongar/encurtar o avanço', !stackOrdersStem);
check('Existe exatamente 1 componente dono do Reach', report6h.items.filter((i) => /Reach/.test(i.component)).length === 1);
const reachOwners = new Set(report6h.items.filter((i) => /alongar|encurtar/i.test(i.whatToDo)).map((i) => i.component));
check('Só o componente Reach ordena comprimento de avanço', [...reachOwners].every((c) => /Reach/.test(c)), [...reachOwners].join(', ') || 'nenhum');

// ---------------------------------------------------------------------------
console.log('\n== 3. Mínimo de 2 fotos ==');
const onePhoto = CoherentRecommendationEngine.build([photo({ name: 'a.jpg', crankPosition: 'bdc', angles: { joelho: 130 } })], targets);
check('1 foto => prescrição bloqueada', onePhoto.ready === false && onePhoto.prescriptions.length === 0);
check('1 foto => aviso de mínimo', onePhoto.notices.length > 0);

// ---------------------------------------------------------------------------
console.log('\n== 4. Coerência: fotos a divergir no Reach ==');
const diverge = CoherentRecommendationEngine.build(
  [
    photo({ name: 'bdc.jpg', crankPosition: 'bdc', angles: { joelho: 138, costas: 45, braco: 172, tornozelo: 100 } }),
    photo({ name: 'noventa.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 45, braco: 140, tornozelo: 100 }, kopsResult: { offsetMm: 4 } }),
  ],
  targets
);
check('prescrição disponível com 2 fotos', diverge.ready === true);
check('Reach apresenta divergência e não é prescrito', !diverge.prescriptions.some((p) => p.key === 'reach'));
check('existe aviso de divergência do Reach', diverge.notices.some((n) => /Reach/i.test(n)), diverge.notices.join(' // '));
check('apenas UMA direção por componente (sem duplicados)', new Set(diverge.prescriptions.map((p) => p.key)).size === diverge.prescriptions.length);

// ---------------------------------------------------------------------------
console.log('\n== 5. Altura do Selim autoritativa só a 6h + KOPS só a 3h ==');
const coherent = CoherentRecommendationEngine.build(
  [
    photo({ name: 'bdc.jpg', crankPosition: 'bdc', angles: { joelho: 138, costas: 45, braco: 158, tornozelo: 100 } }),
    photo({ name: 'noventa.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 45, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 22 } }),
  ],
  targets
);
const height = coherent.prescriptions.find((p) => p.key === 'saddleHeight');
const foreAft = coherent.prescriptions.find((p) => p.key === 'saddleForeAft');
check('selim sobe a partir da foto 6h', height && height.direction === 'raise', height?.action);
check('selim recua a partir da foto 3h (KOPS +22mm)', foreAft && foreAft.direction === 'back', foreAft?.action);
check('evidência cita a foto de origem', foreAft?.evidence.includes('noventa.jpg'));

const only90 = CoherentRecommendationEngine.build(
  [
    photo({ name: 'a90.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 45, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 22 } }),
    photo({ name: 'b90.jpg', crankPosition: '90deg', angles: { joelho: 112, costas: 45, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 18 } }),
  ],
  targets
);
check('sem foto 6h => posição BDC em falta e sem altura de selim', only90.missingPositions.includes('BDC (6h)') && !only90.prescriptions.some((p) => p.key === 'saddleHeight'));

// ---------------------------------------------------------------------------
console.log('\n== 6. Formatação do texto para cópia/impressão (formatText) ==');
const printed = CoherentRecommendationEngine.formatText(coherent, 'Ana', 'Bicicleta X');
check('texto inclui o nome do atleta', printed.includes('Ana'));
check('texto lista os componentes prescritos', /Altura do Selim/.test(printed) && /KOPS/.test(printed));
check('texto indica a fonte de cada ajuste', /FONTE \(fotos\)/.test(printed));
check('texto indica as fotos em falta', /POSIÇÕES EM FALTA/.test(CoherentRecommendationEngine.formatText(only90, 'Ana', 'Bicicleta X')));
check('texto bloqueado explica o mínimo de fotos', /PRESCRIÇÃO INDISPONÍVEL/.test(CoherentRecommendationEngine.formatText(onePhoto, 'Ana', 'Bicicleta X')));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
