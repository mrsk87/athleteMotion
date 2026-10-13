/**
 * Desenhos (SVG em linha) que acompanham as ajudas contextuais.
 *
 * Cada entrada é um desenho técnico simples, em traço, que mostra **o que se
 * mede e onde** — a peça que faltava para o utilizador saber a que se refere
 * cada número. Todos usam `currentColor` e classes semânticas de cor, pelo que
 * funcionam nos três temas (claro, escuro e sóbrio) sem duplicar desenhos.
 *
 * Nota: o conteúdo é estático (nunca vem do utilizador), pelo que pode ser
 * injetado com `v-html` sem risco de injeção.
 */

const LABEL = 'help-svg-label';
const DIM = 'help-svg-dim';
const EMPHASIS = 'help-svg-emphasis';
const BODY = 'help-svg-body';

/** Moldura comum: 260 × 132, com o mesmo estilo em todos os desenhos. */
const frame = (inner) =>
  `<svg class="help-svg" viewBox="0 0 260 132" role="img" aria-hidden="true" focusable="false">${inner}</svg>`;

/** Rótulo curto com halo para ser legível sobre qualquer fundo. */
const label = (x, y, text, cls = LABEL, anchor = 'start') =>
  `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;

export const DIAGRAMS = {
  /* Como se mede o cavalo (entre-perna) — base de todas as estimativas. */
  inseam: frame(`
    <line class="${BODY}" x1="40" y1="14" x2="40" y2="122" stroke-dasharray="4 3" />
    ${label(14, 26, 'parede')}
    <circle class="${BODY}" cx="76" cy="24" r="8" />
    <line class="${BODY}" x1="76" y1="32" x2="80" y2="66" />
    <line class="${BODY}" x1="80" y1="66" x2="78" y2="112" />
    <line class="${BODY}" x1="60" y1="96" x2="100" y2="96" />
    <rect class="${EMPHASIS}" x="56" y="88" width="48" height="8" rx="2" />
    <line class="${DIM}" x1="112" y1="96" x2="112" y2="122" />
    <line class="${DIM}" x1="112" y1="96" x2="118" y2="96" />
    <line class="${DIM}" x1="112" y1="122" x2="118" y2="122" />
    ${label(124, 114, 'cavalo: solo → topo do livro')}
    <line class="${BODY}" x1="32" y1="122" x2="228" y2="122" stroke-dasharray="3 3" />
    ${label(178, 134, 'solo')}
  `),

  /* LeMond: cavalo × 0,883, do eixo pedaleiro ao topo do selim. */
  lemond: frame(`
    <circle class="${EMPHASIS}" cx="86" cy="104" r="6" />
    ${label(60, 122, 'eixo pedaleiro')}
    <line class="${EMPHASIS}" x1="86" y1="104" x2="130" y2="26" />
    <rect class="${BODY}" x="114" y="14" width="34" height="8" rx="3" />
    ${label(152, 22, 'topo do selim')}
    <circle class="${DIM}" cx="86" cy="104" r="14" fill="none" stroke-dasharray="3 3" />
    <line class="${DIM}" x1="86" y1="104" x2="86" y2="72" />
    ${label(96, 74, 'medida ao longo')}
    ${label(96, 86, 'do tubo do selim')}
    <line class="${BODY}" x1="52" y1="132" x2="212" y2="132" stroke-dasharray="3 3" />
    ${label(24, 58, 'cavalo')}
    ${label(24, 70, '× 0,883')}
    ${label(24, 82, '= 74,2 cm')}
  `),

  /* Regra dos 109% (Hamley): do eixo do PEDAL no ponto morto inferior. */
  hamley109: frame(`
    <circle class="${BODY}" cx="86" cy="98" r="6" />
    ${label(58, 116, 'eixo pedaleiro')}
    <circle class="${EMPHASIS}" cx="86" cy="124" r="6" />
    ${label(100, 128, 'pedal no ponto morto inferior')}
    <line class="${EMPHASIS}" x1="86" y1="124" x2="132" y2="24" />
    <rect class="${BODY}" x="116" y="12" width="34" height="8" rx="3" />
    ${label(154, 20, 'topo do selim')}
    <path class="${DIM}" d="M 78 124 L 70 124 L 70 36" fill="none" stroke-dasharray="3 3" />
    ${label(14, 92, 'cavalo')}
    ${label(14, 104, '× 1,09')}
    ${label(14, 116, '= 91,6 cm')}
    <line class="${BODY}" x1="52" y1="132" x2="214" y2="132" stroke-dasharray="3 3" />
  `),

  /* Comparação com a altura atual: para que lado mexer o selim. */
  saddleComparison: frame(`
    <line class="${BODY}" x1="60" y1="112" x2="220" y2="112" stroke-dasharray="3 3" />
    <line class="${BODY}" x1="72" y1="112" x2="72" y2="40" />
    <rect class="${BODY}" x="56" y="30" width="32" height="8" rx="3" />
    ${label(14, 34, 'atual')}
    <line class="${DIM}" x1="150" y1="112" x2="150" y2="22" />
    <rect class="${EMPHASIS}" x="134" y="14" width="32" height="8" rx="3" />
    ${label(172, 22, 'teórica (LeMond)')}
    <path class="${EMPHASIS}" d="M 96 66 L 130 66" marker-end="url(#arrowHelp)" />
    <defs>
      <marker id="arrowHelp" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M 0 0 L 6 3 L 0 6 z" class="help-svg-emphasis" />
      </marker>
    </defs>
    ${label(96, 58, 'diferença')}
    ${label(96, 84, '(≈ ±1,5 cm é normal)')}
    <path class="${DIM}" d="M 206 14 L 206 30" stroke-dasharray="3 3" />
    ${label(214, 48, 'mexer o selim')}
    ${label(214, 60, 'para este lado')}
  `),

  /* Tamanho de quadro: comprimento do tubo do selim, do eixo pedaleiro AO TOPO (C-T). */
  frameSize: frame(`
    <line class="${BODY}" x1="86" y1="104" x2="132" y2="26" />
    <circle class="${BODY}" cx="86" cy="104" r="5" />
    ${label(48, 118, 'eixo pedaleiro')}
    <rect class="${EMPHASIS}" x="112" y="20" width="40" height="6" rx="3" />
    ${label(158, 24, 'topo do tubo do selim')}
    <line class="${BODY}" x1="86" y1="104" x2="196" y2="96" stroke-dasharray="3 3" />
    <line class="${BODY}" x1="196" y1="96" x2="176" y2="26" stroke-dasharray="3 3" />
    <line class="${BODY}" x1="132" y1="26" x2="176" y2="26" />
    <line class="${EMPHASIS}" x1="132" y1="34" x2="132" y2="98" />
    <line class="${EMPHASIS}" x1="120" y1="34" x2="132" y2="34" />
    <line class="${EMPHASIS}" x1="120" y1="98" x2="132" y2="98" />
    ${label(140, 62, 'tubo do selim')}
    ${label(140, 74, 'centro \u2192 topo (C-T)')}
    ${label(140, 86, '= o "54" do quadro')}
    ${label(14, 44, 'cavalo')}
    ${label(14, 56, '× 0,665')}
    ${label(14, 68, '= 55,9 cm')}
  `),

  /* Tubo superior / ETT: horizontal entre o eixo do tubo do selim e o eixo do tubo de direção.
     O avan\u00e7o aperta no TUBO DE DIRE\u00c7\u00c3O \u2014 o tubo superior n\u00e3o vai at\u00e9 ao avan\u00e7o. */
  topTube: frame(`
    <line class="${BODY}" x1="70" y1="112" x2="118" y2="40" />
    <circle class="${BODY}" cx="70" cy="112" r="5" />
    ${label(20, 126, 'eixo pedaleiro')}
    <line class="${BODY}" x1="118" y1="22" x2="118" y2="126" stroke-dasharray="3 3" />
    ${label(84, 18, 'eixo do tubo do selim', LABEL, 'middle')}
    <line class="${BODY}" x1="196" y1="22" x2="200" y2="74" />
    ${label(206, 40, 'tubo de')}
    ${label(206, 52, 'direção')}
    <line class="${EMPHASIS}" x1="200" y1="30" x2="240" y2="30" />
    ${label(216, 20, 'avanço')}
    <line class="${BODY}" x1="118" y1="40" x2="196" y2="40" />
    <line class="${EMPHASIS}" x1="118" y1="96" x2="196" y2="96" />
    <line class="${EMPHASIS}" x1="118" y1="90" x2="118" y2="102" />
    <line class="${EMPHASIS}" x1="196" y1="90" x2="196" y2="102" />
    ${label(157, 112, 'ETT (horizontal)', LABEL, 'middle')}
    ${label(157, 124, 'não vai até ao avanço', LABEL, 'middle')}
  `),

  /* Largura do guiador: medida fora-a-fora, à altura dos ombros. */
  handlebarWidth: frame(`
    <line class="${EMPHASIS}" x1="58" y1="40" x2="186" y2="40" />
    <line class="${EMPHASIS}" x1="58" y1="30" x2="58" y2="50" />
    <line class="${EMPHASIS}" x1="186" y1="30" x2="186" y2="50" />
    <circle class="${BODY}" cx="122" cy="22" r="9" />
    <path class="${BODY}" d="M 122 31 L 108 46 M 122 31 L 136 46" fill="none" />
    ${label(92, 14, 'largura biacromial')}
    <path class="${DIM}" d="M 58 92 C 96 74, 148 74, 186 92" fill="none" />
    <line class="${BODY}" x1="46" y1="92" x2="198" y2="92" />
    <circle class="${BODY}" cx="58" cy="92" r="4" />
    <circle class="${BODY}" cx="186" cy="92" r="4" />
    ${label(104, 82, 'guiador: fora a fora')}
    ${label(104, 112, '(ombros ≈ 40 → 400 mm)')}
    ${label(104, 124, '(ombros ≈ 42 → 420 mm)')}
  `),

  /* Reach e drop da curva do guiador: as duas medidas da forma do guiador. */
  handlebarReachDrop: frame(`
    <circle class="${BODY}" cx="60" cy="40" r="7" />
    ${label(20, 26, 'tubo do guiador')}
    <line class="${BODY}" x1="67" y1="40" x2="118" y2="40" />
    <path class="${EMPHASIS}" d="M 118 40 C 144 40, 154 56, 152 74" fill="none" />
    <line class="${EMPHASIS}" x1="152" y1="74" x2="150" y2="100" />
    <circle class="${EMPHASIS}" cx="150" cy="100" r="5" />
    ${label(160, 104, 'fundo da curva')}
    <line class="${DIM}" x1="60" y1="116" x2="150" y2="116" />
    <line class="${DIM}" x1="60" y1="110" x2="60" y2="122" />
    <line class="${DIM}" x1="150" y1="110" x2="150" y2="122" />
    ${label(74, 130, 'reach: tubo → fundo da curva')}
    <line class="${DIM}" x1="42" y1="40" x2="42" y2="100" />
    <line class="${DIM}" x1="36" y1="40" x2="48" y2="40" />
    <line class="${DIM}" x1="36" y1="100" x2="48" y2="100" />
    ${label(6, 66, 'drop')}
    ${label(6, 78, '115–130 mm')}
  `),

  /* Comprimento do avanço: do eixo do tubo de direção ao centro do guiador. */
  stemLength: frame(`
    <line class="${BODY}" x1="70" y1="18" x2="70" y2="122" stroke-dasharray="4 3" />
    ${label(14, 32, 'eixo do tubo')}
    ${label(14, 44, 'de direção')}
    <line class="${EMPHASIS}" x1="70" y1="46" x2="140" y2="46" />
    <circle class="${EMPHASIS}" cx="140" cy="46" r="9" fill="none" />
    ${label(154, 42, 'tubo do')}
    ${label(154, 54, 'guiador')}
    <line class="${DIM}" x1="70" y1="78" x2="140" y2="78" />
    <line class="${DIM}" x1="70" y1="72" x2="70" y2="84" />
    <line class="${DIM}" x1="140" y1="72" x2="140" y2="84" />
    ${label(72, 94, 'comprimento do avanço (centro a centro)')}
    ${label(72, 110, 'ex.: 90 / 100 / 110 mm')}
  `),

  /* Comprimento do crenque: do eixo do pedal ao eixo pedaleiro. */
  crankLength: frame(`
    <circle class="${BODY}" cx="96" cy="72" r="26" fill="none" stroke-dasharray="3 3" />
    <circle class="${EMPHASIS}" cx="96" cy="72" r="6" />
    ${label(60, 62, 'eixo pedaleiro')}
    <line class="${EMPHASIS}" x1="96" y1="72" x2="150" y2="96" />
    <circle class="${EMPHASIS}" cx="150" cy="96" r="5" />
    ${label(158, 92, 'eixo do pedal')}
    ${label(158, 104, '= 165 / 170 / 172,5 / 175 mm')}
    ${label(14, 116, 'mede-se no centro do eixo do pedal até ao centro do eixo pedaleiro')}
    ${label(14, 128, '— com o comprimento gravado na própria biela (ex.: 172,5)')}
  `),

  /* CromaTrack: onde colocar os marcadores coloridos (vista lateral, lado visível). */
  chromaMarkers: frame(`
    <circle class="${BODY}" cx="78" cy="26" r="9" />
    <line class="${BODY}" x1="78" y1="35" x2="94" y2="60" />
    <line class="${BODY}" x1="94" y1="60" x2="104" y2="76" />
    <line class="${BODY}" x1="86" y1="38" x2="112" y2="48" />
    <line class="${BODY}" x1="112" y1="48" x2="128" y2="62" />
    <line class="${BODY}" x1="104" y1="76" x2="100" y2="104" />
    <line class="${BODY}" x1="100" y1="104" x2="108" y2="126" />
    <circle cx="90" cy="40" r="5" fill="#facc15" />
    <circle cx="128" cy="62" r="5" fill="#ef4444" />
    <circle cx="94" cy="60" r="5" fill="#22d3ee" />
    <circle cx="104" cy="76" r="5" fill="#22c55e" />
    <circle cx="108" cy="126" r="5" fill="#e879f9" />
    ${label(140, 44, 'ombro — amarelo')}
    ${label(140, 58, 'cotovelo — vermelho')}
    ${label(140, 72, 'anca — ciano')}
    ${label(140, 86, 'joelho — verde')}
    ${label(140, 100, 'tornozelo — magenta')}
    ${label(14, 14, 'no lado visivel a camara, sobre a pele')}
    ${label(14, 26, 'ou presos na roupa, sempre visiveis')}
  `),

  /* Peso: é o dado do sag da suspensão (25–33% atrás, 15–20% à frente, com o atleta a bordo). */
  weight: frame(`
    <rect class="${BODY}" x="62" y="92" width="96" height="26" rx="5" />
    ${label(66, 110, 'balança: peso em kg')}
    <line class="${EMPHASIS}" x1="110" y1="92" x2="110" y2="46" />
    ${label(116, 62, 'sag com o atleta')}
    ${label(116, 74, 'a bordo')}
    <rect class="${EMPHASIS}" x="96" y="30" width="28" height="16" rx="3" />
    ${label(30, 42, 'suspensão')}
    <line class="${DIM}" x1="62" y1="72" x2="96" y2="72" />
    <line class="${DIM}" x1="62" y1="66" x2="62" y2="78" />
    <line class="${DIM}" x1="96" y1="66" x2="96" y2="78" />
    ${label(30, 88, '25–33% atrás')}
    ${label(30, 100, '15–20% à frente')}
    ${label(174, 40, 'não altera')}
    ${label(174, 52, 'alvos angulares')}
  `),

  /* Número de sapato: define o comprimento do pé e o recuo do travessão no eixo do pedal. */
  shoeSize: frame(`
    <path class="${BODY}" d="M40 84 C40 70 66 66 84 62 C100 58 112 50 126 50 C142 50 152 60 152 72 C152 84 138 90 120 92 L40 96 Z" />
    ${label(30, 46, 'sapato (EU)')}
    ${label(30, 58, 'ex.: 43')}
    <line class="${DIM}" x1="40" y1="106" x2="152" y2="106" />
    <line class="${DIM}" x1="40" y1="100" x2="40" y2="112" />
    <line class="${DIM}" x1="152" y1="100" x2="152" y2="112" />
    ${label(154, 110, 'comprimento do pé')}
    <circle class="${EMPHASIS}" cx="126" cy="72" r="7" />
    ${label(176, 74, '1º metatarso')}
    <line class="${EMPHASIS}" x1="126" y1="72" x2="186" y2="72" />
    <circle class="${EMPHASIS}" cx="186" cy="72" r="6" />
    ${label(192, 68, 'eixo do pedal')}
    ${label(192, 80, '9–11 mm no 42–43')}
  `),

  /* Cintura: perímetro abdominal — contexto de flexão da anca, não alvo angular. */
  /* Órbita do pé: o circuito fechado que o tornozelo desenha em cada pedalada. */
  footOrbit: frame(`
    <circle class="${BODY}" cx="104" cy="70" r="44" stroke-dasharray="4 3" />
    <circle class="${DIM}" cx="104" cy="70" r="5" />
    ${label(120, 74, 'eixo pedaleiro')}
    <path class="${EMPHASIS}" d="M150 34 A 62 40 -18 1 1 146 110" fill="none" marker-end="url(#orbitArrow)" />
    ${label(16, 30, 'órbita do pé')}
    ${label(16, 42, 'ao longo das voltas')}
    ${label(16, 96, 'sentido =')}
    ${label(16, 108, 'rotação do cranque')}
    <defs>
      <marker id="orbitArrow" markerWidth="7" markerHeight="7" refX="4" refY="4" orient="auto">
        <path class="${EMPHASIS}" d="M0 0 L7 4 L0 8 Z" fill="currentColor" />
      </marker>
    </defs>
  `),

  waist: frame(`
    <circle class="${BODY}" cx="96" cy="32" r="12" />
    <line class="${BODY}" x1="96" y1="44" x2="96" y2="84" />
    <line class="${BODY}" x1="96" y1="56" x2="66" y2="74" />
    <line class="${BODY}" x1="96" y1="56" x2="126" y2="74" />
    <line class="${BODY}" x1="96" y1="84" x2="80" y2="122" />
    <line class="${BODY}" x1="96" y1="84" x2="112" y2="122" />
    <rect class="${EMPHASIS}" x="70" y="66" width="52" height="16" rx="8" fill="none" />
    ${label(18, 62, 'fita à altura')}
    ${label(18, 74, 'do umbigo')}
    ${label(18, 86, 'ex.: 84 cm')}
    <line class="${DIM}" x1="122" y1="74" x2="160" y2="74" />
    ${label(166, 70, 'cintura no fim')}
    ${label(166, 82, 'duma expiração')}
    ${label(166, 46, 'não altera')}
    ${label(166, 58, 'alvos angulares')}
  `),
};

/** Devolve o desenho pedido ou uma string vazia (nunca falha por id inválido). */
export function getDiagram(id) {
  return DIAGRAMS[id] || '';
}

export const DIAGRAM_IDS = Object.keys(DIAGRAMS);
