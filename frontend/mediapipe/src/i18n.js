import { computed, ref } from 'vue';

const savedLocale = typeof window !== 'undefined' ? window.localStorage.getItem('locale') : null;
// Português é a língua-mãe nativa padrão
export const locale = ref(savedLocale === 'en' ? 'en' : 'pt');

export const messages = {
  pt: {
    // Cabeçalho e Sistema
    appName: 'Athlete Motion',
    tagline: 'Análise Biomecânica de Postura Ciclística e BikeFit em Tempo Real',
    language: 'Idioma',
    portuguese: 'Português',
    english: 'Inglês',
    versionLabel: 'Versão',
    systemStatus: 'Estado do Sistema',
    statusActive: 'Operacional',

    // Navegação em Etapas
    tabOnboarding: '1. Medidas Iniciais',
    tabLiveAnalysis: '2. Análise com Câmara',
    tabReport: '3. Relatório & Diagnóstico',

    // Etapa 1: Formulário de Onboarding e Medidas
    onboardingTitle: 'Dados Primários e Geometria do Ciclista',
    onboardingSubtitle: 'Reúna as medidas cruciais do ciclista e da bicicleta antes de iniciar a análise minuciosa por câmara.',
    athleteSectionTitle: 'Medidas Corporais do Ciclista (Antropometria)',
    cyclistName: 'Nome do Ciclista',
    cyclistNamePlaceholder: 'Ex: João Silva',
    heightCm: 'Altura Total (cm)',
    heightHelp: 'Com os pés descalços encostados à parede.',
    inseamCm: 'Altura do Cavalo / Entre-perna (cm)',
    inseamHelp: 'Crucial: do chão até ao períneo, segurando um livro entre as pernas.',
    shoulderWidthCm: 'Largura dos Ombros (cm)',
    shoulderHelp: 'Distância biacromial entre os ossos dos ombros.',
    armLengthCm: 'Comprimento do Braço (cm)',
    flexibility: 'Nível de Flexibilidade',
    flexLow: 'Baixa (não toca nos pés)',
    flexMed: 'Média (toca nos pés com flexão)',
    flexHigh: 'Alta (palmas das mãos no chão)',
    ridingStyle: 'Modalidade de Ciclismo',
    roadBike: 'Ciclismo de Estrada (Road / Endurance)',
    mtbBike: 'BTT / Montanha (MTB XC / Trail)',
    ttBike: 'Contrarrelógio / Triatlo (TT / Aero)',
    gravelBike: 'Gravel / Misto',

    // Medidas da Bicicleta
    bikeSectionTitle: 'Geometria e Componentes da Bicicleta',
    bikeBrandModel: 'Marca e Modelo da Bicicleta',
    bikeBrandModelPlaceholder: 'Ex: Specialized Tarmac SL7',
    frameSizeCm: 'Tamanho do Quadro (cm ou tam)',
    frameHelp: 'Ex: 54 cm, 56 cm ou M/L',
    handlebarWidthMm: 'Largura do Guiador (mm)',
    handlebarHelp: 'Ex: 400, 420 ou 440 mm (Estrada) ou 720-760 mm (MTB)',
    stemLengthMm: 'Comprimento do Avanço / Mesa (mm)',
    stemHelp: 'Ex: 90, 100, 110 mm',
    crankLengthMm: 'Comprimento do Crenque / Biela (mm)',
    crankHelp: 'Ex: 165, 170, 172.5 ou 175 mm',
    currentSaddleHeightCm: 'Altura Atual do Selim (cm)',
    currentSaddleHelp: 'Do centro do eixo pedaleiro até ao topo central do selim.',

    // Painel Teórico Imediato
    theoreticalTitle: 'Estimativas Biomecânicas Teóricas (Pré-análise)',
    lemondSaddleHeight: 'Altura Recomendada (Método LeMond):',
    hamley109SaddleHeight: 'Altura Recomendada (Método 109%):',
    saddleComparison: 'Diferença face à sua altura atual:',
    estimatedFrameSize: 'Tamanho de Quadro Estimado:',
    recommendedHandlebarWidth: 'Largura de Guiador Recomendada:',
    recommendedCrankLength: 'Comprimento de Biela Recomendado:',
    proceedToCameraBtn: 'Avançar para Análise Corporal com Câmara →',
    fillRequiredFields: 'Por favor preencha o Nome, Altura e Altura do Cavalo para prosseguir.',

    // Etapa 2: Análise por Câmara ao Vivo
    liveAnalysisTitle: 'Análise Corporal Meticulosa em Tempo Real',
    liveAnalysisSubtitle: 'Posicione-se de lado na bicicleta sobre um rolo de treino ou suporte estático para leitura precisa.',
    cameraSettings: 'Configurações de Captura',
    selectCamera: 'Câmara do Dispositivo:',
    cameraFacingUser: 'Câmara Frontal',
    cameraFacingEnvironment: 'Câmara Traseira (Recomendado para telemóveis)',
    profileSide: 'Lado Visível para a Câmara:',
    leftProfile: 'Perfil Esquerdo (Lado sem corrente)',
    rightProfile: 'Perfil Direito (Lado da transmissão)',
    viewPlaneLabel: 'Plano de Observação:',
    sagittalPlane: 'Perfil Sagital (Lateral)',
    frontalPlane: 'Plano Frontal (De Frente)',
    frontalTitle: 'Alinhamento Frontal do Joelho e Fator Q',
    frontalTrackingLabel: 'Rastreamento Frontal:',
    frontalValgus: 'Valgo Dinâmico',
    frontalVarus: 'Varo Dinâmico',
    frontalOptimal: 'Alinhamento Linear Correto',
    qFactorAdvice: 'Recomendação de Fator Q / Palmilhas:',
    pedalingSmoothnessLabel: 'Índice de Suavidade de Pedalada (PSI):',
    offlineModeNotice: 'Modo Offline: Dados guardados localmente no navegador (IndexedDB)',
    syncPendingNotice: 'Sincronizar Sessões Guardadas Offline',
    resolution: 'Resolução:',
    zoom: 'Zoom:',
    apply: 'Aplicar',
    startLiveBtn: '▶ Iniciar Análise ao Vivo',
    pauseLiveBtn: '⏸ Pausar Análise',
    audioAlertsToggle: 'Alertas Sonoros',
    captureSnapshotBtn: '📸 Registar Amostra / Snapshot',
    snapshotSavedSuccess: 'Amostra guardada na sessão com sucesso!',
    completeSessionBtn: '🏁 Finalizar Sessão e Gerar Relatório',
    noAnglesDetected: 'Nenhuma pose detetada. Afaste-se até o corpo todo ficar visível na câmara.',
    connectingServer: 'A sincronizar dados com o backend...',
    tabLiveMode: '📹 Câmara ao Vivo',
    tabVideoMode: '📁 Ficheiro de Vídeo (Upload)',
    uploadVideoPrompt: 'Clique ou arraste um ficheiro de vídeo (.mp4, .mov, .webm) para analisar a pedalada',
    exportGifBtn: '🎞 Exportar GIF Animado',
    exportClipBtn: '🎥 Descarregar Clipe de Vídeo',
    anglesTimelineTitle: '📈 Evolução dos Ângulos no Vídeo',
    videoSummaryTitle: '🎯 Movimentos & Correções do Vídeo',
    pedalCycles: 'Ciclos de Pedalada:',
    avgBdc: 'BDC Médio:',
    torsoStability: 'Oscilação do Tronco:',

    // Articulações e Leituras em Direto
    kneeAngleLabel: 'Joelho (Extensão no Ponto Morto Inferior):',
    backAngleLabel: 'Tronco / Costas (Inclinação face à horizontal):',
    armAngleLabel: 'Braço / Cotovelo (Flexão):',
    shoulderAngleLabel: 'Ombro (Abertura):',
    ankleAngleLabel: 'Tornozelo (Flexão plantar):',
    headAngleLabel: 'Cabeça / Cervical (Inclinação):',
    targetRange: 'Alvo ergonómico:',
    statusCompliant: 'Correto',
    statusNeedsAdjustment: 'Requer Ajuste',

    // BDC e Cadência
    cadenceBadge: 'Cadência',
    cadenceRpm: 'Cadência: {rpm} RPM',
    bdcDetected: 'Ponto Morto Inferior (BDC) Capturado',
    bdcKneeAngle: 'Extensão no BDC:',

    // KOPS e Linha de Prumo
    kopsTitle: 'Alinhamento KOPS (Recuo do Selim)',
    kopsPlumbLine: 'Linha de Prumo KOPS',
    kopsAligned: 'Alinhado / Neutro',
    kopsAhead: 'Joelho Adiantado',
    kopsBehind: 'Joelho Atrasado',

    // Alertas de Voz e Áudio
    voiceAlertsToggle: 'Avisos por Voz',
    voiceKneeLow: 'Atenção ao joelho: selim demasiado baixo.',
    voiceKneeHigh: 'Atenção ao joelho: selim demasiado alto.',
    voiceBackAggressive: 'Tronco excessivamente inclinado.',

    // Estabilização e Foco de Pontos
    smoothingLabel: 'Estabilização de Ruído',
    smoothingOff: 'Desligado (Rápido)',
    smoothingLow: 'Baixo',
    smoothingMedium: 'Equilibrado (Recomendado)',
    smoothingHigh: 'Alta Precisão (Estúdio)',
    focusLabel: 'Foco Articular',
    focusAll: 'Todas as Articulações',
    focusKnee: 'Focar Joelho & Órbita',
    focusHip: 'Focar Tronco & Quadril',
    focusAnkle: 'Focar Tornozelo & Pé',
    focusCockpit: 'Focar Cockpit (Braços/Ombros)',
    focusKops: 'Focar Alinhamento KOPS',
    calibrateManualMarkerBtn: '📍 Calibrar Ponto Manual',
    manualCalibratingActive: 'Modo Calibração Manual Ativo',
    manualCalibPrompt: 'Clique no vídeo exatamente sobre a articulação (ou adesivo refletor) pretendida.',
    cancelManualCalib: 'Cancelar Calibração Manual',
    clearManualMarkersBtn: 'Limpar Pontos Manuais',
    manualMarkerCalibratedSuccess: 'Marcador manual calibrado com sucesso e fixado à articulação!',
    camLockedWarning: 'Câmara inacessível ou ocupada por outra aplicação (ex: OBS Studio, Teams). Feche o OBS e selecione a sua câmara física.',

    // Teste Bilateral
    bilateralMode: 'Teste Bilateral (Esq + Dir)',
    stepLeftProfile: 'Passo 1: Gravar Perfil Esquerdo',
    turnBikePrompt: 'Excelente! Agora rode a bicicleta para gravar o perfil direito.',
    stepRightProfile: 'Passo 2: Gravar Perfil Direito',
    symmetryIndex: 'Índice de Simetria (SI)',
    bilateralReportTitle: 'Análise de Simetria Bilateral',

    // Calibração Espacial e Drop
    wheelCalibBtn: 'Calibrar Escala com a Roda',
    wheelCalibPrompt: 'Clique no topo e na base do pneu da bicicleta no vídeo para calibrar a escala.',
    saddleDropLabel: 'Desnível Selim-Guiador (Drop)',
    cockpitReachLabel: 'Alcance do Cockpit (Reach)',
    measureDropBtn: 'Medir Drop (Selim ➔ Guiador)',

    // Câmara Lenta e Scrubber
    recordClipBtn: 'Gravar Clipe (6s)',
    recordingClip: 'A capturar clipe de alta precisão...',
    scrubberTitle: 'Inspeção Quadro a Quadro (Câmara Lenta)',
    playSlow: 'Reproduzir 0.25x',
    pauseClip: 'Pausar',
    prevFrame: '⏮ -1 Frame',
    nextFrame: '+1 Frame ⏭',
    exitSlowMo: 'Voltar ao Direto',

    // Sensores IoT Web Bluetooth
    connectBleBtn: 'Conectar Sensor BLE (Watts / RPM)',
    bleConnected: 'Sensor Conectado',
    blePowerWatts: 'Potência: {watts} W',
    bleHeartRate: 'Cardíaco: {bpm} BPM',

    // Comparador Visual Antes vs Depois
    tabComparator: '4. Comparador Antes vs Depois',
    comparatorTitle: 'Comparador Visual Antes vs Depois (Split-Screen)',
    comparatorSubtitle: 'Compare lado a lado duas sessões para validar a eficácia mecânica do ajuste.',
    sessionA: 'Sessão Anterior (Pré-Fit)',
    sessionB: 'Sessão Posterior (Pós-Fit)',
    evolutionDeltas: 'Evolução e Deltas Biomecânicos',
    selectSessionPrompt: 'Selecione duas sessões do ciclista para gerar o comparativo',

    // Relatório PDF
    downloadPdfBtn: 'Descarregar Relatório Oficial PDF',
    generatingPdf: 'A compilar PDF profissional...',

    // Recomendações e Feedback em Direto
    liveGuidanceTitle: 'Diagnóstico Biomecânico em Tempo Real',
    saddleActionTitle: 'Ajuste de Selim Recomendado:',
    cockpitActionTitle: 'Ajuste de Guiador / Avanço:',

    // Etapa 3: Relatório e Diagnóstico Final
    reportTitle: 'Relatório Final de BikeFit e Ajustes Físicos',
    reportSubtitle: 'Resultados consolidados da sua sessão de análise postural.',
    cyclistProfileTitle: 'Perfil do Ciclista & Bicicleta',
    complianceScore: 'Índice de Conformidade Biomecânica Global',
    measuredAveragesTitle: 'Médias Angulares Registadas Durante a Pedalada',
    physicalActionsTitle: 'Checklist de Ajustes Físicos Recomendados na Bicicleta',
    newSessionBtn: '↺ Iniciar Nova Sessão de Fit',
    printReportBtn: '🖨 Imprimir Relatório / Salvar PDF',
    medicalDisclaimer: 'Aviso: Este software destina-se a otimização de performance e conforto ergonómico ciclístico, não substituindo avaliação médica ou fisioterapêutica para lesões prévias.'
  },
  en: {
    // Header & System
    appName: 'Athlete Motion',
    tagline: 'Real-time Biomechanical Cycling Posture Analysis & BikeFit',
    language: 'Language',
    portuguese: 'Portuguese',
    english: 'English',
    versionLabel: 'Version',
    systemStatus: 'System Status',
    statusActive: 'Operational',

    // Step Navigation
    tabOnboarding: '1. Initial Measurements',
    tabLiveAnalysis: '2. Camera Analysis',
    tabReport: '3. Report & Diagnostics',

    // Step 1: Onboarding and Measurements
    onboardingTitle: 'Primary Cyclist Data & Bike Geometry',
    onboardingSubtitle: 'Gather crucial cyclist and bicycle measurements before proceeding to detailed live camera analysis.',
    athleteSectionTitle: 'Cyclist Anthropometric Measurements',
    cyclistName: 'Cyclist Name',
    cyclistNamePlaceholder: 'e.g. John Doe',
    heightCm: 'Total Height (cm)',
    heightHelp: 'Barefoot with heels and back against a flat wall.',
    inseamCm: 'Inseam / Crotch Height (cm)',
    inseamHelp: 'Crucial: from the floor to the crotch, holding a flat book firmly upwards.',
    shoulderWidthCm: 'Shoulder Width (cm)',
    shoulderHelp: 'Biacromial distance between the tips of your shoulder bones.',
    armLengthCm: 'Arm Length (cm)',
    flexibility: 'Flexibility Level',
    flexLow: 'Low (cannot touch toes)',
    flexMed: 'Medium (touches toes with slight bend)',
    flexHigh: 'High (palms flat on floor)',
    ridingStyle: 'Cycling Modality',
    roadBike: 'Road Cycling (Endurance / Race)',
    mtbBike: 'Mountain Bike (MTB XC / Trail)',
    ttBike: 'Time Trial / Triathlon (Aero)',
    gravelBike: 'Gravel / Mixed Terrain',

    // Bike Measurements
    bikeSectionTitle: 'Bicycle Geometry & Components',
    bikeBrandModel: 'Bicycle Brand & Model',
    bikeBrandModelPlaceholder: 'e.g. Specialized Tarmac SL7',
    frameSizeCm: 'Frame Size (cm or size)',
    frameHelp: 'e.g. 54 cm, 56 cm or M/L',
    handlebarWidthMm: 'Handlebar Width (mm)',
    handlebarHelp: 'e.g. 400, 420 or 440 mm (Road) or 720-760 mm (MTB)',
    stemLengthMm: 'Stem Length (mm)',
    stemHelp: 'e.g. 90, 100, 110 mm',
    crankLengthMm: 'Crank Length (mm)',
    crankHelp: 'e.g. 165, 170, 172.5 or 175 mm',
    currentSaddleHeightCm: 'Current Saddle Height (cm)',
    currentSaddleHelp: 'From center of bottom bracket along seat tube to saddle top.',

    // Immediate Theoretical Panel
    theoreticalTitle: 'Theoretical Biomechanical Estimates (Pre-analysis)',
    lemondSaddleHeight: 'Recommended Saddle Height (LeMond Formula):',
    hamley109SaddleHeight: 'Recommended Height (109% Hamley Method):',
    saddleComparison: 'Difference compared to current saddle height:',
    estimatedFrameSize: 'Estimated Frame Size:',
    recommendedHandlebarWidth: 'Recommended Handlebar Width:',
    recommendedCrankLength: 'Recommended Crank Length:',
    proceedToCameraBtn: 'Proceed to Live Camera Posture Analysis →',
    fillRequiredFields: 'Please enter Name, Height, and Inseam to proceed.',

    // Step 2: Live Camera Analysis
    liveAnalysisTitle: 'Meticulous Real-Time Body Analysis',
    liveAnalysisSubtitle: 'Position yourself sideways on your bicycle mounted on a trainer or steady support for accurate capture.',
    cameraSettings: 'Capture Settings',
    selectCamera: 'Device Camera:',
    cameraFacingUser: 'Front Camera',
    cameraFacingEnvironment: 'Rear Camera (Recommended for phones & tablets)',
    profileSide: 'Profile Side Facing Camera:',
    leftProfile: 'Left Profile (Non-drive side)',
    rightProfile: 'Right Profile (Drive side)',
    viewPlaneLabel: 'Viewing Plane:',
    sagittalPlane: 'Sagittal Profile (Side)',
    frontalPlane: 'Frontal Plane (Head-on)',
    frontalTitle: 'Frontal Knee Tracking & Q-Factor',
    frontalTrackingLabel: 'Frontal Tracking:',
    frontalValgus: 'Dynamic Valgus',
    frontalVarus: 'Dynamic Varus',
    frontalOptimal: 'Optimal Linear Tracking',
    qFactorAdvice: 'Q-Factor / Insole Recommendation:',
    pedalingSmoothnessLabel: 'Pedaling Smoothness Index (PSI):',
    offlineModeNotice: 'Offline Mode: Data saved locally in browser (IndexedDB)',
    syncPendingNotice: 'Sync Pending Offline Sessions',
    resolution: 'Resolution:',
    zoom: 'Zoom:',
    apply: 'Apply',
    startLiveBtn: '▶ Start Live Analysis',
    pauseLiveBtn: '⏸ Pause Analysis',
    audioAlertsToggle: 'Audio Alerts',
    captureSnapshotBtn: '📸 Record Frame / Snapshot',
    snapshotSavedSuccess: 'Snapshot recorded to session successfully!',
    completeSessionBtn: '🏁 Complete Session & Generate Report',
    noAnglesDetected: 'No pose detected yet. Step back until your whole body is visible in the frame.',
    connectingServer: 'Synchronizing session data with backend...',
    tabLiveMode: '📹 Live Camera',
    tabVideoMode: '📁 Video File (Upload)',
    uploadVideoPrompt: 'Click or drop a video file (.mp4, .mov, .webm) to analyze bike fit',
    exportGifBtn: '🎞 Export Animated GIF',
    exportClipBtn: '🎥 Download Video Clip',
    anglesTimelineTitle: '📈 Angles Evolution Along Video',
    videoSummaryTitle: '🎯 Video Movements & Diagnostics',
    pedalCycles: 'Pedal Cycles:',
    avgBdc: 'Avg BDC Extension:',
    torsoStability: 'Torso Oscillation:',

    // Joints & Live Angles
    kneeAngleLabel: 'Knee (Extension at Bottom Dead Center):',
    backAngleLabel: 'Torso / Back (Inclination to horizontal):',
    armAngleLabel: 'Arm / Elbow (Flexion):',
    shoulderAngleLabel: 'Shoulder (Angle to torso):',
    ankleAngleLabel: 'Ankle (Plantar flexion at BDC):',
    headAngleLabel: 'Head / Cervical (Inclination):',
    targetRange: 'Target range:',
    statusCompliant: 'Optimal',
    statusNeedsAdjustment: 'Needs Adjustment',

    // BDC & Cadence
    cadenceBadge: 'Cadence',
    cadenceRpm: 'Cadence: {rpm} RPM',
    bdcDetected: 'Bottom Dead Center (BDC) Captured',
    bdcKneeAngle: 'BDC Extension:',

    // KOPS & Plumb Line
    kopsTitle: 'KOPS Alignment (Saddle Fore/Aft)',
    kopsPlumbLine: 'KOPS Plumb Line',
    kopsAligned: 'Aligned / Neutral',
    kopsAhead: 'Knee Ahead',
    kopsBehind: 'Knee Behind',

    // Voice & Audio Alerts
    voiceAlertsToggle: 'Voice Warnings',
    voiceKneeLow: 'Attention to knee: saddle is too low.',
    voiceKneeHigh: 'Attention to knee: saddle is too high.',
    voiceBackAggressive: 'Torso angle is excessively aggressive.',

    // Stabilization and Joint Focus
    smoothingLabel: 'Noise Smoothing',
    smoothingOff: 'Off (Fastest)',
    smoothingLow: 'Low',
    smoothingMedium: 'Balanced (Recommended)',
    smoothingHigh: 'Studio High Precision',
    focusLabel: 'Joint Focus',
    focusAll: 'All Joints',
    focusKnee: 'Focus Knee & Orbit',
    focusHip: 'Focus Hip & Torso',
    focusAnkle: 'Focus Ankle & Foot',
    focusCockpit: 'Focus Cockpit (Arms/Shoulders)',
    focusKops: 'Focus KOPS Line',
    calibrateManualMarkerBtn: '📍 Calibrate Manual Point',
    manualCalibratingActive: 'Manual Calibration Active',
    manualCalibPrompt: 'Click on video exactly on the target joint (or physical sticker).',
    cancelManualCalib: 'Cancel Manual Calibration',
    clearManualMarkersBtn: 'Clear Manual Markers',
    manualMarkerCalibratedSuccess: 'Manual marker calibrated and locked to the joint!',
    camLockedWarning: 'Camera is locked or in use by another app (e.g. OBS Studio, Teams). Close background camera apps and select your physical camera.',

    // Bilateral Test
    bilateralMode: 'Bilateral Test (Left + Right)',
    stepLeftProfile: 'Step 1: Record Left Profile',
    turnBikePrompt: 'Great job! Now turn your bike around to record the right profile.',
    stepRightProfile: 'Step 2: Record Right Profile',
    symmetryIndex: 'Symmetry Index (SI)',
    bilateralReportTitle: 'Bilateral Symmetry Analysis',

    // Spatial Wheel Calibration & Drop
    wheelCalibBtn: 'Calibrate Scale with Wheel',
    wheelCalibPrompt: 'Click the top and bottom of the bike tire on screen to calibrate metric scale.',
    saddleDropLabel: 'Saddle-to-Handlebar Drop',
    cockpitReachLabel: 'Cockpit Reach',
    measureDropBtn: 'Measure Drop (Saddle ➔ Bar)',

    // Slow-Motion & Scrubber
    recordClipBtn: 'Record Clip (6s)',
    recordingClip: 'Capturing high-precision frames...',
    scrubberTitle: 'Frame-by-Frame Inspection (Slow-Motion)',
    playSlow: 'Play 0.25x',
    pauseClip: 'Pause',
    prevFrame: '⏮ -1 Frame',
    nextFrame: '+1 Frame ⏭',
    exitSlowMo: 'Back to Live',

    // IoT Web Bluetooth Sensors
    connectBleBtn: 'Connect BLE Sensor (Watts / RPM)',
    bleConnected: 'Sensor Connected',
    blePowerWatts: 'Power: {watts} W',
    bleHeartRate: 'Heart Rate: {bpm} BPM',

    // Split-Screen Comparator
    tabComparator: '4. Before vs After Comparator',
    comparatorTitle: 'Before vs After Visual Comparator (Split-Screen)',
    comparatorSubtitle: 'Compare two sessions side by side to validate biomechanical adjustments.',
    sessionA: 'Previous Session (Pre-Fit)',
    sessionB: 'Subsequent Session (Post-Fit)',
    evolutionDeltas: 'Biomechanical Evolution & Deltas',
    selectSessionPrompt: 'Select two athlete sessions to generate comparison',

    // PDF Report
    downloadPdfBtn: 'Download Official PDF Report',
    generatingPdf: 'Compiling professional PDF...',

    // Live Diagnostics & Actions
    liveGuidanceTitle: 'Real-Time Biomechanical Guidance',
    saddleActionTitle: 'Recommended Saddle Adjustment:',
    cockpitActionTitle: 'Handlebar / Cockpit Adjustment:',

    // Step 3: Final Report & Diagnostics
    reportTitle: 'Final BikeFit Report & Physical Adjustments',
    reportSubtitle: 'Consolidated results from your dynamic cycling posture analysis.',
    cyclistProfileTitle: 'Cyclist & Bicycle Profile',
    complianceScore: 'Overall Biomechanical Compliance Score',
    measuredAveragesTitle: 'Average Joint Angles Recorded While Pedaling',
    physicalActionsTitle: 'Recommended Physical Adjustments Checklist',
    newSessionBtn: '↺ Start New BikeFit Session',
    printReportBtn: '🖨 Print Report / Save PDF',
    medicalDisclaimer: 'Notice: This software is designed for ergonomic comfort and athletic cycling optimization. It does not replace clinical or orthopedic evaluation for pre-existing injuries.'
  }
};

export function useI18n() {
  const translate = (key) => messages[locale.value]?.[key] || messages['pt'][key] || key;
  const t = computed(() => translate);
  const setLocale = (nextLocale) => {
    locale.value = nextLocale === 'en' ? 'en' : 'pt';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('locale', locale.value);
    }
  };
  return { locale, t, setLocale };
}
