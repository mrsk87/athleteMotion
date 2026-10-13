/**
 * Estimativas Biomecânicas Teóricas (SSOT) — calculadas APENAS a partir do que o atleta escreve.
 *
 * PORQUÊ ESTE FICHEIRO:
 * As estimativas estavam dentro do componente, com o formulário pré-preenchido com valores de
 * amostra. O resultado era o pior dos dois mundos: a aplicação dizia números antes de o atleta
 * ter introduzido os dados, e esses números não eram dele. Aqui a regra é explícita:
 *
 *   1. **Sem dado = sem número.** Cada estimativa só existe quando as entradas de que depende
 *      foram escritas. Nunca há um valor por omissão a fazer de resultado.
 *   2. **Fonte única.** As faixas (crenque, guiador) que a ajuda da aplicação documenta são
 *      exatamente as usadas aqui — não há duas verdades para o mesmo número.
 *   3. **Comparação com o que o atleta tem.** O valor recomendado só é útil ao lado do valor
 *      atual medido na bicicleta, com a tolerância declarada.
 *
 * FÓRMULAS (as mesmas que a ajuda explica em `theoreticalHelp.js`):
 * - Altura do selim (LeMond): cavalo × 0,883
 * - Altura do selim (109%, Hamley): cavalo × 1,09
 * - Tamanho de quadro: cavalo × 0,665
 * - Crenque: cavalo < 74 → 165 mm; 74–81 → 170 mm; 81–86 → 172,5 mm; > 86 → 175 mm
 * - Guiador (estrada/gravel/TT): biacromial arredondada ao valor comercial mais próximo
 *   (≤ 41 cm → 400 mm; 41–43 cm → 420 mm; > 43 cm → 440 mm)
 * - Guiador (MTB): a referência é 720–780 mm — largura de guiador plano, não a biacromial
 */

/** Cavalo mínimo (cm) para as estimativas fazerem sentido (abaixo disto é dado inválido). */
export const MIN_INSEAM_CM = 40;
/** Cavalo máximo aceite (cm) — protege contra erros de digitação. */
export const MAX_INSEAM_CM = 120;

/**
 * Tolerâncias declaradas para comparar a recomendação com a medida atual.
 * - Altura do selim e quadro: ±1,5 cm (meio tamanho de escala — abaixo disto é ruído de medição).
 * - Guiador: ±10 mm (um passo comercial: 400 / 420 / 440).
 * - Crenque: 0 mm — os comprimentos só existem em passos de 2,5 mm, logo qualquer diferença é um
 *   passo comercial diferente e deve ser vista, não tolerada.
 */
export const TOLERANCES = {
  saddleHeightCm: 1.5,
  frameSizeCm: 1.5,
  handlebarWidthMm: 10,
  crankLengthMm: 0,
};

/** Faixas de crenque por cavalo (cm) — idênticas às documentadas na ajuda. */
export const CRANK_BANDS_MM = [
  { upToInseamCm: 73.99, mm: 165 },
  { upToInseamCm: 81, mm: 170 },
  { upToInseamCm: 86, mm: 172.5 },
  { upToInseamCm: Infinity, mm: 175 },
];

/** Larguras comerciais de guiador de estrada (mm). */
export const DROP_BAR_WIDTHS_MM = { narrow: 400, standard: 420, wide: 440 };

/** Convenção documentada para guiador de MTB (largura plana, não biacromial). */
export const MTB_HANDLEBAR_RANGE_MM = [720, 780];

/** Modalidades com guiador plano (referência diferente da biacromial). */
export const FLAT_BAR_STYLES = ['mtb'];

/** Converte texto/numero do formulário num número válido, ou `null`. */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Arredonda a 1 decimal (evita 74.16999999999999). */
export function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Cavalo utilizável (dentro dos limites), ou `null`. */
export function usableInseam(inseamCm) {
  const inseam = toNumber(inseamCm);
  if (inseam === null || inseam < MIN_INSEAM_CM || inseam > MAX_INSEAM_CM) return null;
  return inseam;
}

