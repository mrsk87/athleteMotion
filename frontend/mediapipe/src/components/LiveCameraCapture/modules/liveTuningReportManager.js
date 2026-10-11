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
          status: 'ok',
          badge: '✅ IDEAL',
          measured: `${Math.round(knee)}°`,
          target: `${minK}° - ${maxK}°`,
          detail: 'Extensão ótima no Ponto Morto Inferior (BDC). Previne sobrecargas patelares e garante pico de binário.',
        });
      } else if (knee < minK) {
        const deltaDeg = minK - knee;
        const mm = Math.min(25, Math.max(3, Math.round(deltaDeg * 2.3)));
        const isCritical = knee < 140;
        compliancePoints += isCritical ? 20 : 60;
        items.push({
          component: 'Altura do Selim',
          action: `Subir selim ~${mm} mm`,
          status: isCritical ? 'danger' : 'warning',
          badge: isCritical ? '🔴 MUITO BAIXO' : '🟡 BAIXO',
          measured: `${Math.round(knee)}°`,
          target: `${minK}° - ${maxK}°`,
          detail: `Joelho excessivamente fletido (${Math.round(knee)}°). Elevar o espigão para atingir pelo menos 145° e aliviar o tendão rotuliano.`,
        });
      } else {
        const deltaDeg = knee - maxK;
        const mm = Math.min(25, Math.max(3, Math.round(deltaDeg * 2.5)));
        const isCritical = knee > 160;
        compliancePoints += isCritical ? 20 : 60;
        items.push({
          component: 'Altura do Selim',
          action: `Descer selim ~${mm} mm`,
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
          status: 'ok',
          badge: '✅ EQUILIBRADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Distribuição de peso 40/60 correta entre mãos e selim com boa aerodinâmica.',
        });
      } else if (back < minB) {
        compliancePoints += 55;
        items.push({
          component: 'Cockpit / Guiador (Stack & Reach)',
          action: 'Elevar guiador (+10 mm espaçador) ou encurtar mesa',
          status: 'warning',
          badge: '🟡 MUITO REBAIXADO',
          measured: `${Math.round(back)}°`,
          target: `${minB}° - ${maxB}°`,
          detail: 'Tronco excessivamente inclinado. Pode provocar tensão lombar, dor cervical e dormência nas mãos.',
        });
      } else {
        compliancePoints += 65;
        items.push({
          component: 'Cockpit / Guiador (Stack & Reach)',
          action: 'Baixar espaçadores (-5 mm a -10 mm) ou alongar mesa',
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
          status: 'ok',
          badge: '✅ CONFORTÁVEL',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Ligeira flexão protetora do cotovelo para absorção de vibrações da estrada.',
        });
      } else if (arm > maxE) {
        compliancePoints += 45;
        items.push({
          component: 'Alcance dos Braços / Mesa',
          action: 'Encurtar mesa ~10-20 mm ou aproximar manetes',
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
          status: 'warning',
          badge: '🟡 COCKPIT CURTO',
          measured: `${Math.round(arm)}°`,
          target: `${minE}° - ${maxE}°`,
          detail: 'Cotovelos muito fletidos. Sensação de aperto no cockpit.',
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
    let txt = `========================================\n`;
    txt += `  ATHLETE MOTION - RELATÓRIO DE AFINAÇÕES\n`;
    txt += `========================================\n`;
    txt += `Atleta: ${athleteName}\nBicicleta: ${bikeModel}\nHora: ${report.timestamp}\n`;
    txt += `Score Geral de Ajuste: ${report.score}% (${report.verdict})\n`;
    txt += `Cadência: ${report.rpm || '--'} RPM | Suavidade (PSI): ${report.psi}%\n\n`;
    txt += `AFINAÇÕES MECÂNICAS RECOMENDADAS:\n`;
    report.items.forEach((item, idx) => {
      txt += `${idx + 1}. [${item.component}] - ${item.badge}\n`;
      txt += `   Medido: ${item.measured} (Meta: ${item.target})\n`;
      txt += `   Intervenção: ${item.action}\n`;
      txt += `   Explicação: ${item.detail}\n\n`;
    });
    txt += `========================================\n`;
    return txt;
  }
}
