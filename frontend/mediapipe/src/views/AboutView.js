/**
 * Vista Sobre (AboutView)
 */
import { useI18n } from '../i18n';

export default {
  name: 'AboutView',
  setup() {
    const { t } = useI18n();
    return { t };
  },
};

