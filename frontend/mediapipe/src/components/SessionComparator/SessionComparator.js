/**
 * Controlador de Lógica de Negócio do Comparador Antes vs Depois (FEAT-16).
 *
 * Responsabilidade:
 * - Carregar o histórico de sessões do atleta via API.
 * - Gerir a seleção de duas sessões distintas (Pré-Fit vs Pós-Fit).
 * - Calcular os deltas biomecânicos angulares e os vereditos ergonómicos.
 * - Oferecer simulação pré-fit intuitiva caso o atleta só tenha uma sessão gravada.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from '../../i18n';
import { apiService } from '../../services/api';

export default {
  name: 'SessionComparator',
  props: {
    athleteId: {
      type: String,
      default: '',
    },
    currentSession: {
      type: Object,
      default: null,
    },
  },
  emits: ['backToReport'],
  setup(props) {
    const { t } = useI18n();

    // Estado reativo
    const availableSessions = ref([]);
    const selectedSessionAId = ref('');
    const selectedSessionBId = ref('');

    // Sessões selecionadas computadas
    const sessionA = computed(() =>
      availableSessions.value.find((s) => s.id === selectedSessionAId.value)
    );
    const sessionB = computed(() =>
      availableSessions.value.find((s) => s.id === selectedSessionBId.value)
    );

    /**
     * Carrega sessões do atleta ou cria simulação educativa pré-fit.
     */
    const loadSessions = async () => {
      if (props.athleteId) {
        try {
          const sessions = await apiService.getAthleteSessions(props.athleteId);
          if (sessions && sessions.length > 0) {
            availableSessions.value = sessions;
            if (sessions.length >= 2) {
              selectedSessionAId.value = sessions[1].id;
              selectedSessionBId.value = sessions[0].id;
            } else {
              selectedSessionAId.value = sessions[0].id;
              createPreFitSimulation(sessions[0]);
            }
            return;
          }
        } catch (e) {
          console.warn('Erro ao carregar histórico do atleta:', e);
        }
      }

      // Fallback para sessão atual
      if (props.currentSession) {
        createPreFitSimulation(props.currentSession);
      }
    };

    /**
     * Gera uma sessão comparativa simulada (Pré-Fit) para fins de demonstração visual.
     */
    const createPreFitSimulation = (current) => {
      const simulatedPre = {
        id: 'simulated-pre',
        started_at: new Date(Date.now() - 3600000).toISOString(),
        measured_avg_knee_angle: current.measured_avg_knee_angle
          ? Math.round((current.measured_avg_knee_angle - 8.5) * 10) / 10
          : 138.5,
        measured_avg_back_angle: current.measured_avg_back_angle
          ? Math.round((current.measured_avg_back_angle + 6.0) * 10) / 10
          : 54.0,
        measured_avg_arm_angle: 168.0,
        theoretical_saddle_height_cm: current.theoretical_saddle_height_cm || 73.0,
        target_knee_min: current.target_knee_min || 145.0,
        target_knee_max: current.target_knee_max || 155.0,
        target_back_min: current.target_back_min || 40.0,
        target_back_max: current.target_back_max || 50.0,
      };

      const realPost = {
        ...current,
        id: current.session_id || current.id || 'current-post',
        started_at: current.completed_at || new Date().toISOString(),
      };

      availableSessions.value = [realPost, simulatedPre];
      selectedSessionAId.value = 'simulated-pre';
      selectedSessionBId.value = realPost.id;
    };

    /**
     * Cálculo dos Deltas de melhoria postural e vereditos clínicos.
     */
    const deltas = computed(() => {
      if (!sessionA.value || !sessionB.value) return null;
      const kA = sessionA.value.measured_avg_knee_angle || 0;
      const kB = sessionB.value.measured_avg_knee_angle || 0;
      const bA = sessionA.value.measured_avg_back_angle || 0;
      const bB = sessionB.value.measured_avg_back_angle || 0;

      const kneeDelta = Math.round((kB - kA) * 10) / 10;
      const backDelta = Math.round((bB - bA) * 10) / 10;

      const kneeVerdict =
        kB >= 145 && kB <= 155 ? 'Zona Otimizada (Alívio Patelar) ✅' : 'Evolução Registada';
      const backVerdict =
        bB >= 40 && bB <= 50 ? 'Aerodinâmica Equilibrada ✅' : 'Evolução Registada';

      return {
        kneeDelta,
        backDelta,
        kneeVerdict,
        backVerdict,
      };
    });

    const formatSessionOption = (s) => {
      const dateStr = s.started_at ? new Date(s.started_at).toLocaleDateString() : '';
      const knee = s.measured_avg_knee_angle ? `${s.measured_avg_knee_angle}°` : '';
      return `${dateStr} - Joelho: ${knee} (${s.id.substring(0, 8)})`;
    };

    const formatDate = (iso) => {
      if (!iso) return '-';
      return new Date(iso).toLocaleString();
    };

    onMounted(() => {
      loadSessions();
    });

    return {
      t,
      availableSessions,
      selectedSessionAId,
      selectedSessionBId,
      sessionA,
      sessionB,
      deltas,
      formatSessionOption,
      formatDate,
    };
  },
};

