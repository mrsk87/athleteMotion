/**
 * Histórico de PERFIS DO ATLETA (os 5 últimos utilizados).
 *
 * O pedido do utilizador:
 *   "ao preencher os dados na primeira vez, guardar até 5 perfis no histórico,
 *    últimos utilizados, ao clicar, auto preencher"
 *
 * Regras:
 * - Guarda-se no `localStorage` do dispositivo (IndexedDB é para sessões de análise; isto é
 *   apenas uma lista pequena de conveniência e tem de estar disponível de forma síncrona
 *    ao abrir o formulário).
 * - No máximo `MAX_PROFILES` (5). Cada submissão com um nome já existente ATUALIZA esse perfil
 *   e sobe-o ao topo, em vez de criar um duplicado.
 * - As funções são PURAS em relação ao armazenamento: só `loadProfiles`/`persistProfiles`
 *   tocam no `localStorage`, e este é injetado. Assim podem testar-se sem navegador
 *   (`npm run verify:profiles`).
 * - Um perfil sem nome não é guardado (não haveria como o identificar no histórico).
 */

export const PROFILE_STORAGE_KEY = 'athletemotion:onboarding-profiles:v1';
export const MAX_PROFILES = 5;

/** Campos do formulário que viajam para o histórico (exatamente os que se auto-preenchem). */
export const PROFILE_FIELDS = [
  'name',
  // Peso, sapato e cintura fazem parte do perfil: são pedidos no início e têm de voltar
  // preenchidos quando o atleta reutiliza um perfil do histórico.
  'weight_kg',
  'shoe_size_eu',
  'waist_cm',
  'height_cm',
  'inseam_cm',
  'shoulder_width_cm',
  'flexibility',
  'riding_style',
  'brand_model',
  'current_saddle_height_cm',
  'frame_size_cm',
  'top_tube_mm',
  'handlebar_width_mm',
  'handlebar_reach_mm',
  'handlebar_drop_mm',
  'stem_length_mm',
  'crank_length_mm',
  'cleat_position',
];

/** Chave de identidade: o nome normalizado (sem espaços a mais, minúsculas). */
export const normalizeName = (name) => String(name || '').trim().toLowerCase();

/** Aceita número válido ou devolve `null` (nunca `NaN`, nunca string vazia com significado). */
const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Extrai do formulário apenas os campos do perfil, com números já normalizados. */
export function pickProfile(form = {}) {
  const profile = {};
  PROFILE_FIELDS.forEach((field) => {
    if (
      field === 'name' ||
      field === 'flexibility' ||
      field === 'riding_style' ||
      field === 'brand_model' ||
      field === 'cleat_position'
    ) {
      profile[field] = String(form[field] ?? '').trim();
    } else {
      profile[field] = toNumberOrNull(form[field]);
    }
  });
  return profile;
}

/** Limpa um registo vindo do armazenamento: sem nome (ou tipo errado) é descartado. */
export function sanitizeProfile(raw, savedAt = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const profile = pickProfile(raw);
  if (!profile.name) return null;
  const id = normalizeName(profile.name);
  return {
    ...profile,
    id,
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : savedAt,
  };
}

/** Armazenamento por omissão do navegador; `undefined` fora dele (SSR / testes). */
const defaultStorage = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

/** Lê o histórico do armazenamento, já limpo e limitado a `MAX_PROFILES`. */
export function loadProfiles(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem?.(PROFILE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => sanitizeProfile(entry))
      .filter(Boolean)
      .slice(0, MAX_PROFILES);
  } catch {
    // Histórico corrompido ou `localStorage` bloqueado: falha em silêncio, sem partir o formulário.
    return [];
  }
}

/** Escreve o histórico. Devolve `true`/`false` em vez de lançar. */
export function persistProfiles(profiles, storage = defaultStorage()) {
  try {
    storage?.setItem?.(PROFILE_STORAGE_KEY, JSON.stringify(profiles || []));
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarda o formulário como perfil e devolve o histórico novo:
 * - o perfil atualizado (ou novo) fica em primeiro (mais recente),
 * - um nome repetido ATUALIZA em vez de duplicar,
 * - a lista nunca passa de `MAX_PROFILES`.
 */
export function saveProfile(profiles, form, savedAt = Date.now()) {
  const current = Array.isArray(profiles) ? profiles : [];
  const profile = pickProfile(form);
  if (!profile.name) {
    return { profiles: [...current], saved: false, reason: 'no-name', entry: null };
  }
  const id = normalizeName(profile.name);
  const entry = { ...profile, id, savedAt };
  const others = current.filter((item) => item.id !== id && normalizeName(item.name) !== id);
  const next = [entry, ...others].slice(0, MAX_PROFILES);
  return { profiles: next, saved: true, entry, replaced: others.length !== current.length };
}

/** Move um perfil para o topo (marca-o como o último utilizado). */
export function touchProfile(profiles, id) {
  const current = Array.isArray(profiles) ? profiles : [];
  const entry = current.find((item) => item.id === id);
  if (!entry) return [...current];
  return [entry, ...current.filter((item) => item.id !== id)];
}

/** Remove um perfil do histórico. */
export function removeProfile(profiles, id) {
  const current = Array.isArray(profiles) ? profiles : [];
  return current.filter((item) => item.id !== id);
}

/** Copia o perfil para o formulário reativo (só os campos conhecidos). */
export function applyProfile(form, profile) {
  if (!form || !profile) return form;
  PROFILE_FIELDS.forEach((field) => {
    if (profile[field] !== undefined) form[field] = profile[field];
  });
  return form;
}

/** Linha curta com as medidas-chave, para o chip do histórico. */
export function profileSummary(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.height_cm) parts.push(`${profile.height_cm} cm`);
  if (profile.weight_kg) parts.push(`${profile.weight_kg} kg`);
  if (profile.inseam_cm) parts.push(`cavalo ${profile.inseam_cm}`);
  if (profile.frame_size_cm) parts.push(`quadro ${profile.frame_size_cm}`);
  return parts.join(' · ');
}
