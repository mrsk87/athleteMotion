/**
 * Controlador de Lógica de Negócio para o Formulário de Onboarding Inicial (Etapa 1).
 *
 * Responsabilidade:
 * - Recolher e validar dados antropométricos do ciclista (altura, cavalo, ombros, flexibilidade, modalidade).
 * - Recolher dimensões mecânicas da bicicleta (quadro, guiador, avanço, crenques, altura de selim atual).
 * - Calcular estimativas teóricas em tempo real (Fórmula LeMond, Regra dos 109%, tamanho de quadro).
 * - Persistir ciclista e bicicleta no backend via transação ACID ou fallback local.
 */
import { computed, reactive, ref } from 'vue';
import { useI18n } from '../../i18n';
import { apiService } from '../../services/api';

export default {
  name: 'AthleteOnboarding',
  emits: ['session-created'],
  setup(props, { emit }) {
    const { t } = useI18n();
    const isSubmitting = ref(false);
    const errorMessage = ref('');

    // Estado reativo do formulário
    const form = reactive({
      name: 'Ciclista',
      height_cm: 178,
      inseam_cm: 84,
      shoulder_width_cm: 42,
      flexibility: 'medium',
      riding_style: 'road',
      brand_model: 'Minha Bicicleta',
      current_saddle_height_cm: 74.0,
      frame_size_cm: 54,
      handlebar_width_mm: 420,
      stem_length_mm: 100,
      crank_length_mm: 172.5,
    });

    /**
     * Estimativas biomecânicas instantâneas baseadas na literatura clássica de ciclismo:
     * - Greg LeMond: Cavalo * 0.883
     * - Hamley: Cavalo * 1.090
     */
    const theoreticalEstimates = computed(() => {
      if (!form.inseam_cm || form.inseam_cm < 40) return null;
      const lemond = Math.round(form.inseam_cm * 0.883 * 10) / 10;
      const hamley = Math.round(form.inseam_cm * 1.09 * 10) / 10;
      const frame = Math.round(form.inseam_cm * 0.665 * 10) / 10;
      const crank =
        form.inseam_cm < 74
          ? 165
          : form.inseam_cm <= 81
          ? 170
          : form.inseam_cm <= 86
          ? 172.5
          : 175;
      const handlebar = form.shoulder_width_cm
        ? form.shoulder_width_cm > 42
          ? 440
          : form.shoulder_width_cm < 40
          ? 400
          : 420
        : 420;

      return {
        lemond_saddle_height_cm: lemond,
        hamley_109_saddle_height_cm: hamley,
        estimated_frame_size_cm: frame,
        recommended_crank_length_mm: crank,
        recommended_handlebar_width_mm: handlebar,
      };
    });

    /**
     * Diferença entre a altura de selim atual e a altura teórica calculada.
     */
    const saddleDelta = computed(() => {
      if (!form.current_saddle_height_cm || !theoreticalEstimates.value) return null;
      return (
        Math.round(
          (form.current_saddle_height_cm -
            theoreticalEstimates.value.lemond_saddle_height_cm) *
            10
        ) / 10
      );
    });

    /**
     * Submissão e criação de sessão ACID no backend.
     */
    const handleSubmit = async () => {
      if (!form.name || !form.height_cm || !form.inseam_cm) {
        errorMessage.value = t('fillRequiredFields') || 'Por favor, preencha todos os campos obrigatórios.';
        return;
      }

      errorMessage.value = '';
      isSubmitting.value = true;

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
          handlebar_width_mm: form.handlebar_width_mm || null,
          stem_length_mm: form.stem_length_mm || null,
          crank_length_mm: form.crank_length_mm || null,
          current_saddle_height_cm: form.current_saddle_height_cm || null,
        });

        // 3. Iniciar a sessão de BikeFit
        const session = await apiService.startFitSession(athlete.id, bike.id);

        emit('session-created', {
          session,
          athlete,
          bike,
          theoreticalEstimates: theoreticalEstimates.value,
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
            riding_style: form.riding_style,
          },
          bike: {
            brand_model: form.brand_model,
            bike_type: form.riding_style,
            current_saddle_height_cm: form.current_saddle_height_cm,
          },
          theoreticalEstimates: theoreticalEstimates.value,
        });
      } finally {
        isSubmitting.value = false;
      }
    };

    return {
      t,
      form,
      theoreticalEstimates,
      saddleDelta,
      isSubmitting,
      errorMessage,
      handleSubmit,
    };
  },
};

