/**
 * Serviço de áudio e síntese de voz (Web Audio API + Web Speech API).
 *
 * Fornece feedback sonoro e avisos de voz falados em Português e Inglês
 * quando os ângulos articulares saem do intervalo ergonómico por tempo excessivo.
 */
class AudioFeedbackService {
  constructor() {
    this.audioCtx = null;
    this.enabled = true;
    this.voiceEnabled = true;
    this.lastBeepTime = 0;
    this.lastSpeakTime = 0;
    this.outOfRangeDuration = 0; // segundos consecutivos fora do intervalo
  }

  init() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
  }

  playBeep(frequency = 440, duration = 0.25, type = 'sine') {
    if (!this.enabled || typeof window === 'undefined') return;
    const now = Date.now();
    if (now - this.lastBeepTime < 3000) return;
    this.lastBeepTime = now;

    try {
      this.init();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch {
      // Ignorar bloqueios de autoplay pelo navegador
    }
  }

  playAlert(type = 'warning') {
    const freq = type === 'warning' ? 330 : 660;
    this.playBeep(freq, 0.3);
  }

  speak(text, lang = 'pt') {
    if (!this.voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    const now = Date.now();
    // Debounce de voz de 8 segundos para evitar sobreposição
    if (now - this.lastSpeakTime < 8000) return;
    this.lastSpeakTime = now;

    try {
      window.speechSynthesis.cancel(); // Parar frases anteriores
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'en' ? 'en-US' : 'pt-PT';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      // Tentar selecionar voz nativa em português se disponível
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const prefix = lang === 'en' ? 'en' : 'pt';
        const targetVoice = voices.find(v => v.lang.startsWith(prefix));
        if (targetVoice) {
          utterance.voice = targetVoice;
        }
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Erro ao reproduzir síntese de voz:', e);
    }
  }

  toggleAudio(state) {
    this.enabled = state !== undefined ? state : !this.enabled;
    return this.enabled;
  }

  toggleVoice(state) {
    this.voiceEnabled = state !== undefined ? state : !this.voiceEnabled;
    return this.voiceEnabled;
  }
}

export const audioService = new AudioFeedbackService();