/** Comprimento de crenque (mm) pela faixa de cavalo, ou `null` sem cavalo válido. */
export function crankLengthForInseam(inseamCm) {
  const inseam = usableInseam(inseamCm);
  if (inseam === null) return null;
  const band = CRANK_BANDS_MM.find((entry) => inseam <= entry.upToInseamCm);
  return band ? band.mm : null;
}

/**
 * Largura de guiador recomendada.
 * Em MTB devolve a faixa convencional (não há largura única) — `{ mm: null, rangeMm: [720, 780] }`.
 * Sem a largura biacromial não devolve nada: não se inventa um 420 por omissão.
 */
export function handlebarWidthFor(shoulderCm, ridingStyle = 'road') {
  if (FLAT_BAR_STYLES.includes(ridingStyle)) {
    return { mm: null, rangeMm: [...MTB_HANDLEBAR_RANGE_MM], conventional: true };
  }
  const shoulder = toNumber(shoulderCm);
  if (shoulder === null || shoulder <= 0) return null;
  // Arredondamento ao valor comercial MAIS PRÓXIMO (400 / 420 / 440), com as fronteiras a meio
  // caminho entre tamanhos: 41 cm e 43 cm. Antes a fronteira estava no próprio 40 cm, o que dava
  // 420 mm a quem tem 40 cm de ombros — exatamente o caso que o utilizador assinalou, e contra o
  // que a ajuda da aplicação documenta ("ombros ≈ 40 → 400 mm").
  if (shoulder <= 41) return { mm: DROP_BAR_WIDTHS_MM.narrow, rangeMm: null, conventional: false };
  if (shoulder <= 43) return { mm: DROP_BAR_WIDTHS_MM.standard, rangeMm: null, conventional: false };
  return { mm: DROP_BAR_WIDTHS_MM.wide, rangeMm: null, conventional: false };
}

/**
 * Estimativas completas a partir do formulário.
 *
 * @param {{ inseam_cm?: number|string, shoulder_width_cm?: number|string, riding_style?: string }} form
 * @returns {{ values: Object, ready: Object, missing: string[], any: boolean }}
 *          `values` usa os nomes que a interface e a sessão já consomem
 *          (`lemond_saddle_height_cm`, `hamley_109_saddle_height_cm`, ...).
 */
export function computeTheoreticalEstimates(form = {}) {
  const inseam = usableInseam(form.inseam_cm);
  const handlebar = handlebarWidthFor(form.shoulder_width_cm, form.riding_style);

  const values = {
    lemond_saddle_height_cm: inseam === null ? null : round1(inseam * 0.883),
    hamley_109_saddle_height_cm: inseam === null ? null : round1(inseam * 1.09),
    estimated_frame_size_cm: inseam === null ? null : round1(inseam * 0.665),
    recommended_crank_length_mm: inseam === null ? null : crankLengthForInseam(inseam),
    recommended_handlebar_width_mm: handlebar ? handlebar.mm : null,
    recommended_handlebar_range_mm: handlebar ? handlebar.rangeMm : null,
    handlebar_is_convention: Boolean(handlebar && handlebar.conventional),
  };

  const ready = {
    saddleHeight: values.lemond_saddle_height_cm !== null,
    frameSize: values.estimated_frame_size_cm !== null,
    crankLength: values.recommended_crank_length_mm !== null,
    handlebarWidth: Boolean(handlebar),
  };

  // Campos que ainda faltam, na ordem em que aparecem no formulário.
  const missing = [];
  if (inseam === null) missing.push('inseam_cm');
  if (!handlebar) missing.push('shoulder_width_cm');

  return {
    values,
    ready,
    missing,
    any: Object.values(ready).some(Boolean),
  };
}

/**
 * Compara a recomendação com a medida que o atleta diz ter na bicicleta.
 * Devolve `null` se faltar um dos lados — sem comparação inventada.
 *
 * @param {{ recommended: number|string, current: number|string, tolerance: number }} params
 */
export function compareWithCurrent({ recommended, current, tolerance }) {
  const rec = toNumber(recommended);
  const cur = toNumber(current);
  if (rec === null || cur === null || !Number.isFinite(tolerance)) return null;
  const delta = round1(cur - rec);
  return {
    recommended: rec,
    current: cur,
    delta,
    tolerance,
    withinTolerance: Math.abs(delta) <= tolerance,
  };
}
