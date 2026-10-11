/**
 * Componente Raiz App
 * 
 * Responsabilidade:
 * Prover injeção de internacionalização (i18n), estado do idioma selecionado
 * e versão semântica da aplicação.
 */

import { useI18n } from './i18n';
import packageInfo from '../package.json';

export default {
  name: 'App',
  setup() {
    const { locale, t, setLocale } = useI18n();
    const version = packageInfo.version || '0.1.0';

    return {
      locale,
      t,
      setLocale,
      version,
    };
  },
};

