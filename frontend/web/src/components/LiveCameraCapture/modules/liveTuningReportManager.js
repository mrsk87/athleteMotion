/**
 * Gestor do Relatório de Afinações Biomecânicas em Tempo Real (LiveTuningReportManager).
 *
 * Responsabilidade:
 * - Converter ângulos medidos (Joelho no BDC, KOPS, Tronco, Braço) em recomendações práticas de afinação mecânica (mm e cm).
 * - Calcular pontuação global de conformidade ergonómica (0-100%).
 * - Formatar texto estruturado para cópia e geração de janela de impressão/PDF.
 *
 * REGRA DE COERÊNCIA:
 * - O ângulo do Tronco gere apenas o STACK (espaçadores do guiador).
 * - O ângulo do Cotovelo gere apenas o REACH (comprimento do avanço).
 *   Assim, nunca dois componentes diferentes mandam mexer na mesma peça em sentidos opostos.
 * - O Joelho só gera ALTURA DE SELIM na posição de EXTENSÃO (6h/BDC); noutras posições é descritivo.
 *
 * POSTURA (ereta vs aero):
 * Quem diz o que é prescritivo em cada postura é `postureMode.js` (SSOT). Aqui aplicam-se as
 * consequências: em AERO o KOPS e a cabeça passam a DESCRITIVOS, o tronco e o cotovelo usam os
 * alvos de aero, e o antebraço ganha alvo próprio (0–20°).
 */

import {
  KNEE_EXTENSION_RANGE,
  getCrankRule,
  getKneeTargetForPosition,
  getPositionMetricAuthority,
} from './crankPositionRules.js';
import {
  DEFAULT_POSTURE,
  POSTURE_AERO,
  POSTURE_MODES,
  formatTargetsLine,
  getPostureMetricAuthority,
  postureCopyFor,
} from './postureMode.js';

