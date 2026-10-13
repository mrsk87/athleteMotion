/**
 * Vista Principal (HomeView)
 * 
 * Responsabilidade:
 * Orquestrar as 4 etapas sequenciais do fluxo de BikeFit:
 * 1. Recolha de medidas antropométricas e bicicleta (AthleteOnboarding)
 * 2. Análise postural por visão computacional e BLE (LiveCameraCapture)
 * 3. Relatório diagnóstico e métricas (FitReportView)
 * 4. Comparador de evolução e histórico (SessionComparator)
 */

import { ref } from 'vue';
import { useI18n } from '../i18n';
import AthleteOnboarding from '../components/AthleteOnboarding';
import LiveCameraCapture from '../components/LiveCameraCapture';
import FitReportView from '../components/FitReportView';
import SessionComparator from '../components/SessionComparator';
import BiomechanicalWorkbench from '../components/workbench/BiomechanicalWorkbench.vue';

export default {
  name: 'HomeView',
  components: {
    AthleteOnboarding,
    LiveCameraCapture,
    FitReportView,
    SessionComparator,
    BiomechanicalWorkbench,
  },
  setup() {
    const { t } = useI18n();

    // Etapa ativa ('onboarding', 'camera', 'report', 'comparator')
    const currentTab = ref('onboarding');

    // Dados da sessão iniciada pelo atleta
    const sessionData = ref(null);

    // Relatório final gerado pela análise da câmara
    const reportData = ref(null);

    /**
     * Tratamento de criação de sessão com sucesso
     */
    const handleSessionCreated = (data) => {
      sessionData.value = data;
      currentTab.value = 'camera';
    };

    /**
     * Tratamento de conclusão da gravação e diagnóstico
     */
    const handleSessionCompleted = (report) => {
      reportData.value = report;
      currentTab.value = 'report';
    };

    /**
     * Navegação direta para o comparador de sessões (Antes vs Depois)
     */
    const handleOpenComparator = (report) => {
      reportData.value = report;
      currentTab.value = 'comparator';
    };

    /**
     * Reiniciar fluxo para uma nova sessão limpa
     */
    const handleRestartSession = () => {
      sessionData.value = null;
      reportData.value = null;
      currentTab.value = 'onboarding';
    };

    return {
      t,
      currentTab,
      sessionData,
      reportData,
      handleSessionCreated,
      handleSessionCompleted,
      handleOpenComparator,
      handleRestartSession,
    };
  },
};

