/**
 * Verificação automática do HISTÓRICO DE PERFIS DO ATLETA e da ORDEM DO TAB.
 *
 * Executar com:  npm run verify:profiles
 *
 * O pedido do utilizador que este ficheiro trava:
 *   "guardar até 5 perfis no histórico, últimos utilizados, ao clicar, auto preencher"
 *   "ao dar tab na página inicial deve passar de textbox para textbox"
 *
 * Prova-se, sem navegador:
 *  1. O histórico guarda no máximo 5 perfis, o mais recente em primeiro.
 *  2. Um nome repetido ATUALIZA o perfil (sem duplicar) e sobe-o ao topo.
 *  3. Um perfil sem nome não é guardado.
 *  4. Um histórico corrompido não parte o formulário (devolve lista vazia).
 *  5. `applyProfile` copia os campos para o formulário; `removeProfile` apaga um.
 *  6. O selo de ajuda "?" fica FORA da ordem do Tab (tabindex="-1") — o Tab anda de campo em campo.
 *  7. O componente carrega o histórico, guarda na submissão e liga os cliques (usar / esquecer).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_PROFILES,
  PROFILE_STORAGE_KEY,
  applyProfile,
  loadProfiles,
  normalizeName,
  persistProfiles,
  profileSummary,
  removeProfile,
  saveProfile,
  touchProfile,
} from '../src/components/AthleteOnboarding/modules/athleteProfiles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('== 1. Guardar até 5 perfis, mais recente em primeiro ==');
let profiles = [];
for (let i = 1; i <= 7; i += 1) {
  const result = saveProfile(profiles, { name: `Atleta ${i}`, height_cm: 170 + i, inseam_cm: 80 + i }, 1000 + i);
  profiles = result.profiles;
}
check(`a lista fica limitada a ${MAX_PROFILES}`, profiles.length === MAX_PROFILES, String(profiles.length));
check('o mais recente é o primeiro', profiles[0].name === 'Atleta 7');
check('o mais antigo foi descartado', !profiles.some((p) => p.name === 'Atleta 2'));
check('o mais antigo presente é o 3', profiles[profiles.length - 1].name === 'Atleta 3');

console.log('\n== 2. Nome repetido atualiza (sem duplicar) e sobe ao topo ==');
const updated = saveProfile(profiles, { name: 'atleta 5', height_cm: 199, inseam_cm: 90 }, 2000);
check('continua com 5 perfis', updated.profiles.length === MAX_PROFILES);
check('não há duplicados do mesmo nome', updated.profiles.filter((p) => normalizeName(p.name) === 'atleta 5').length === 1);
check('o perfil atualizado subiu ao topo', updated.profiles[0].name.toLowerCase() === 'atleta 5');
check('os dados novos substituíram os antigos', updated.profiles[0].height_cm === 199);
check('marcou `replaced`', updated.replaced === true);

console.log('\n== 3. Sem nome não se guarda ==');
const noName = saveProfile(profiles, { name: '   ', height_cm: 180 }, 3000);
check('devolve a lista intacta', noName.profiles.length === profiles.length);
check('assinala `saved: false`', noName.saved === false && noName.reason === 'no-name');

console.log('\n== 4. Armazenamento corrompido não parte o formulário ==');
const brokenStorage = { getItem: () => '{isto não é json', setItem: () => {} };
check('JSON inválido → lista vazia', loadProfiles(brokenStorage).length === 0);
const wrongType = { getItem: () => '{"a":1}', setItem: () => {} };
check('tipo errado → lista vazia', loadProfiles(wrongType).length === 0);
const throwingStorage = { getItem: () => { throw new Error('bloqueado'); } };
check('armazenamento bloqueado → lista vazia', loadProfiles(throwingStorage).length === 0);

console.log('\n== 5. Persistir, auto-preencher e remover ==');
const memory = new Map();
const fakeStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, value),
};
persistProfiles(updated.profiles, fakeStorage);
const reloaded = loadProfiles(fakeStorage);
check('o que se grava é o que se lê', reloaded.length === updated.profiles.length && reloaded[0].name.toLowerCase() === 'atleta 5');
check('a gravação usa a chave estável', memory.has(PROFILE_STORAGE_KEY));

const form = { name: '', height_cm: null, frame_size_cm: null, crank_length_mm: null };
applyProfile(form, reloaded[0]);
check('auto-preencher copia o nome', form.name.toLowerCase() === 'atleta 5');
check('auto-preencher copia os números', form.height_cm === 199);

const touched = touchProfile(reloaded, reloaded[2].id);
check('tocar num perfil põe-no em primeiro', touched[0].id === reloaded[2].id);

const afterRemove = removeProfile(touched, touched[0].id);
check('remover tira o perfil', afterRemove.length === touched.length - 1 && !afterRemove.some((p) => p.id === touched[0].id));

console.log('\n== 6. Resumo curto com as medidas-chave ==');
check('o resumo junta altura, cavalo e quadro', profileSummary({ height_cm: 180, inseam_cm: 84, frame_size_cm: 54 }) === '180 cm · cavalo 84 · quadro 54');
check('sem dados devolve vazio', profileSummary(null) === '');

console.log('\n== 7. O Tab anda de caixa em caixa (selo "?" fora da ordem) ==');
const helpHtml = read('src/components/common/HelpTip/HelpTip.html');
check('o selo de ajuda tem tabindex="-1"', /class="help-tip-badge"\s*\n\s*tabindex="-1"/.test(helpHtml));

console.log('\n== 8. O formulário liga o histórico ==');
const component = read('src/components/AthleteOnboarding/AthleteOnboarding.js');
const template = read('src/components/AthleteOnboarding/AthleteOnboarding.html');
check('importa o módulo de perfis', component.includes("from './modules/athleteProfiles'"));
check('carrega o histórico ao montar', component.includes('profiles.value = loadProfiles()') && component.includes('onMounted'));
check('guarda o perfil ao submeter', component.includes('saveProfile(profiles.value, form)'));
check('persiste o histórico', component.includes('persistProfiles(profiles.value)'));
check('preenche o formulário ao clicar', component.includes('applyProfile(form, profile)') && component.includes('useProfile'));
check('permite esquecer um perfil', component.includes('forgetProfile'));
check('o painel de perfis existe no template', template.includes('class="profiles-panel"') && template.includes('v-for="profile in profiles"'));
check('cada chip chama `useProfile`', template.includes('@click="useProfile(profile.id)"'));
check('cada chip tem botão de remover', template.includes('@click="forgetProfile(profile.id)"'));
check('há rótulos traduzidos para o painel', template.includes("t('profilesTitle')") && template.includes("t('profilesHint')"));

console.log('\n== 9. Peso, número de sapato e cintura são pedidos no INÍCIO (passo 1) ==');
check('o formulário do passo 1 tem os três campos novos',
  ['id="weight"', 'id="shoe_size"', 'id="waist"'].every((id) => template.includes(id)));
check('o peso e o número de sapato são obrigatórios (com o resto da antropometria)',
  /id="weight"[\s\S]{0,220}required/.test(template) && /id="shoe_size"[\s\S]{0,220}required/.test(template));
check('a cintura é recolhida sem bloquear o avanço (contexto, não alvo)',
  /id="waist"[\s\S]{0,220}min="50"/.test(template) && !/id="waist"[\s\S]{0,220}required/.test(template));
check('cada campo novo usa a ajuda contextual (o "?" explica o que é e como se mede)',
  ['help.weight', 'help.shoeSize', 'help.waist'].every((binding) => template.includes(binding)));
check('os três campos estão ANTES da altura e do cavalo no formulário',
  template.indexOf('id="weight"') < template.indexOf('id="height"') &&
    template.indexOf('id="shoe_size"') < template.indexOf('id="height"') &&
    template.indexOf('id="waist"') < template.indexOf('id="height"'));
check('o estado do formulário guarda os três valores',
  ['weight_kg: null', 'shoe_size_eu: null', 'waist_cm: null'].every((field) => component.includes(field)));
check('a submissão recusa avançar sem peso e sem número de sapato',
  component.includes('fillWeightShoeFields') && /!form\.weight_kg \|\| !form\.shoe_size_eu/.test(component));
check('o perfil do passo 1 viaja na sessão para o passo 2',
  component.includes('athleteProfile: anthropometryProfile()'));
check('os dois caminhos (online e modo local) levam o perfil',
  (component.match(/athleteProfile: anthropometryProfile\(\)/g) || []).length === 2);
check('o perfil enviado usa as chaves que o passo 2 lê',
  ['weightKg: form.weight_kg', 'shoeSizeEu: form.shoe_size_eu', 'waistCm: form.waist_cm'].every((line) => component.includes(line)));

console.log('\n== 10. O histórico guarda e devolve os três campos novos ==');
const saved = saveProfile([], {
  name: 'Atleta Cintura',
  weight_kg: 78.5,
  shoe_size_eu: 43,
  waist_cm: 84,
  height_cm: 178,
  inseam_cm: 83,
});
check('os três campos ficam no perfil guardado',
  saved.entry.weight_kg === 78.5 && saved.entry.shoe_size_eu === 43 && saved.entry.waist_cm === 84,
  JSON.stringify(saved.entry));
const reused = {};
applyProfile(reused, saved.entry);
check('auto-preencher devolve peso, sapato e cintura ao formulário',
  reused.weight_kg === 78.5 && reused.shoe_size_eu === 43 && reused.waist_cm === 84);
check('o resumo do chip mostra o peso e a cintura',
  profileSummary({ height_cm: 178, weight_kg: 78.5, inseam_cm: 83, frame_size_cm: 54, waist_cm: 84 }) ===
    '178 cm · 78.5 kg · cavalo 83 · quadro 54');
check('sem peso nem cintura o resumo mantém-se igual ao de antes',
  profileSummary({ height_cm: 180, inseam_cm: 84, frame_size_cm: 54 }) === '180 cm · cavalo 84 · quadro 54');

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