export class LiveTuningReportManager {
  /**
   * Gera o diagnóstico completo de afinações com valores medidos e intervenções sugeridas.
   */
  static generateReport({
    bdcKneeAngle,
    liveAngles = {},
    kopsResult = null,
    targets = {},
    isFullBody = true,
    rpm = 0,
    psi = 85,
    crankPosition = 'bdc',
    posture = DEFAULT_POSTURE,
    postureDetection = null,
  }) {
    const items = [];
    let compliancePoints = 0;
    let totalChecks = 0;
    // Quem é prescritivo nesta postura (KOPS/anca/cabeça saem em aero).
    const authority = getPostureMetricAuthority({ posture, position: crankPosition });
    // O KOPS só é MEDÍVEL às 3h (é a única posição autorizada pela regra da posição). Em aero,
    // onde deixa de prescrever, continua a só ser registado quando é medível nesta posição:
    // fora das 3h seria uma linha sem significado, como já acontece em posição ereta.
    const kopsMeasurableHere = getPositionMetricAuthority(crankPosition).kops === true;
    const mode = POSTURE_MODES[posture] || POSTURE_MODES[DEFAULT_POSTURE];
    const copyFor = (metric, variant) => postureCopyFor(posture, metric, variant);

    // 1. AFINAÇÃO DA ALTURA DO SELIM — só avaliada na posição de EXTENSÃO (6h/BDC)
    const kneeRule = getCrankRule(crankPosition);
    const kneeTarget = getKneeTargetForPosition(crankPosition, targets.knee || KNEE_EXTENSION_RANGE);
    const knee = bdcKneeAngle || liveAngles.joelho;
    if (knee && !kneeTarget) {
      // Posição que NÃO permite prescrever altura de selim (ex.: 3h, 12h, 9h, Livre).
      // Não conta para a pontuação: é informação de contexto, não um desvio.
      items.push({
        component: 'Altura do Selim',
        action: 'Sem alteração (posição não avaliativa)',
        whatToDo: 'Não alterar a altura do selim com base nesta foto; use uma foto no Ponto Morto Inferior (6h / BDC).',
        degreesInfo: `Ângulo do joelho medido: ${Math.round(knee)}° | Posição: ${kneeRule.label}.`,
        why: kneeRule.explanationPt,
        harmDone: 'Nenhum. Ajustar o selim a partir de uma posição que não seja o BDC conduziria a uma afinação errada.',
        status: 'ok',
        badge: 'ℹ️ CONTEXTO',
        measured: `${Math.round(knee)}°`,
        target: 'Avaliar a 6h (BDC)',
        detail: 'A altura do selim só é avaliada no ponto morto inferior (6h), onde a perna atinge a extensão máxima.',
      });
    } else if (knee) {
      totalChecks++;
      const [minK, maxK] = kneeTarget;
      if (knee >= minK && knee <= maxK) {
        compliancePoints += 100;
        items.push({
          component: 'Altura do Selim',
          action: 'Manter altura atual (0 mm)',
          whatToDo: 'Manter a altura atual do espigão do selim (0 mm de alteração).',
          degreesInfo: `Ângulo medido: ${Math.round(knee)}° | Meta ergonómica: ${minK}° a ${maxK}° (Alinhado).`,
          why: 'A amplitude de 145°-155° (método Holmes) ativa perfeitamente glúteos e quadríceps com transmissão máxima de watts e sem perda de estabilidade.',
          harmDone: 'Nenhum. A posição protege a cartilagem patelofemoral e a coluna.',
          status: 'ok',
          badge: '✅ IDEAL',
          measured: `${Math.round(knee)}°`,
          target: `${minK}° - ${maxK}°`,
          detail: 'Extensão ótima no Ponto Morto Inferior (BDC). Previne sobrecargas patelares e garante pico de binário.',
        });
      } else if (knee < minK) {
        const deltaDeg = minK - Math.round(knee);
        const mm = Math.min(25, Math.max(3, Math.round(deltaDeg * 2.3)));
        const isCritical = knee < 140;
        compliancePoints += isCritical ? 20 : 60;
        items.push({
          component: 'Altura do Selim',
          action: `Subir selim ~${mm} mm`,
          whatToDo: `Subir o espigão do selim entre ${mm} mm e ${mm + 4} mm no quadro.`,
          degreesInfo: `Ângulo medido: ${Math.round(knee)}° | Devia ter: ${minK}° a ${maxK}° (Défice: -${deltaDeg}° de extensão).`,
          why: 'Elevar o selim permite esticar mais a perna no ponto morto inferior, recrutando os glúteos e aliviando a flexão excessiva da articulação.',
          harmDone: 'Compressão patelofemoral severa: esmaga a cartilagem sob a rótula, inflama o tendão rotuliano (tendinite patelar), causa dores agudas na frente do joelho e queima energia prematuramente nos quadríceps.',
          status: isCritical ? 'danger' : 'warning',
          badge: isCritical ? '🔴 MUITO BAIXO' : '🟡 BAIXO',
          measured: `${Math.round(knee)}°`,
          target: `${minK}° - ${maxK}°`,
          detail: `Joelho excessivamente fletido (${Math.round(knee)}°). Elevar o espigão para atingir pelo menos 145° e aliviar o tendão rotuliano.`,
        });
      } else {
        const deltaDeg = Math.round(knee) - maxK;
        const mm = Math.min(25, Math.max(3, Math.round(deltaDeg * 2.5)));
        const isCritical = knee > 160;
        compliancePoints += isCritical ? 20 : 60;
        items.push({
          component: 'Altura do Selim',
          action: `Descer selim ~${mm} mm`,
          whatToDo: `Baixar o espigão do selim entre ${mm} mm e ${mm + 3} mm no quadro.`,
          degreesInfo: `Ângulo medido: ${Math.round(knee)}° | Devia ter: ${minK}° a ${maxK}° (Excesso: +${deltaDeg}° de hiperextensão).`,
          why: 'Baixar o selim restabelece a estabilidade da bacia, permitindo que a força seja transmitida em linha reta, sem necessidade de esticar a ponta do pé para alcançar o pedal.',
          harmDone: 'Hiperextensão articular forçada: obriga a bacia a oscilar lateralmente (rocking pelvis) a cada pedalada, provocando assaduras na virilha, lombalgias por torção e estiramento crónico com tendinite no tendão de Aquiles e contraturas nos isquiotibiais.',
          status: isCritical ? 'danger' : 'warning',
          badge: isCritical ? '🔴 MUITO ALTO' : '🟡 ALTO',
          measured: `${Math.round(knee)}°`,
          target: `${minK}° - ${maxK}°`,
          detail: `Hiperextensão articular (${Math.round(knee)}°). Risco de oscilação da bacia (rocking) e tensão no tendão de Aquiles/isquiotibiais.`,
        });
      }
    }

    // 2. AFINAÇÃO DO RECUO / AVANÇO DO SELIM (KOPS) — só prescritivo em posição ERETA
    if (authority.kops && kopsResult && typeof kopsResult.offsetMm === 'number') {
      totalChecks++;
      const offset = kopsResult.offsetMm;
      if (Math.abs(offset) <= 10) {
        compliancePoints += 100;
        items.push({
          component: 'Recuo do Selim (KOPS)',
          action: 'Manter posição longitudinal',
          whatToDo: 'Manter o selim na posição atual nos carris.',
          degreesInfo: `Desvio medido: ${offset > 0 ? `+${offset}` : offset} mm | Tolerância ideal: ±10 mm.`,
          why: 'O eixo mecânico da patela está na vertical exata do eixo do pedal a 90° de rotação da pedaleira, equilibrando a alavanca de força.',
          harmDone: 'Nenhum. Distribuição neutra de peso entre a roda dianteira e traseira.',
          status: 'ok',
          badge: '✅ ALINHADO',
          measured: `${offset > 0 ? `+${offset}` : offset} mm`,
          target: '±10 mm',
          detail: 'Joelho alinhado com o centro do eixo do pedal a 90° de rotação dos cranques.',
        });
      } else if (offset > 10) {
        const adjustMm = Math.round(offset - 5);
        compliancePoints += 50;
        items.push({
          component: 'Recuo do Selim (KOPS)',
          action: `Recuar selim ~${adjustMm} mm nos carris`,
          whatToDo: `Deslizar o selim para trás cerca de ${adjustMm} mm nos carris do espigão.`,
          degreesInfo: `Desvio medido: +${offset} mm à frente | Tolerância ideal: ±10 mm.`,
          why: 'Recuar o selim reposiciona a patela diretamente sobre o ponto de apoio do pedal, aliviando o vetor de cisalhamento.',
          harmDone: 'Gera força cortante destrutiva na patela e sobrecarrega os pulsos, braços e ombros por excesso de peso corporal projetado para o guiador.',
          status: 'warning',
          badge: '🟡 AVANÇADO',
          measured: `+${offset} mm`,
          target: '±10 mm',
          detail: 'Patela adiantada face ao eixo do pedal. Deslizar o selim para trás para aliviar pressão na rótula.',
        });
      } else {
        const adjustMm = Math.round(Math.abs(offset) - 5);
        compliancePoints += 50;
        items.push({
          component: 'Recuo do Selim (KOPS)',
          action: `Avançar selim ~${adjustMm} mm nos carris`,
          whatToDo: `Deslizar o selim para a frente cerca de ${adjustMm} mm nos carris do espigão.`,
          degreesInfo: `Desvio medido: ${offset} mm atrás | Tolerância ideal: ±10 mm.`,
          why: 'Avançar o selim facilita a cadência rápida (> 85 RPM) e abre o ângulo anterior da anca para uma pedalada mais circular.',
          harmDone: 'Obriga o ciclista a empurrar o pedal para a frente em vez de para baixo, sobrecarregando os flexores da anca e provocando fadiga precoce na zona lombar.',
          status: 'warning',
          badge: '🟡 RECUADO',
          measured: `${offset} mm`,
          target: '±10 mm',
          detail: 'Patela atrasada face ao eixo do pedal. Deslizar o selim para a frente para melhorar cadência.',
        });
      }
    } else if (posture === POSTURE_AERO && kopsMeasurableHere && kopsResult && typeof kopsResult.offsetMm === 'number') {
      // EMPOSIÇÃO AERO O KOPS É DESCRITIVO: a referência é o ângulo de assento (78–86°),
      // não o joelho sobre o eixo do pedal. Não conta para a pontuação nem gera ordem.
      const kopsCopy = copyFor('kops', 'descriptive');
      const offset = kopsResult.offsetMm;
      items.push({
        component: kopsCopy.component,
        action: kopsCopy.action,
        whatToDo: kopsCopy.whatToDo,
        degreesInfo: `Desvio medido: ${offset > 0 ? `+${offset}` : offset} mm (referência KOPS de estrada, não aplicável em aero).`,
        why: kopsCopy.why,
        harmDone: kopsCopy.harmDone,
        status: 'ok',
        badge: 'ℹ️ DESCRITIVO',
        measured: `${offset > 0 ? `+${offset}` : offset} mm`,
        target: null,
        detail: kopsCopy.detail,
        descriptive: true,
      });
    }

    // 3. AFINAÇÃO DO COCKPIT — STACK (espaçadores do guiador) ← ângulo do tronco
    const backTarget = targets.back || [40, 50];
    const back = liveAngles.costas;
    if (back) {
      totalChecks++;
      const [minB, maxB] = backTarget;
      const okCopy = copyFor('trunk', 'ok');
      if (back >= minB && back <= maxB) {
        compliancePoints += 100;
        items.push({
          component: okCopy?.component || 'Cockpit — Stack (Guiador/Espaçadores)',
          action: okCopy?.action || 'Manter altura de espaçadores',
          whatToDo: okCopy?.whatToDo || 'Manter a altura atual do guiador (espaçadores) e o comprimento do avanço.',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Meta ergonómica: ${minB}° a ${maxB}°.`,
          why: okCopy?.why || 'Equilibra o centro de massa, distribuindo 60% do peso corporal no selim e 40% no guiador com curvatura lombar neutra.',
          harmDone: okCopy?.harmDone || 'Nenhum. Previne dores lombares e compressão cervical.',
          status: 'ok',
          badge: '✅ EQUILIBRADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Distribuição de peso 40/60 correta entre mãos e selim com boa aerodinâmica.',
        });
      } else if (back < minB) {
        const delta = minB - Math.round(back);
        const lowCopy = copyFor('trunk', 'low');
        compliancePoints += 55;
        items.push({
          component: lowCopy?.component || 'Cockpit — Stack (Guiador/Espaçadores)',
          action: lowCopy?.action || 'Elevar guiador (+10 mm de espaçadores)',
          whatToDo: lowCopy?.whatToDo || 'Adicionar espaçadores (+10 a +15 mm) sob o avanço. NÃO alterar o comprimento do avanço (esse ajuste é avaliado pelo cotovelo).',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Devia ter: ${minB}° a ${maxB}° (Tronco ${delta}° demasiado deitado).`,
          why: lowCopy?.why || 'Elevar o guiador alivia a rotação excessiva da bacia e mantém a coluna lombar na sua lordose anatómica neutra.',
          harmDone: lowCopy?.harmDone || 'Pinçamento discal lombar severo (L4-L5 e L5-S1), hiperextensão cervical crónica para conseguir ver a estrada (dores de cabeça e contraturas) e dormência nos dedos por pressão excessiva no guiador.',
          status: 'warning',
          badge: '🟡 MUITO REBAIXADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Tronco excessivamente inclinado. Pode provocar tensão lombar, dor cervical e dormência nas mãos.',
        });
      } else {
        const delta = Math.round(back) - maxB;
        const highCopy = copyFor('trunk', 'high');
        compliancePoints += 65;
        items.push({
          component: highCopy?.component || 'Cockpit — Stack (Guiador/Espaçadores)',
          action: highCopy?.action || 'Baixar espaçadores (-5 mm a -10 mm)',
          whatToDo: highCopy?.whatToDo || 'Remover espaçadores sob o avanço (-5 a -10 mm). NÃO alterar o comprimento do avanço (esse ajuste é avaliado pelo cotovelo).',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Devia ter: ${minB}° a ${maxB}° (Tronco ${delta}° demasiado vertical).`,
          why: highCopy?.why || 'Uma ligeira inclinação frontal transfere peso para os membros superiores, aliviando a pressão vertical nos ísquios.',
          harmDone: highCopy?.harmDone || 'Concentra mais de 80% do peso nos ísquios e cóccix, transmitindo todas as pancadas do asfalto diretamente para a coluna vertebral sem o amortecimento dos braços.',
          status: 'warning',
          badge: '🟡 MUITO ERETO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Postura muito vertical, penalizando a aerodinâmica e sobrecarregando os ossos isquiáticos.',
        });
      }
    }

    // 4. AFINAÇÃO DO COCKPIT — REACH (comprimento do avanço) ← ângulo do cotovelo
    const armTarget = targets.elbow || [150, 165];
    const arm = liveAngles.braco;
    if (arm) {
      totalChecks++;
      const [minE, maxE] = armTarget;
      const elbowOkCopy = copyFor('elbow', 'ok');
      if (arm >= minE && arm <= maxE) {
        compliancePoints += 100;
        items.push({
          component: elbowOkCopy?.component || 'Cockpit — Reach (Avanço/Mesa)',
          action: elbowOkCopy?.action || 'Comprimento de avanço adequado',
          whatToDo: elbowOkCopy?.whatToDo || 'Manter a distância atual do cockpit.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Meta ergonómica: ${minE}° a ${maxE}°.`,
          why: elbowOkCopy?.why || 'A flexão de 15°-20° no cotovelo funciona como suspensão ativa, absorvendo vibrações da estrada antes de chegarem à coluna.',
          harmDone: elbowOkCopy?.harmDone || 'Nenhum. Ombros descontraídos e circulação sanguínea desobstruída nas mãos.',
          status: 'ok',
          badge: '✅ CONFORTÁVEL',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Ligeira flexão protetora do cotovelo para absorção de vibrações da estrada.',
        });
      } else if (arm > maxE) {
        const delta = Math.round(arm) - maxE;
        const elbowHighCopy = copyFor('elbow', 'high');
        compliancePoints += 45;
        items.push({
          component: elbowHighCopy?.component || 'Cockpit — Reach (Avanço/Mesa)',
          action: elbowHighCopy?.action || 'Encurtar avanço ~15-20 mm ou aproximar manetes',
          whatToDo: elbowHighCopy?.whatToDo || 'Substituir o avanço por um mais curto (15 a 20 mm menor) ou aproximar os manetes de travão.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Devia ter: ${minE}° a ${maxE}° (${delta}° de hiperextensão - braços bloqueados).`,
          why: elbowHighCopy?.why || 'Encurtar o cockpit permite fletir naturalmente os cotovelos, desarmando o bloqueio ósseo dos membros superiores.',
          harmDone: elbowHighCopy?.harmDone || 'Bloqueio articular transmite todos os impactos do solo para os ombros e cervical. Comprime o nervo ulnar e mediano no punho, causando dormência, formigueiro e perda de força nas mãos (Paralisia do Ciclista).',
          status: 'danger',
          badge: '🔴 BRAÇOS BLOQUEADOS',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Braços bloqueados em extensão total. Transmite impacto direto aos ombros e pescoço.',
        });
      } else {
        compliancePoints += 60;
        const elbowLowCopy = copyFor('elbow', 'low');
        items.push({
          component: elbowLowCopy?.component || 'Cockpit — Reach (Avanço/Mesa)',
          action: elbowLowCopy?.action || 'Alongar avanço ~10 mm para abrir cockpit',
          whatToDo: elbowLowCopy?.whatToDo || 'Alongar o avanço da mesa em cerca de 10 mm.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Devia ter: ${minE}° a ${maxE}° (Cotovelos excessivamente fletidos).`,
          why: elbowLowCopy?.why || 'Abre espaço no habitáculo para manobrar com estabilidade e respirar livremente.',
          harmDone: elbowLowCopy?.harmDone || 'Tensão isométrica contínua nos tríceps e bíceps, sensação de aperto e risco dos joelhos baterem nos cotovelos ao pedalar em pé.',
          status: 'warning',
          badge: '🟡 COCKPIT CURTO',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Cotovelos muito fletidos. Sensação de aperto no cockpit.',
        });
      }
    }

    // 5. AFINAÇÃO DA CABEÇA / CERVICAL
    const headTarget = targets.head;
    const head = liveAngles.cabeca;
    if (head && authority.head === 'descriptive') {
      // EM AERO a cabeça baixa é o OBJETIVO, não um desvio: não há alvo numérico que se aplique.
      items.push({
        component: 'Aero — Cabeça/Cervical',
        action: 'Sem alteração prescrita',
        whatToDo: 'Manter: em posição aero a cabeça baixa é parte do objetivo aerodinâmico. O que importa é manter a linha de visão à frente sem forçar o pescoço.',
        degreesInfo: `Inclinação medida: ${Math.round(head)}° (ombro→cabeça), sem alvo validado para aero.`,
        why: 'A evidência de posições aero descreve cabeça baixa e ombros à frente como característica da posição; não existe valor de corte validado para prescrever.',
        harmDone: 'Nenhum por não prescrever. O risco real (secundário) é a perda de campo de visão, que se avalia por observação e não por um ângulo inventado.',
        status: 'ok',
        badge: 'ℹ️ DESCRITIVO',
        measured: `${Math.round(head)}°`,
        target: null,
        detail: 'Medição descritiva: serve de registo, não de ordem de afinação.',
        descriptive: true,
      });
    } else if (head && headTarget) {
      totalChecks++;
      const [minH, maxH] = headTarget;
      if (head >= minH && head <= maxH) {
        compliancePoints += 100;
        items.push({
          component: 'Cabeça / Cervical',
          action: 'Manter alinhamento cervical',
          whatToDo: 'Manter a linha de visão natural a 15-20 metros à frente na estrada.',
          degreesInfo: `Ângulo medido: ${Math.round(head)}° | Meta ergonómica: ${minH}° a ${maxH}°.`,
          why: 'Preserva a curvatura neutra do pescoço sem compressão das vértebras cervicais.',
          harmDone: 'Nenhum. Boa irrigação vascular cerebral e desobstrução das vias respiratórias.',
          status: 'ok',
          badge: '✅ ALINHADO',
          measured: `${Math.round(head)}°`,
          target: `${minH}° - ${maxH}°`,
          detail: 'Alinhamento cervical neutro com campo de visão desimpedido.',
        });
      } else if (head > maxH) {
        const delta = Math.round(head) - maxH;
        compliancePoints += 50;
        items.push({
          component: 'Cabeça / Cervical',
          action: 'Relaxar queixo ou elevar guiador (+10 mm)',
          whatToDo: 'Relaxar o pescoço e baixar ligeiramente o queixo; se o guiador estiver muito baixo, subir o avanço.',
          degreesInfo: `Ângulo medido: ${Math.round(head)}° | Devia ter: ${minH}° a ${maxH}° (+${delta}° de sobre-extensão).`,
          why: 'Evita a hiperextensão do atlas e axis e diminui a tensão no trapézio superior.',
          harmDone: 'Compressão das raízes nervosas cervicais (C5-C7), dores de cabeça occipitais tensionais e espasmos no trapézio e romboides.',
          status: 'warning',
          badge: '🟡 HIPEREXTENSÃO',
          measured: `${Math.round(head)}°`,
          target: `${minH}° - ${maxH}°`,
          detail: 'Pescoço forçado para cima. Risco de contraturas cervicais e cefaleias tensionais.',
        });
      } else {
        const delta = minH - Math.round(head);
        compliancePoints += 60;
        items.push({
          component: 'Cabeça / Cervical',
          action: 'Elevar ligeiramente o queixo',
          whatToDo: 'Elevar a cabeça para manter o horizonte visual a 20 metros.',
          degreesInfo: `Ângulo medido: ${Math.round(head)}° | Devia ter: ${minH}° a ${maxH}° (-${delta}° descaído).`,
          why: 'Abre a traqueia para facilitar a ventilação e previne acidentes por falta de visão periférica.',
          harmDone: 'Redução do fluxo de oxigénio por estenose funcional da traqueia e perda de tempo de reação a obstáculos na estrada.',
          status: 'warning',
          badge: '🟡 CABEÇA DESCAÍDA',
          measured: `${Math.round(head)}°`,
          target: `${minH}° - ${maxH}°`,
          detail: 'Cabeça descaída sobre o guiador. Dificulta a respiração e reduz campo de visão.',
        });
      }
    }

    // 6. AFINAÇÃO DO TORNOZELO / TRAVESSÕES (CLEATS)
    const ankleTarget = targets.ankle || [70, 95];
    const ankle = liveAngles.tornozelo;
    if (ankle) {
      totalChecks++;
      const [minA, maxA] = ankleTarget;
      if (ankle >= minA && ankle <= maxA) {
        compliancePoints += 100;
        items.push({
          component: 'Tornozelo / Travessões (Cleats)',
          action: 'Posição do pé estável',
          whatToDo: 'Manter a afinação atual dos travessões nos sapatos.',
          degreesInfo: `Ângulo medido: ${Math.round(ankle)}° | Meta ergonómica: ${minA}° a ${maxA}°.`,
          why: 'Estabiliza a cadeia cinética inferior, permitindo transferir força sem perda mecânica na fáscia plantar.',
          harmDone: 'Nenhum. Tendão de Aquiles e gémeos trabalham em amplitude segura.',
          status: 'ok',
          badge: '✅ ESTÁVEL',
          measured: `${Math.round(ankle)}°`,
          target: `${minA}° - ${maxA}°`,
          detail: 'Ângulo de tornozelo fisiológico sem sobrecarga no tendão de Aquiles.',
        });
      } else if (ankle > maxA) {
        compliancePoints += 55;
        items.push({
          component: 'Tornozelo / Travessões (Cleats)',
          action: 'Recuar travessões ~3-5 mm ou descer selim',
          whatToDo: 'Recuar os travessões nos sapatos em direção ao calcanhar (3 a 5 mm) e verificar se o selim não está alto demais.',
          degreesInfo: `Ângulo medido: ${Math.round(ankle)}° | Devia ter: ${minA}° a ${maxA}° (Plantiflexão excessiva).`,
          why: 'Recuar o travessão encurta a alavanca no tendão de Aquiles e diminui a necessidade de pedalar na ponta dos pés.',
          harmDone: 'Tendinopatia crónica de Aquiles, sobrecarga excêntrica nos gémeos (cãibras frequentes) e dormência na planta do pé (metatarsalgia).',
          status: 'warning',
          badge: '🟡 PONTA DO PÉ',
          measured: `${Math.round(ankle)}°`,
          target: `${minA}° - ${maxA}°`,
          detail: 'Pedalada na ponta do pé (toe-dipping). Tensão elevada no tendão de Aquiles e gémeos.',
        });
      } else {
        compliancePoints += 60;
        items.push({
          component: 'Tornozelo / Travessões (Cleats)',
          action: 'Avançar travessões ~2-4 mm',
          whatToDo: 'Avançar ligeiramente os travessões nos sapatos ou verificar flexibilidade de tornozelo.',
          degreesInfo: `Ângulo medido: ${Math.round(ankle)}° | Devia ter: ${minA}° a ${maxA}° (Dorsiflexão excessiva / Calcanhar descaído).`,
          why: 'Nivela o pé durante o curso de potência nos 90° e BDC.',
          harmDone: 'Sobrecarga no tendão do tibial anterior e compressão do arco plantar com perda de potência de impulso.',
          status: 'warning',
          badge: '🟡 CALCANHAR BAIXO',
          measured: `${Math.round(ankle)}°`,
          target: `${minA}° - ${maxA}°`,
          detail: 'Calcanhar desce abaixo do eixo do pedal, sobrecarregando o tibial anterior.',
        });
      }
    }

    // 7. ANTEBRAÇO — alvo só existe na posição AERO (referência 0–20°, partida 5–10°)
    const forearmTarget = targets.antebraco;
    const forearm = liveAngles.antebraco;
    if (Array.isArray(forearmTarget) && typeof forearm === 'number') {
      totalChecks++;
      const [minF, maxF] = forearmTarget;
      let variant = 'ok';
      if (forearm > maxF) variant = 'high';
      else if (forearm < minF) variant = 'low';
      const forearmCopy = copyFor('forearm', variant) || {};
      compliancePoints += variant === 'ok' ? 100 : 50;
      items.push({
        component: forearmCopy.component || 'Aero — Antebraço',
        action: forearmCopy.action || 'Manter antebraço nivelado',
        whatToDo: forearmCopy.whatToDo || 'Manter o antebraço praticamente horizontal sobre as almofadas.',
        degreesInfo: `Ângulo medido: ${Math.round(forearm)}° face à horizontal | Meta em aero: ${minF}° a ${maxF}°.`,
        why: forearmCopy.why || 'O antebraço quase nivelado é a referência de tri/TT.',
        harmDone: forearmCopy.harmDone || 'Nenhum. Punhos e ombros descarregados.',
        status: variant === 'ok' ? 'ok' : 'warning',
        badge: variant === 'ok' ? '✅ NIVELADO' : '🟡 ANTEBRAÇO FORA DO PLANO',
        measured: `${Math.round(forearm)}°`,
        target: `${minF}° - ${maxF}°`,
        detail: 'Elevação do antebraço (cotovelo→punho) face à horizontal.',
      });
    }

    const score = totalChecks > 0 ? Math.round(compliancePoints / totalChecks) : 100;
    let verdict = 'Excelente Ajuste (Ótimo)';
    let verdictColor = '#10b981';
    if (score < 70) {
      verdict = 'Requer Afinações Imediatas';
      verdictColor = '#ef4444';
    } else if (score < 88) {
      verdict = 'Ajuste Aceitável (Afinações Ligeiras)';
      verdictColor = '#f59e0b';
    }

    return {
      score,
      verdict,
      verdictColor,
      items,
      isFullBody,
      rpm,
      psi,
      timestamp: new Date().toLocaleTimeString('pt-PT'),
      // Bloco de postura: com que perfil foi feita a análise, o que é prescritivo e com que fontes.
      posture: {
        id: posture,
        icon: mode.icon,
        label: mode.label,
        shortLabel: mode.shortLabel,
        summary: mode.summary,
        sources: mode.sources,
        targetsLine: formatTargetsLine(posture, targets),
        authority,
        detection: postureDetection,
      },
    };
  }

