/**
 * Calculador de Assimetria Bilateral (Lado Esquerdo vs Lado Direito).
 *
 * Fórmula de Índice de Simetria (Symmetry Index - SI):
 * SI = (|V_esq - V_dir| / ((V_esq + V_dir) / 2)) * 100
 *
 * Classificação clínica no BikeFit:
 * - SI <= 2%: Excelente simetria fisiológica
 * - 2% < SI <= 4%: Assimetria ligeira (verificar colocação de taquinhos)
 * - SI > 4%: Assimetria significativa (alerta para dismetria de membros ou calços de taquinho / shims)
 */
export class AsymmetryCalculator {
  static calculateSi(leftValue, rightValue) {
    if (leftValue === null || rightValue === null || leftValue === undefined || rightValue === undefined) {
      return null;
    }

    const mean = (leftValue + rightValue) / 2;
    if (mean === 0) return 0;

    const si = (Math.abs(leftValue - rightValue) / mean) * 100;
    return Math.round(si * 10) / 10;
  }

  static analyzeJoint(jointName, leftValue, rightValue) {
    const si = this.calculateSi(leftValue, rightValue);
    if (si === null) return null;

    const diff = Math.round(Math.abs(leftValue - rightValue) * 10) / 10;
    let classification = 'excellent';
    let labelPt = 'Excelente Simetria';
    let labelEn = 'Excellent Symmetry';
    let alertClass = 'success';
    let recommendationPt = `Excelente equilíbrio bilateral em ${jointName} (diferença de apenas ${diff}°).`;
    let recommendationEn = `Excellent bilateral balance in ${jointName} (difference of only ${diff}°).`;

    if (si > 4.0) {
      classification = 'significant';
      labelPt = 'Assimetria Significativa';
      labelEn = 'Significant Asymmetry';
      alertClass = 'danger';

      const sideLower = rightValue < leftValue ? 'direita' : 'esquerda';
      const sideLowerEn = rightValue < leftValue ? 'right' : 'left';
      recommendationPt = `Discrepância acentuada de ${diff}° (SI: ${si}%). A perna ${sideLower} estende menos no ponto morto inferior. Recomenda-se avaliar dismetria ou instalar calço de 1-2mm sob o taquinho da perna ${sideLower}.`;
      recommendationEn = `Significant discrepancy of ${diff}° (SI: ${si}%). The ${sideLowerEn} leg achieves less extension. Clinical evaluation or installing a 1-2mm cleat shim on the ${sideLowerEn} shoe is recommended.`;
    } else if (si > 2.0) {
      classification = 'mild';
      labelPt = 'Assimetria Ligeira';
      labelEn = 'Mild Asymmetry';
      alertClass = 'warning';
      recommendationPt = `Assimetria ligeira de ${diff}° em ${jointName}. Verificar se os taquinhos dos sapatos estão simétricos.`;
      recommendationEn = `Mild asymmetry of ${diff}° in ${jointName}. Check if shoe cleat positions are symmetrical.`;
    }

    return {
      joint: jointName,
      leftValue: Math.round(leftValue * 10) / 10,
      rightValue: Math.round(rightValue * 10) / 10,
      si,
      diff,
      classification,
      labelPt,
      labelEn,
      alertClass,
      recommendationPt,
      recommendationEn,
    };
  }

  static compareProfiles(leftProfileData, rightProfileData) {
    const results = [];

    const joints = [
      { key: 'knee', namePt: 'Joelho', nameEn: 'Knee' },
      { key: 'back', namePt: 'Costas / Tronco', nameEn: 'Back / Torso' },
      { key: 'arm', namePt: 'Braço / Cotovelo', nameEn: 'Arm / Elbow' },
      { key: 'ankle', namePt: 'Tornozelo', nameEn: 'Ankle' },
    ];

    for (const j of joints) {
      const leftVal = leftProfileData[j.key];
      const rightVal = rightProfileData[j.key];
      if (leftVal && rightVal) {
        const res = this.analyzeJoint(j.namePt, leftVal, rightVal);
        if (res) results.push(res);
      }
    }

    return results;
  }
}

