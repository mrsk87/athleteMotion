/**
 * Controlador de Lógica de Negócio para o Formulário de Onboarding Inicial (Etapa 1).
 *
 * Responsabilidade:
 * - Recolher e validar dados antropométricos do ciclista (altura, cavalo, ombros, flexibilidade, modalidade).
 * - Recolher dimensões mecânicas da bicicleta (quadro, guiador, avanço, crenques, altura de selim atual).
 * - Calcular estimativas teóricas em tempo real a partir DESSES dados (módulo `theoreticalEstimates`).
 * - Persistir ciclista e bicicleta no backend via transação ACID ou fallback local.
 *
 * REGRA DAS ESTIMATIVAS (o que mudou):
 * O formulário começa VAZIO. Não há valores de amostra a fazer de resultado: cada estimativa só
 * aparece quando o dado de que depende foi escrito, e desaparece se o atleta apagar o campo.
 * Sem o cavalo não há altura de selim, quadro nem crenque; sem a largura biacromial não há guiador.
 * Os números visíveis são, portanto, sempre do atleta — e o cálculo vive num módulo testável
 * (`modules/theoreticalEstimates.js`), não escondido numa computada do componente.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from '../../i18n';
import { apiService } from '../../services/api';
import HelpTip from '../common/HelpTip';
import { getTheoreticalHelp } from './modules/theoreticalHelp';
import {
  TOLERANCES,
  compareWithCurrent,
  computeTheoreticalEstimates,
} from './modules/theoreticalEstimates';
import {
  applyProfile,
  loadProfiles,
  persistProfiles,
  profileSummary,
  removeProfile,
  saveProfile,
  touchProfile,
} from './modules/athleteProfiles';

export default {
  name: 'AthleteOnboarding',
  components: { HelpTip },
  emits: ['session-created'],
  setup(props, { emit }) {
    const { t, locale } = useI18n();
    /** `t` é uma computed: dentro de JavaScript tem de ser chamada com `.value`. */
    const translate = (key) => t.value(key);

    /** Ajuda detalhada de cada medida (o que é, como se mede, fórmula e fonte). */
    const help = computed(() => getTheoreticalHelp(locale.value));
    const isSubmitting = ref(false);
    const errorMessage = ref('');

    /**
     * Estado reativo do formulário — deliberadamente VAZIO.
     * Os números de exemplo vivem nos `placeholder` dos campos, não no valor: assim nunca são
     * confundidos com dados do atleta (nem enviados para o backend sem ele os escrever).
     */
    const form = reactive({
      name: '',
      // Peso, número de sapato e cintura: pedidos logo no início, com o resto da antropometria.
      // Já eram obrigatórios para a análise (peso e sapato) — eram é pedidos a meio do passo 2.
      weight_kg: null,
      shoe_size_eu: null,
      waist_cm: null,
      height_cm: null,
      inseam_cm: null,
      shoulder_width_cm: null,
      flexibility: 'medium',
      riding_style: 'road',
      brand_model: '',
      current_saddle_height_cm: null,
      frame_size_cm: null,
      // Tubo superior (Top Tube) / ETT em mm: o comprimento do quadro que define o cockpit
      // (ETT + avanço + reach do guiador). Distinto do tamanho do quadro (tubo do selim).
      top_tube_mm: null,
      handlebar_width_mm: null,
      handlebar_reach_mm: null,
      handlebar_drop_mm: null,
      stem_length_mm: null,
      crank_length_mm: null,
      cleat_position: '',
    });

    /**
     * Histórico dos últimos perfis usados neste dispositivo (máx. 5).
     * Carregado no `onMounted` para não tocar no `localStorage` durante o setup SSR.
     */
    const profiles = ref([]);
    onMounted(() => {
      profiles.value = loadProfiles();
    });

    /**
     * Preenche o formulário com um perfil guardado e marca-o como o mais recente.
     * O atleta pode alterar o que quiser a seguir — o perfil é um ponto de partida, não um cadeado.
     */
    const useProfile = (id) => {
      const profile = profiles.value.find((item) => item.id === id);
      if (!profile) return;
      applyProfile(form, profile);
      profiles.value = touchProfile(profiles.value, id);
      persistProfiles(profiles.value);
      errorMessage.value = '';
    };

    /** Apaga um perfil do histórico (não apaga nada no backend). */
    const forgetProfile = (id) => {
      profiles.value = removeProfile(profiles.value, id);
      persistProfiles(profiles.value);
    };

    /** Estimativas: derivadas só dos campos preenchidos (+ o que ainda falta). */
    const estimates = computed(() => computeTheoreticalEstimates(form));

    /** Altura do selim recomendada (LeMond) vs a altura atual escrita pelo atleta. */
    const saddleComparison = computed(() =>
      compareWithCurrent({
        recommended: estimates.value.values.lemond_saddle_height_cm,
        current: form.current_saddle_height_cm,
        tolerance: TOLERANCES.saddleHeightCm,
      })
    );

    /** Quadro estimado vs o tamanho de quadro que o atleta tem. */
    const frameComparison = computed(() =>
      compareWithCurrent({
        recommended: estimates.value.values.estimated_frame_size_cm,
        current: form.frame_size_cm,
        tolerance: TOLERANCES.frameSizeCm,
      })
    );

    /** Guiador recomendado vs o guiador montado. */
    const handlebarComparison = computed(() =>
      compareWithCurrent({
        recommended: estimates.value.values.recommended_handlebar_width_mm,
        current: form.handlebar_width_mm,
        tolerance: TOLERANCES.handlebarWidthMm,
      })
    );

    /** Crenque recomendado vs o crenque montado. */
    const crankComparison = computed(() =>
      compareWithCurrent({
        recommended: estimates.value.values.recommended_crank_length_mm,
        current: form.crank_length_mm,
        tolerance: TOLERANCES.crankLengthMm,
      })
    );

    /** Nomes (traduzidos) dos campos que faltam para haver estimativas. */
    const missingLabels = computed(() =>
      estimates.value.missing.map((field) =>
        translate(field === 'inseam_cm' ? 'inseamCm' : 'shoulderWidthCm')
      )
    );

    /** Existe alguma estimativa para mostrar? (Se não, o painel mostra o que falta.) */
    const hasEstimates = computed(() => estimates.value.any);

    /** Guiador em texto: número comercial, ou faixa convencional em MTB. */
    const handlebarText = computed(() => {
      const { recommended_handlebar_width_mm: mm, recommended_handlebar_range_mm: range } =
        estimates.value.values;
      if (Array.isArray(range)) return `${range[0]}–${range[1]} mm`;
      return mm === null ? '' : `${mm} mm`;
    });

    /** Diferença face à altura atual do selim, com o sentido explicado. */
    const saddleDeltaText = computed(() => {
      const comparison = saddleComparison.value;
      if (!comparison) return '';
      const sign = comparison.delta > 0 ? '+' : '';
      if (comparison.withinTolerance) {
        return `${sign}${comparison.delta} cm · ${translate('estimateWithinTolerance')}`;
      }
      return `${sign}${comparison.delta} cm · ${translate(
        comparison.delta > 0 ? 'saddleCurrentHigher' : 'saddleCurrentLower'
      )}`;
    });

    /** A diferença face à altura atual do selim está fora da tolerância? (cor de aviso) */
    const saddleDeltaIsWarning = computed(
      () => Boolean(saddleComparison.value) && !saddleComparison.value.withinTolerance
    );

    /**
     * Nota que diz de QUE campo do formulário veio o número ("com base no cavalo: 84 cm").
     * É o que torna visível que a estimativa acompanha os dados escritos em cima.
     */
    const basisNote = (field) => {
      const isShoulders = field === 'shoulder';
      const value = isShoulders ? form.shoulder_width_cm : form.inseam_cm;
      if (value === null || value === undefined || value === '') return '';
      const label = translate(isShoulders ? 'estimateBasisShoulders' : 'estimateBasisInseam');
      return `${label}: ${value} cm`;
    };

    /**
     * Texto de uma comparação: "Atual: 54 cm · Diferença: +1,9 cm" ou "Atual: 420 mm · dentro do esperado".
     * Sem um dos dois lados devolve string vazia — nunca uma comparação inventada.
     */
    const comparisonText = (comparison, unit) => {
      if (!comparison) return '';
      const current = `${comparison.current} ${unit}`;
      if (comparison.withinTolerance) {
        return `${translate('estimateCurrentLabel')} ${current} · ${translate('estimateWithinTolerance')}`;
      }
      const sign = comparison.delta > 0 ? '+' : '';
      return `${translate('estimateCurrentLabel')} ${current} · ${translate('estimateDeltaLabel')} ${sign}${comparison.delta} ${unit}`;
    };

    /**
     * Submissão e criação de sessão ACID no backend.
     */
    /**
     * Perfil antropométrico do passo 1, no formato que o passo 2 e o relatório usam.
     * É este objeto que evita pedir peso/sapato/cintura outra vez durante a análise.
     */
    const anthropometryProfile = () => ({
      weightKg: form.weight_kg,
      shoeSizeEu: form.shoe_size_eu,
      waistCm: form.waist_cm,
      heightCm: form.height_cm,
      inseamCm: form.inseam_cm,
      cleatPosition: form.cleat_position || null,
    });

    const handleSubmit = async () => {
      if (!form.name || !form.height_cm || !form.inseam_cm) {
        errorMessage.value = t.value('fillRequiredFields');
        return;
      }
      // Peso e número de sapato são obrigatórios desde o início: sem eles a análise não podia
      // emitir as notas mecânicas (sag de suspensão e recuo dos travessões).
      if (!form.weight_kg || !form.shoe_size_eu) {
        errorMessage.value = t.value('fillWeightShoeFields');
        return;
      }
      // Guarda de coerência: sem cavalo válido não há estimativas — e o atleta veria a sessão
      // seguinte (etapa 2) sem a altura de selim teórica que a interface mostra no topo.
      if (!estimates.value.ready.saddleHeight) {
        errorMessage.value = t.value('invalidInseam');
        return;
      }        errorMessage.value = '';
      isSubmitting.value = true;

      // Antes de falar com o backend: guarda localmente o perfil (máx. 5, mais recente em cima).
      // É local de propósito — o histórico serve o próximo preenchimento neste dispositivo,
      // mesmo que a rede falhe e a sessão siga em modo local.
      const saved = saveProfile(profiles.value, form);
      if (saved.saved) {
        profiles.value = saved.profiles;
        persistProfiles(profiles.value);
      }

      try {
        // 1. Criar ciclista no backend
        const athlete = await apiService.createAthlete({
          name: form.name,
          height_cm: form.height_cm,
          inseam_cm: form.inseam_cm,
          shoulder_width_cm: form.shoulder_width_cm || null,
          flexibility: form.flexibility,
          riding_style: form.riding_style,
        });

        // 2. Registar a bicicleta associada
        const bike = await apiService.createBike({
          athlete_id: athlete.id,
          bike_type: form.riding_style,
          brand_model: form.brand_model || 'Bicicleta',
          frame_size_cm: form.frame_size_cm || null,
          top_tube_mm: form.top_tube_mm || null,
          handlebar_width_mm: form.handlebar_width_mm || null,
          handlebar_reach_mm: form.handlebar_reach_mm || null,
          handlebar_drop_mm: form.handlebar_drop_mm || null,
          stem_length_mm: form.stem_length_mm || null,
          crank_length_mm: form.crank_length_mm || null,
          current_saddle_height_cm: form.current_saddle_height_cm || null,
          cleat_position: form.cleat_position || null,
        });

        // 3. Iniciar a sessão de BikeFit
        const session = await apiService.startFitSession(athlete.id, bike.id);

        emit('session-created', {
          session,
          athlete,
          bike,
          theoreticalEstimates: estimates.value.values,
          // O perfil do passo 1 viaja com a sessão: o passo 2 usa-o e não volta a perguntar.
          athleteProfile: anthropometryProfile(),
        });
      } catch (err) {
        console.error('Erro ao inicializar sessão com o servidor:', err);
        // Fallback resiliente offline
        emit('session-created', {
          session: { id: `local-${Date.now()}`, status: 'LOCAL_MODE' },
          athlete: {
            name: form.name,
            height_cm: form.height_cm,
            inseam_cm: form.inseam_cm,
            shoulder_width_cm: form.shoulder_width_cm || null,
            flexibility: form.flexibility,
            riding_style: form.riding_style,
          },
          // Mesmo em modo local a bicicleta viaja completa: são estes valores que o motor de
          // recomendações usa para pesar as peças (guiador, avanço, crenque, selim).
          bike: {
            athlete_id: null,
            brand_model: form.brand_model || 'Bicicleta',
            bike_type: form.riding_style,
            frame_size_cm: form.frame_size_cm || null,
            top_tube_mm: form.top_tube_mm || null,
            handlebar_width_mm: form.handlebar_width_mm || null,
            handlebar_reach_mm: form.handlebar_reach_mm || null,
            handlebar_drop_mm: form.handlebar_drop_mm || null,
            stem_length_mm: form.stem_length_mm || null,
            crank_length_mm: form.crank_length_mm || null,
            current_saddle_height_cm: form.current_saddle_height_cm || null,
            cleat_position: form.cleat_position || null,
          },
          theoreticalEstimates: estimates.value.values,
          athleteProfile: anthropometryProfile(),
        });
      } finally {
        isSubmitting.value = false;
      }
    };

    return {
      t,
      help,
      form,
      profiles,
      profileSummary,
      useProfile,
      forgetProfile,
      estimates,
      hasEstimates,
      missingLabels,
      handlebarText,
      saddleComparison,
      frameComparison,
      handlebarComparison,
      crankComparison,
      saddleDeltaText,
      saddleDeltaIsWarning,
      comparisonText,
      basisNote,
      isSubmitting,
      errorMessage,
      handleSubmit,
    };
  },
};