  /**
   * Converte o relatório num formato de texto legível para copiar para a área de transferência.
   */
  static formatTextSummary(report, athleteName = 'Ciclista', bikeModel = 'Bicicleta') {
    let txt = `========================================================\n`;
    txt += `  ATHLETE MOTION - GUIA CLÍNICO E RELATÓRIO DE AFINAÇÕES\n`;
    txt += `========================================================\n`;
    txt += `Atleta: ${athleteName} | Bicicleta: ${bikeModel}\nHora: ${report.timestamp}\n`;
    txt += `Conformidade Geral: ${report.score}% (${report.verdict})\n`;
    txt += `Cadência: ${report.rpm || '--'} RPM | Suavidade (PSI): ${report.psi}%\n`;
    if (report.posture?.targetsLine) {
      txt += `${report.posture.targetsLine}\n`;
      txt += `   Fonte dos alvos: ${(report.posture.sources || []).join(' · ')}\n`;
    }
    if (report.posture?.detection?.sufficient) {
      txt += `   Deteção automática: ${report.posture.detection.reasons.join(' | ')}\n`;
    }
    txt += `\n`;
    txt += `DIAGNÓSTICO E CORREÇÕES PASSO A PASSO:\n`;
    report.items.forEach((item, idx) => {
      txt += `--------------------------------------------------------\n`;
      txt += `${idx + 1}. [${item.component}] - ${item.badge}\n`;
      txt += `   🔧 O QUE FAZER: ${item.whatToDo}\n`;
      txt += `   📐 GRAUS RECOMENDADOS: ${item.degreesInfo}\n`;
      txt += `   💡 PORQUÊ: ${item.why}\n`;
      txt += `   ⚠️ O MAL QUE ESTÁ A FAZER: ${item.harmDone}\n`;
    });
    txt += `========================================================\n`;
    return txt;
  }

}

