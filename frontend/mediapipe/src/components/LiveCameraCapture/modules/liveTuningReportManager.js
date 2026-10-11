/**
 * Gestor do Relatório de Afinações Biomecânicas em Tempo Real (LiveTuningReportManager).
 *
 * Responsabilidade:
 * - Converter ângulos medidos (Joelho no BDC, KOPS, Tronco, Braço) em recomendações práticas de afinação mecânica (mm e cm).
 * - Calcular pontuação global de conformidade ergonómica (0-100%).
 * - Formatar texto estruturado para cópia e geração de janela de impressão/PDF.
 */

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
  }) {
    const items = [];
    let compliancePoints = 0;
    let totalChecks = 0;

    // 1. AFINAÇÃO DA ALTURA DO SELIM (BDC Knee Extension)
    const kneeTarget = targets.knee || [145, 155];
    const knee = bdcKneeAngle || liveAngles.joelho;
    if (knee) {
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

    // 2. AFINAÇÃO DO RECUO / AVANÇO DO SELIM (KOPS)
    if (kopsResult && typeof kopsResult.offsetMm === 'number') {
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
    }

    // 3. AFINAÇÃO DO COCKPIT (Tronco / Inclinação do Guiador)
    const backTarget = targets.back || [40, 50];
    const back = liveAngles.costas;
    if (back) {
      totalChecks++;
      const [minB, maxB] = backTarget;
      if (back >= minB && back <= maxB) {
        compliancePoints += 100;
        items.push({
          component: 'Cockpit / Inclinação do Tronco',
          action: 'Manter altura de espaçadores',
          whatToDo: 'Manter a altura atual do guiador e comprimento do avanço/mesa.',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Meta ergonómica: ${minB}° a ${maxB}°.`,
          why: 'Equilibra o centro de massa, distribuindo 60% do peso corporal no selim e 40% no guiador com curvatura lombar neutra.',
          harmDone: 'Nenhum. Previne dores lombares e compressão cervical.',
          status: 'ok',
          badge: '✅ EQUILIBRADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Distribuição de peso 40/60 correta entre mãos e selim com boa aerodinâmica.',
        });
      } else if (back < minB) {
        const delta = minB - Math.round(back);
        compliancePoints += 55;
        items.push({
          component: 'Cockpit / Guiador (Stack & Reach)',
          action: 'Elevar guiador (+10 mm espaçador) ou encurtar mesa',
          whatToDo: 'Adicionar espaçadores (+10 a +15 mm) sob o avanço da mesa ou encurtar a mesa em 10 mm.',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Devia ter: ${minB}° a ${maxB}° (Tronco ${delta}° demasiado deitado).`,
          why: 'Elevar o guiador alivia a rotação excessiva da bacia e mantém a coluna lombar na sua lordose anatómica neutra.',
          harmDone: 'Pinçamento discal lombar severo (L4-L5 e L5-S1), hiperextensão cervical crónica para conseguir ver a estrada (dores de cabeça e contraturas) e dormência nos dedos por pressão excessiva no guiador.',
          status: 'warning',
          badge: '🟡 MUITO REBAIXADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Tronco excessivamente inclinado. Pode provocar tensão lombar, dor cervical e dormência nas mãos.',
        });
      } else {
        const delta = Math.round(back) - maxB;
        compliancePoints += 65;
        items.push({
          component: 'Cockpit / Guiador (Stack & Reach)',
          action: 'Baixar espaçadores (-5 mm a -10 mm) ou alongar mesa',
          whatToDo: 'Remover espaçadores sob o avanço (-5 a -10 mm) ou optar por um avanço ligeiramente mais longo.',
          degreesInfo: `Ângulo medido: ${Math.round(back)}° | Devia ter: ${minB}° a ${maxB}° (Tronco ${delta}° demasiado vertical).`,
          why: 'Uma ligeira inclinação frontal transfere peso para os membros superiores, aliviando a pressão vertical nos ísquios.',
          harmDone: 'Concentra mais de 80% do peso nos ísquios e cóccix, transmitindo todas as pancadas do asfalto diretamente para a coluna vertebral sem o amortecimento dos braços.',
          status: 'warning',
          badge: '🟡 MUITO ERETO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Postura muito vertical, penalizando a aerodinâmica e sobrecarregando os ossos isquiáticos.',
        });
      }
    }

    // 4. AFINAÇÃO DO ALCANCE DOS BRAÇOS (Cotovelo / Mesa)
    const armTarget = targets.elbow || [150, 165];
    const arm = liveAngles.braco;
    if (arm) {
      totalChecks++;
      const [minE, maxE] = armTarget;
      if (arm >= minE && arm <= maxE) {
        compliancePoints += 100;
        items.push({
          component: 'Alcance dos Braços / Cotovelo',
          action: 'Comprimento de mesa adequado',
          whatToDo: 'Manter a distância atual do cockpit.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Meta ergonómica: ${minE}° a ${maxE}°.`,
          why: 'A flexão de 15°-20° no cotovelo funciona como suspensão ativa, absorvendo vibrações da estrada antes de chegarem à coluna.',
          harmDone: 'Nenhum. Ombros descontraídos e circulação sanguínea desobstruída nas mãos.',
          status: 'ok',
          badge: '✅ CONFORTÁVEL',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Ligeira flexão protetora do cotovelo para absorção de vibrações da estrada.',
        });
      } else if (arm > maxE) {
        const delta = Math.round(arm) - maxE;
        compliancePoints += 45;
        items.push({
          component: 'Alcance dos Braços / Mesa',
          action: 'Encurtar mesa ~15-20 mm ou aproximar manetes',
          whatToDo: 'Substituir o avanço por um mais curto (15 a 20 mm menor) ou aproximar os manetes de travão.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Devia ter: ${minE}° a ${maxE}° (${delta}° de hiperextensão - braços bloqueados).`,
          why: 'Encurtar o cockpit permite fletir naturalmente os cotovelos, desarmando o bloqueio ósseo dos membros superiores.',
          harmDone: 'Bloqueio articular transmite todos os impactos do solo para os ombros e cervical. Comprime o nervo ulnar e mediano no punho, causando dormência, formigueiro e perda de força nas mãos (Paralisia do Ciclista).',
          status: 'danger',
          badge: '🔴 BRAÇOS BLOQUEADOS',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Braços bloqueados em extensão total. Transmite impacto direto aos ombros e pescoço.',
        });
      } else {
        compliancePoints += 60;
        items.push({
          component: 'Alcance dos Braços / Mesa',
          action: 'Alongar mesa ~10 mm para abrir cockpit',
          whatToDo: 'Alongar o avanço da mesa em cerca de 10 mm.',
          degreesInfo: `Ângulo medido: ${Math.round(arm)}° | Devia ter: ${minE}° a ${maxE}° (Cotovelos excessivamente fletidos).`,
          why: 'Abre espaço no habitáculo para manobrar com estabilidade e respirar livremente.',
          harmDone: 'Tensão isométrica contínua nos tríceps e bíceps, sensação de aperto e risco dos joelhos baterem nos cotovelos ao pedalar em pé.',
          status: 'warning',
          badge: '🟡 COCKPIT CURTO',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Cotovelos muito fletidos. Sensação de aperto no cockpit.',
        });
      }
    }

    // 5. AFINAÇÃO DA CABEÇA / CERVICAL
    const headTarget = targets.head || [35, 55];
    const head = liveAngles.cabeca;
    if (head) {
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
    txt += `Cadência: ${report.rpm || '--'} RPM | Suavidade (PSI): ${report.psi}%\n\n`;
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
