/**
 * Gestor de Temas da Aplicação (ThemeManager).
 *
 * Responsabilidade:
 * - Guardar, aplicar e persistir o tema ativo (`light`, `dark` ou `sober`).
 * - Expor a lista de temas para a interface (com rótulo, ícone e descrição).
 * - Ler tokens de cor do CSS para os canvas (gráficos), com fallback seguro
 *   para ambientes sem DOM (testes em Node).
 *
 * O tema é aplicado por `data-theme` no elemento `<html>`, onde o ficheiro
 * `src/styles/theme.css` define todos os tokens semânticos.
 */

export const THEME_STORAGE_KEY = 'athleteMotion.theme';

export const THEMES = [
  {
    id: 'light',
    label: 'Claro',
    icon: '☀️',
    description: 'Fundo claro, cartões brancos e azul de alto contraste — oficina e luz do dia.',
  },
  {
    id: 'dark',
    label: 'Escuro',
    icon: '🌙',
    description: 'O modo escuro da aplicação, com acento ciano e brilho nos elementos ativos.',
  },
  {
    id: 'sober',
    label: 'Sóbrio',
    icon: '🩶',
    description: 'Cinzentos e azuis escuros, sem brilhos nem preto puro — sessões longas em penumbra.',
  },
];

export const DEFAULT_THEME = 'dark';

/**
 * Paleta de gráficos por tema.
 *
 * Serve de recurso quando não há DOM para ler os tokens (testes em Node) e
 * espelha exatamente os valores definidos em `src/styles/theme.css`.
 */
const CHART_FALLBACK = {
  light: {
    '--chart-bg': '#ffffff',
    '--chart-grid': '#e0e7ef',
    '--chart-axis': '#6b7c90',
    '--chart-band-fill': 'rgba(15, 138, 95, 0.12)',
    '--chart-band-stroke': 'rgba(15, 138, 95, 0.45)',
    '--chart-playhead': '#0b74c4',
    '--chart-playhead-fill': 'rgba(11, 116, 196, 0.12)',
    '--chart-threshold': '#c62f2f',
    '--chart-series-knee': '#0b74c4',
    '--chart-series-torso': '#b8730a',
    '--chart-series-arm': '#6d3fc0',
    '--chart-series-head': '#b0336b',
    '--text-2': '#46586c',
  },
  dark: {
    '--chart-bg': '#18181b',
    '--chart-grid': '#27272a',
    '--chart-axis': '#71717a',
    '--chart-band-fill': 'rgba(16, 185, 129, 0.12)',
    '--chart-band-stroke': 'rgba(16, 185, 129, 0.4)',
    '--chart-playhead': '#38bdf8',
    '--chart-playhead-fill': 'rgba(56, 189, 248, 0.18)',
    '--chart-threshold': '#ef4444',
    '--chart-series-knee': '#38bdf8',
    '--chart-series-torso': '#f59e0b',
    '--chart-series-arm': '#c084fc',
    '--chart-series-head': '#f472b6',
    '--text-2': '#a1a1aa',
  },
  sober: {
    '--chart-bg': '#232833',
    '--chart-grid': '#313a4a',
    '--chart-axis': '#7d8a9c',
    '--chart-band-fill': 'rgba(79, 143, 116, 0.12)',
    '--chart-band-stroke': 'rgba(79, 143, 116, 0.4)',
    '--chart-playhead': '#8fb3d1',
    '--chart-playhead-fill': 'rgba(143, 179, 209, 0.14)',
    '--chart-threshold': '#a75b5b',
    '--chart-series-knee': '#6f9fc4',
    '--chart-series-torso': '#b08c53',
    '--chart-series-arm': '#9b8fc0',
    '--chart-series-head': '#b07f9b',
    '--text-2': '#a8b4c4',
  },
};

class ThemeManagerService {
  constructor() {
    this.theme = DEFAULT_THEME;
    this.listeners = new Set();
    this.initialized = false;
  }

  static isValidTheme(id) {
    return THEMES.some((theme) => theme.id === id);
  }

  /** Tema guardado pelo utilizador, se existir e for válido. */
  static readStoredTheme() {
    try {
      const stored = window?.localStorage?.getItem(THEME_STORAGE_KEY);
      return ThemeManagerService.isValidTheme(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  /**
   * Tema preferido pelo sistema: claro pede claro, escuro pede escuro (o sóbrio
   * é sempre uma escolha explícita do utilizador).
   */
  static readSystemTheme() {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return DEFAULT_THEME;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return DEFAULT_THEME;
    }
  }

  static detectTheme() {
    return ThemeManagerService.readStoredTheme() || ThemeManagerService.readSystemTheme();
  }

  /** Aplica o tema no documento e avisa os interessados. */
  init() {
    if (this.initialized) return this.theme;
    this.initialized = true;
    this.theme = ThemeManagerService.detectTheme();
    this.apply(this.theme, { persist: false });
    return this.theme;
  }

  getTheme() {
    return this.theme;
  }

  getThemes() {
    return THEMES;
  }

  isActive(id) {
    return this.theme === id;
  }

  /**
   * Muda o tema. Devolve `true` quando o tema é válido e aplicado.
   */
  setTheme(id, { persist = true } = {}) {
    if (!ThemeManagerService.isValidTheme(id)) return false;
    this.apply(id, { persist });
    return true;
  }

  apply(id, { persist = true } = {}) {
    this.theme = id;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', id);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', id === 'light' ? '#eef2f7' : '#1b1f27');
    }
    if (persist) {
      try {
        window?.localStorage?.setItem(THEME_STORAGE_KEY, id);
      } catch {
        /* Modo privado sem localStorage: o tema vale para a sessão. */
      }
    }
    this.listeners.forEach((listener) => {
      try {
        listener(id);
      } catch (error) {
        console.warn('Falha ao notificar mudança de tema:', error);
      }
    });
  }

  onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Lê um token de cor do tema ativo (para desenhar em canvas).
   * Sem DOM (testes Node) devolve o valor do tema, ou `fallback`.
   */
  token(name, fallback = '') {
    const themeFallback = CHART_FALLBACK[this.theme]?.[name] || fallback;
    try {
      if (typeof window === 'undefined' || !document?.documentElement) return themeFallback;
      const value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return value || themeFallback;
    } catch {
      return themeFallback;
    }
  }

  /** Vários tokens de uma vez, na ordem pedida. */
  tokens(...names) {
    return names.map((name) => this.token(name));
  }
}

export const themeManager = new ThemeManagerService();
export default themeManager;
