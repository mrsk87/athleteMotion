/**
 * Componente de Ajuda Contextual (HelpTip).
 *
 * Responsabilidade:
 * - Mostrar um selo "?" que explica, em detalhe, o que é uma medida e como se
 *   mede — com desenho técnico, fórmula, passos e fonte.
 * - Funcionar com rato (hover), teclado (foco) e toque (clique), porque "hover"
 *   não existe em telemóvel.
 * - Garantir que **só um painel está aberto de cada vez**: com vários selos na
 *   mesma página, painéis acumulados tapavam o formulário (e em telemóvel
 *   ficavam presos abertos).
 *
 * O conteúdo é passado por propriedades (texto já traduzido) para que o
 * componente seja reutilizável em qualquer ecrã da aplicação.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { getDiagram } from './diagrams.js';

let uid = 0;

/**
 * Estado partilhado por todas as instâncias (âmbito do módulo): o selo que está
 * aberto neste momento. Abrir um fecha automaticamente o anterior.
 */
const activeTip = ref(null);

export default {
  name: 'HelpTip',
  props: {
    /** Título curto da medida (obrigatório). */
    title: { type: String, required: true },
    /** Explicação em uma ou duas frases: o que é. `**…**` realça o essencial. */
    summary: { type: String, default: '' },
    /** Passos concretos de medição (o "como"). */
    steps: { type: Array, default: () => [] },
    /** Fórmula usada, mostrada como selo. */
    formula: { type: String, default: '' },
    /** Fonte / força da evidência (o que a regra NÃO garante). */
    source: { type: String, default: '' },
    /** Identificador do desenho em `diagrams.js`. */
    diagram: { type: String, default: '' },
    /** Alinhamento do painel em relação ao selo (`right` ou `left`). */
    placement: { type: String, default: 'right' },
  },
  setup(props) {
    const uniqueId = `helptip-${++uid}`;
    const open = computed(() => activeTip.value === uniqueId);
    let hideTimer = null;

    const diagramSvg = computed(() => getDiagram(props.diagram));

    /**
     * O resumo pode marcar a parte essencial com `**…**` (ex.: onde se mede).
     * Aqui é convertido em partes para o template realçar com `<strong>` —
     * nunca se mostra o asterisco ao utilizador.
     */
    const summaryParts = computed(() =>
      String(props.summary || '')
        .split('**')
        .map((text, index) => ({ text, strong: index % 2 === 1 }))
        .filter((part) => part.text !== ''),
    );

    const show = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      activeTip.value = uniqueId;
    };

    /** Pequeno atraso para o rato poder atravessar o espaço entre selo e painel. */
    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (activeTip.value === uniqueId) activeTip.value = null;
        hideTimer = null;
      }, 160);
    };

    const hide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      if (activeTip.value === uniqueId) activeTip.value = null;
    };

    const toggle = () => (open.value ? hide() : show());

    onBeforeUnmount(() => {
      if (hideTimer) clearTimeout(hideTimer);
      if (activeTip.value === uniqueId) activeTip.value = null;
    });

    return {
      uniqueId,
      open,
      diagramSvg,
      summaryParts,
      show,
      hide,
      toggle,
      scheduleHide,
    };
  },
};
