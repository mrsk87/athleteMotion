/**
 * Conteúdo de ajuda das estimativas teóricas (passo 1 — Antropometria).
 *
 * Cada entrada responde às perguntas que faltavam na interface:
 *  1. **O que é** — o que está a ser medido e entre que pontos.
 *  2. **Como se mede** — passos concretos, para o utilizador reproduzir em casa.
 *  3. **Fórmula** usada nesta aplicação.
 *  4. **Fonte e força da evidência** — incluindo o que a regra NÃO garante.
 *
 * O texto é bilingue (pt/en) e cada entrada aponta para um desenho técnico em
 * `components/common/HelpTip/diagrams.js`.
 *
 * Honestidade de produto: as fórmulas antropométricas clássicas (LeMond, 109%,
 * 0,665 × cavalo) são **pontos de partida de geometria**, não prescrições
 * clínicas; a validação final é a análise de vídeo com o atleta a pedalar.
 */

export const HELP_ENTRIES = {
  inseam: {
    diagram: 'inseam',
    pt: {
      title: 'Cavalo / entre-perna — a medida mais importante do passo 1',
      summary:
        'É a distância, na vertical, do chão até ao períneo (o ponto onde o selim toca no corpo). Praticamente todas as estimativas desta página derivam dela.',
      steps: [
        'Descalço, costas encostadas a uma parede, pés afastados ~15 cm e alinhados com os ombros.',
        'Coloque um livro (ou uma régua rígida) entre as pernas, com o canto a tocar o períneo, e suba-o como se fosse o selim a empurrar.',
        'Nivele o livro com um nível (ou com os olhos) e meça do chão ao bordo superior — em linha reta, sem comprimir.',
        'Erro de 1 cm no cavalo desloca cerca de 0,9 cm na altura do selim: repetir 3 vezes e usar a média.',
      ],
      formula: 'Medida direta (cm)',
      source: 'Antropometria clássica de bike fit. É a medida com maior impacto em todas as estimativas.',
    },
    en: {
      title: 'Inseam — the most important measurement of step 1',
      summary:
        'The vertical distance from the floor to the perineum (where the saddle touches the body). Almost every estimate on this page derives from it.',
      steps: [
        'Barefoot, back against a wall, feet about 15 cm apart and aligned with the shoulders.',
        'Place a book (or rigid ruler) between the legs with its spine against the perineum and pull it up as the saddle would.',
        'Level the book (use a spirit level or your eyes) and measure from the floor to its top edge — straight, without compressing.',
        'A 1 cm error in inseam shifts saddle height by about 0.9 cm: repeat three times and average.',
      ],
      formula: 'Direct measurement (cm)',
      source: 'Classic bike-fit anthropometry. It is the measurement with the largest impact on every estimate.',
    },
  },

  height: {
    diagram: 'inseam',
    pt: {
      title: 'Altura total',
      summary:
        'Serve de contexto e de controlo de coerência: um cavalo invulgarmente alto ou baixo para a altura sugere erro de medição.',
      steps: [
        'Descalço, com os calcanhares, a bacia e as omoplatas na parede.',
        'Olhar em frente e marcar o ponto mais alto da cabeça; medir do chão até essa marca.',
      ],
      formula: 'Medida direta (cm)',
      source: 'Usada para validar o cavalo (o cavalo corresponde tipicamente a 45–50% da altura).',
    },
    en: {
      title: 'Total height',
      summary:
        'Provides context and a sanity check: an unusually high or low inseam for the height usually means a measurement error.',
      steps: [
        'Barefoot with heels, pelvis and shoulder blades against the wall.',
        'Look straight ahead, mark the highest point of the head and measure from the floor to that mark.',
      ],
      formula: 'Direct measurement (cm)',
      source: 'Used to validate the inseam (typically 45–50% of total height).',
    },
  },

  weight: {
    diagram: 'weight',
    pt: {
      title: 'Peso — por que é pedido no início',
      summary:
        'Peso corporal em kg, medido de manhã, sem sapatos e sem roupa pesada. **Não altera nenhum alvo angular**: o que faz é definir o sag da suspensão e a partilha de carga entre selim, mãos e pedais.',
      steps: [
        'Pese-se na mesma balança e à mesma hora (de manhã, em jejum, é o mais reprodutível) e aponte com uma casa decimal.',
        'O peso define o sag de suspensão com o atleta a bordo: 25–33% atrás e 15–20% à frente — confirme com a válvula de sag do amortecedor.',
        'Acima de 90 kg a app avisa para verificar o amortecimento de compressão e a largura do selim, que passam a pesar mais que o ângulo.',
        'Se o peso mudar mais de 3–4 kg numa época, vale a pena refazer o sag antes de mexer em medidas de cockpit.',
      ],
      formula: 'Medida direta (kg)',
      source:
        'FOX — sag de suspensão com o atleta a bordo (prática documentada). O peso não altera os alvos angulares do joelho.',
    },
    en: {
      title: 'Weight — why it is asked at the start',
      summary:
        'Body weight in kg, measured in the morning, without shoes and heavy clothing. It **does not change any joint target**: it sets suspension sag and how load is shared between saddle, hands and pedals.',
      steps: [
        'Weigh yourself on the same scale at the same time (fasting in the morning is the most repeatable) and record one decimal place.',
        'Weight sets suspension sag with the rider on board: 25–33% at the rear and 15–20% at the front — confirm with the shock sag valve.',
        'Above 90 kg the app flags compression damping and saddle width checks, which start to matter more than an angle.',
        'If weight moves by more than 3–4 kg in a season, redo the sag before touching cockpit measurements.',
      ],
      formula: 'Direct measurement (kg)',
      source:
        'FOX — suspension sag with the rider on board (documented practice). Weight does not change knee joint targets.',
    },
  },

  shoeSize: {
    diagram: 'shoeSize',
    pt: {
      title: 'Número de sapato (EU) — o dado dos travessões',
      summary:
        'Tamanho do sapato de ciclismo em numeração europeia. Dá o comprimento aproximado do pé e a **referência de recuo do travessão** em relação ao eixo do pedal.',
      steps: [
        'Use a numeração do sapato de ciclismo (não do ténis de dia-a-dia: as marcas divergem, e é o sapato que fica preso ao pedal).',
        'Comprimento aproximado do pé ≈ (tamanho − 2) × 2/3: um 43 EU dá cerca de 27,3 cm do calcanhar à ponta.',
        'Referência de partida do travessão: centro do 1º metatarso 9–11 mm À FRENTE do eixo do pedal na faixa 42–43, crescendo com o tamanho.',
        'Mover o travessão para trás encurta o alcance ao pedal: depois dessa alteração, reavaliar a altura do selim.',
      ],
      formula: 'Medida direta (EU) → comprimento do pé e faixa de recuo do travessão',
      source:
        'Steve Hogg / MyVeloFit — posição de travessões (prática de fit, orientação de partida; o autor não fixa o sistema de numeração).',
    },
    en: {
      title: 'Shoe size (EU) — the cleat measurement',
      summary:
        'Cycling shoe size in European numbering. It gives the approximate foot length and the **cleat setback reference** relative to the pedal axle.',
      steps: [
        'Use your cycling shoe size (not everyday trainers: brands diverge, and it is the cycling shoe that is attached to the pedal).',
        'Approximate foot length ≈ (size − 2) × 2/3: a EU 43 is about 27.3 cm from heel to toe.',
        'Starting cleat reference: centre of the first metatarsal 9–11 mm AHEAD of the pedal axle in the 42–43 band, growing with size.',
        'Moving the cleat backwards shortens reach to the pedal: after that change, re-check saddle height.',
      ],
      formula: 'Direct measurement (EU) → foot length and cleat setback band',
      source:
        'Steve Hogg / MyVeloFit — cleat position (fit practice, a starting point; the author does not fix the sizing system).',
    },
  },

  waist: {
    diagram: 'waist',
    pt: {
      title: 'Cintura / perímetro abdominal',
      summary:
        'Perímetro da cintura à altura do umbigo. É **contexto**, não um alvo: em posições agressivas é a cintura que costuma limitar a tolerância ao fecho da anca.',
      steps: [
        'Fita métrica à altura do umbigo, horizontal, no fim de uma expiração normal e sem comprimir a pele.',
        'Medir de manhã, em jejum, e repetir duas vezes: a diferença entre medições costuma ser maior que o efeito no fit.',
        'Ler este número em conjunto com o fecho da anca medido às 12h (alvo 50–80°): se a anca fecha pouco, a cintura explica parte disso.',
        'Nenhuma regra desta aplicação muda de alvo por causa da cintura — ela entra no relatório como dado antropométrico.',
      ],
      formula: 'Medida direta (cm)',
      source:
        'Antropometria clínica. Não existe regra de fit publicada que converta a cintura num ângulo: é usada só como contexto, junto do fecho da anca medido no vídeo.',
    },
    en: {
      title: 'Waist / abdominal girth',
      summary:
        'Waist circumference at navel level. It is **context, not a target**: in aggressive positions the waist is usually what limits tolerance to hip closure.',
      steps: [
        'Tape measure at navel level, horizontal, at the end of a normal exhalation and without compressing the skin.',
        'Measure in the morning, fasting, and repeat twice: the spread between measurements is usually larger than its effect on the fit.',
        'Read this number together with hip closure measured at 12h (target 50–80°): if the hip closes little, the waist partly explains it.',
        'No rule in this app changes a target because of waist circumference — it goes into the report as anthropometric data.',
      ],
      formula: 'Direct measurement (cm)',
      source:
        'Clinical anthropometry. No published fit rule converts waist circumference into an angle: it is used only as context, alongside hip closure measured in the video.',
    },
  },

  shoulderWidth: {
    diagram: 'handlebarWidth',
    pt: {
      title: 'Largura biacromial (ombros)',
      summary:
        'É a distância entre as duas extremidades ósseas dos ombros (acrómios) — a referência para escolher a largura do guiador.',
      steps: [
        'De pé, relaxado, com os braços ao longo do corpo.',
        'Peça a alguém para localizar as pontas ósseas no cimo de cada ombro e medir entre elas, por trás.',
        'Não medir "a largura com a camisola" nem com os braços abertos: o valor tem de ser ósseo.',
      ],
      formula: 'Medida direta (cm) → arredondada a 400 / 420 / 440 mm',
      source: 'Antropometria padrão; a largura do guiador deve acompanhar a biacromial, não a moda.',
    },
    en: {
      title: 'Biacromial width (shoulders)',
      summary:
        'Distance between the two bony ends of the shoulders (acromions) — the reference for choosing handlebar width.',
      steps: [
        'Stand relaxed with arms along the body.',
        'Ask someone to locate the bony points on top of each shoulder and measure between them, from behind.',
        'Do not measure with clothing or with arms spread: the value must be bony.',
      ],
      formula: 'Direct measurement (cm) → rounded to 400 / 420 / 440 mm',
      source: 'Standard anthropometry; handlebar width should follow the biacromial width, not fashion.',
    },
  },

  currentSaddle: {
    diagram: 'lemond',
    pt: {
      title: 'Altura atual do selim — como se mede',
      summary:
        'Distância do centro do eixo pedaleiro até ao topo do selim, medida **ao longo do tubo do selim** (não na vertical até ao chão).',
      steps: [
        'Coloque a bicicleta na vertical, encostada a uma parede.',
        'Estique uma fita do centro do eixo pedaleiro (parafuso da pedaleira) até ao topo do selim, seguindo o tubo.',
        'Use um ponto de referência fixo no selim (ex.: o centro da parte de trás) e mantenha-o sempre o mesmo.',
        'A mesma medida com selins diferentes varia: comparar alturas só faz sentido com o mesmo selim.',
      ],
      formula: 'Medida direta (cm)',
      source: 'Convenção de fit (eixo pedaleiro → topo do selim). Difere da regra dos 109%, que parte do pedal.',
    },
    en: {
      title: 'Current saddle height — how to measure',
      summary:
        'Distance from the centre of the bottom bracket to the top of the saddle, measured **along the seat tube** (not vertically to the floor).',
      steps: [
        'Stand the bike upright against a wall.',
        'Run a tape from the centre of the bottom bracket (crank bolt) to the top of the saddle, following the tube.',
        'Use a fixed reference point on the saddle (e.g. the centre of its rear) and keep it constant.',
        'Different saddles change the number: comparing heights only makes sense with the same saddle.',
      ],
      formula: 'Direct measurement (cm)',
      source: 'Fit convention (bottom bracket → saddle top). The 109% rule uses the pedal instead.',
    },
  },

  lemond: {
    diagram: 'lemond',
    pt: {
      title: 'Altura do selim — método LeMond (cavalo × 0,883)',
      summary:
        'Estima a altura do selim a partir do cavalo. O valor corresponde à distância do **centro do eixo pedaleiro** ao **topo do selim**, medida ao longo do tubo do selim.',
      steps: [
        'Ponto de partida: cavalo em centímetros (esta página usa o valor que introduziu).',
        'Multiplicar por 0,883 para obter a altura teórica.',
        'Comparar com a altura atual: a diferença indica quanto e para que lado mexer o selim.',
        'Confirmar sempre em movimento: o alvo dinâmico do joelho no ponto morto inferior é 137–150° (vídeo) e 145–155° numa avaliação estática.',
      ],
      formula: 'cavalo (cm) × 0,883',
      source:
        'Método clássico de bike fit (Greg LeMond). É um ponto de partida de geometria — 0,883 assume proporções médias e não substitui a análise em movimento.',
    },
    en: {
      title: 'Saddle height — LeMond method (inseam × 0.883)',
      summary:
        'Estimates saddle height from the inseam. The value is the distance from the **centre of the bottom bracket** to the **top of the saddle**, measured along the seat tube.',
      steps: [
        'Starting point: inseam in centimetres (the value you entered on this page).',
        'Multiply by 0.883 to obtain the theoretical height.',
        'Compare with the current height: the difference tells how much and which way to move the saddle.',
        'Always confirm while pedalling: the dynamic knee target at bottom dead centre is 137–150° (video) and 145–155° in a static assessment.',
      ],
      formula: 'inseam (cm) × 0.883',
      source:
        'Classic bike-fit method (Greg LeMond). It is a geometry starting point — 0.883 assumes average proportions and does not replace in-motion analysis.',
    },
  },

  hamley109: {
    diagram: 'hamley109',
    pt: {
      title: 'Altura do selim — regra dos 109% (Hamley)',
      summary:
        'Mede a distância do **eixo do pedal quando a pedaleira está no ponto morto inferior** (por baixo, alinhada com o tubo do selim) até ao **topo do selim**. É uma referência diferente da LeMond.',
      steps: [
        'Rodar a pedaleira até o pedal estar o mais baixo possível (6h), alinhado com o tubo do selim.',
        'Medir do centro do eixo do pedal até ao topo do selim.',
        'Cavalo × 1,09 dá a distância teórica — por isso o número é maior do que a altura LeMond.',
        'Serve de segunda opinião: quando LeMond e 109% divergem muito, voltar a medir o cavalo antes de mexer na bicicleta.',
      ],
      formula: 'cavalo (cm) × 1,09 (do pedal no ponto morto inferior)',
      source:
        'Regra histórica de Hamley, muito usada em fit. Tende a dar selins mais altos que a LeMond; não é um valor universal — depende do comprimento do crenque e do sapato.',
    },
    en: {
      title: 'Saddle height — 109% rule (Hamley)',
      summary:
        'Measures the distance from the **pedal axle with the crank at bottom dead centre** (lowest point, aligned with the seat tube) to the **top of the saddle**. A different reference from LeMond.',
      steps: [
        'Turn the crank until the pedal is at its lowest point (6 o’clock), aligned with the seat tube.',
        'Measure from the centre of the pedal axle to the top of the saddle.',
        'Inseam × 1.09 gives the theoretical distance — hence the larger number than LeMond.',
        'Use it as a second opinion: when LeMond and 109% diverge a lot, re-measure the inseam before touching the bike.',
      ],
      formula: 'inseam (cm) × 1.09 (from the pedal at bottom dead centre)',
      source:
        'Historical Hamley rule, widely used in fit. It tends to give higher saddles than LeMond; it is not a universal value — it depends on crank length and shoes.',
    },
  },

  deltaSaddle: {
    diagram: 'saddleComparison',
    pt: {
      title: 'Diferença face à altura atual do selim',
      summary:
        'Compara o que está na bicicleta com a altura teórica. O sinal indica o lado: positivo = selim atual mais alto que o teórico; negativo = mais baixo.',
      steps: [
        'Diferenças até ±1,5 cm são frequentes e podem ser apenas a sua proporção individual.',
        'Acima disso, mexer em passos de 5 mm e reavaliar sempre em movimento.',
        'Cada 5 mm no selim altera o ângulo do joelho no ponto morto inferior em cerca de 1°.',
        'Depois de mexer o selim, o recuo (KOPS) e o alcance ao guiador mudam também — reavaliar tudo.',
      ],
      formula: 'altura atual − altura LeMond',
      source: 'Tolerância prática de fit (±1,5 cm) antes de assumir desvio relevante.',
    },
    en: {
      title: 'Difference from the current saddle height',
      summary:
        'Compares what is on the bike with the theoretical height. The sign shows the direction: positive = current saddle is higher than theoretical; negative = lower.',
      steps: [
        'Differences up to ±1.5 cm are common and may simply reflect your individual proportions.',
        'Above that, change in 5 mm steps and always re-assess while pedalling.',
        'Every 5 mm of saddle movement changes the knee angle at bottom dead centre by roughly 1°.',
        'After moving the saddle, the fore-aft (KOPS) and the reach to the bars change too — re-assess everything.',
      ],
      formula: 'current height − LeMond height',
      source: 'Practical fit tolerance (±1.5 cm) before assuming a relevant deviation.',
    },
  },

  frameSize: {
    diagram: 'frameSize',
    pt: {
      title: 'Tamanho do quadro = tubo do selim (cavalo × 0,665)',
      summary:
        'O número do quadro ("54", "56") é o **comprimento do tubo do selim**, medido do centro do eixo pedaleiro **até ao topo do tubo do selim** (C-T, centro-a-topo), ao longo do próprio tubo. Não é o tubo que vai do selim ao avanço: esse é o **tubo superior** (ver a ajuda do tubo superior / ETT).',
      steps: [
        'Do centro do eixo pedaleiro, seguir a linha do tubo do selim até à extremidade de cima (onde entra o espigão): esta é a convenção C-T, a que a regra do cavalo × 0,665 estima.',
        'A variante C-C (até ao centro do cruzamento com o tubo superior) dá cerca de 1–2 cm menos no mesmo quadro — dizer sempre qual das duas foi usada.',
        'Em quadros compactos (tubo superior inclinado) o número do tamanho engana: comparar quadros pelo tubo superior efetivo ou por reach + stack.',
        'MTB, TT e gravel usam tamanhos por letra e geometrias próprias — este valor não se aplica diretamente.',
      ],
      formula: 'cavalo (cm) × 0,665 (tubo do selim, centro-a-topo)',
      source:
        'Regra clássica de dimensionamento (tradicionalmente C-T; a C-C fica ~1–2 cm abaixo). Referência de partida: não existe norma universal entre marcas. Fontes: sheldonbrown.com/frame-sizing.html · wnb.org/bikefitandy.html',
    },
    en: {
      title: 'Frame size = seat tube (inseam × 0.665)',
      summary:
        'The number on the frame ("54", "56") is the **seat tube length**, measured from the centre of the bottom bracket **to the top of the seat tube** (C-T, centre-to-top), along the tube itself. It is not the tube that runs from the saddle to the stem: that one is the **top tube** (see the top tube / ETT help).',
      steps: [
        'From the bottom-bracket centre, follow the seat tube axis to its top end (where the seatpost enters): this is the C-T convention, the one the inseam × 0.665 rule estimates.',
        'The C-C variant (to the centre of the top-tube junction) gives about 1–2 cm less on the same frame — always state which one was used.',
        'On compact frames (sloping top tube) the size number misleads: compare frames by effective top tube or by reach + stack.',
        'MTB, TT and gravel use letter sizes and their own geometry — this value does not apply directly.',
      ],
      formula: 'inseam (cm) × 0.665 (seat tube, centre-to-top)',
      source:
        'Classic sizing rule (traditionally C-T; C-C lands ~1–2 cm lower). A starting reference: there is no universal cross-brand standard. Sources: sheldonbrown.com/frame-sizing.html · wnb.org/bikefitandy.html',
    },
  },

  topTube: {
    diagram: 'topTube',
    pt: {
      title: 'Tubo superior (Top Tube) e tubo superior efetivo (ETT)',
      summary:
        'O **tubo superior** é o tubo que liga o tubo do selim ao **tubo de direção** (a peça onde o avanço aperta) — não vai até ao avanço nem ao guiador. O **ETT** é esse comprimento medido na **horizontal**: em quadros de tubo superior inclinado, o tubo real é mais curto do que o ETT.',
      steps: [
        'Medir na horizontal entre o eixo do tubo do selim (à altura do topo do tubo superior) e o eixo do tubo de direção — é a distância virtual, independente da inclinação do tubo.',
        'Em estrada típica anda nos 520–580 mm (num 54 cm, tipicamente ~545 mm); em MTB 580–640 mm.',
        'Este é o comprimento do quadro que o atleta "sente" no cockpit: alcance total = ETT + avanço + reach do guiador.',
        'Não confundir com o tamanho do quadro (tubo do selim) nem com o reach do quadro (que parte do eixo pedaleiro) — ver as ajudas respetivas.',
      ],
      formula: 'Medida direta (mm) — horizontal, eixo do tubo do selim → eixo do tubo de direção',
      source:
        'Definições de geometria de quadro (tubo superior efetivo / horizontais). É descritivo nesta aplicação: entra no cálculo do alcance total do cockpit, não tem alvo universal. Fontes: geometrygeeks.bike/understanding-bike-geometry · bikeinsights.com/cyclopedia/top-tube-length',
    },
    en: {
      title: 'Top tube and effective top tube (ETT)',
      summary:
        'The **top tube** is the tube joining the seat tube to the **head tube** (the part the stem clamps) — it does not run to the stem or the bars. **ETT** is that length measured **horizontally**: on a sloping-top-tube frame the real tube is shorter than the ETT.',
      steps: [
        'Measure horizontally between the seat-tube axis (at top-tube height) and the head-tube axis — the virtual distance, independent of tube slope.',
        'Typical road values are 520–580 mm (a 54 cm frame is usually ~545 mm); MTB sits at 580–640 mm.',
        'This is the frame length the rider feels at the cockpit: total reach = ETT + stem + bar reach.',
        'Do not confuse it with frame size (seat tube) nor with frame reach (which starts at the bottom bracket) — see their own help entries.',
      ],
      formula: 'Direct measurement (mm) — horizontal, seat-tube axis → head-tube axis',
      source:
        'Frame geometry definitions (effective / horizontal top tube). Descriptive in this app: it feeds the total cockpit reach, it has no universal target. Sources: geometrygeeks.bike/understanding-bike-geometry · bikeinsights.com/cyclopedia/top-tube-length',
    },
  },

  handlebarWidth: {
    diagram: 'handlebarWidth',
    pt: {
      title: 'Largura de guiador recomendada',
      summary:
        'Largura do guiador medida **fora a fora**, à altura das pontas/curvas, que deve acompanhar a largura biacromial dos ombros.',
      steps: [
        'Medir o guiador de extremidade a extremidade (fora a fora), no mesmo ponto dos dois lados.',
        'Guiador demasiado largo abre o peito e expõe mais o tronco ao vento; demasiado estreito restringe a respiração e fecha os ombros.',
        'Aqui arredonda-se ao valor comercial mais próximo: até 41 cm → 400 mm, 41–43 cm → 420 mm, acima de 43 cm → 440 mm.',
        'Em MTB a referência é outra (guiadores largos, tipicamente 720–780 mm) — este valor é para estrada.',
      ],
      formula: 'largura biacromial (cm) → 400 / 420 / 440 mm',
      source: 'Orientação prática de fit apoiada em antropometria. É uma aproximação; a largura final testa-se com o atleta a pedalar.',
    },
    en: {
      title: 'Recommended handlebar width',
      summary:
        'Handlebar width measured **outside to outside** at the hoods/drops, which should follow the biacromial shoulder width.',
      steps: [
        'Measure the handlebar end to end (outside to outside) at the same point on both sides.',
        'Too wide opens the chest and exposes the torso to the wind; too narrow restricts breathing and closes the shoulders.',
        'This page rounds to the nearest commercial value: up to 41 cm → 400 mm, 41–43 cm → 420 mm, above 43 cm → 440 mm.',
        'For MTB the reference is different (wide bars, typically 720–780 mm) — this value is for road.',
      ],
      formula: 'biacromial width (cm) → 400 / 420 / 440 mm',
      source: 'Practical fit guidance based on anthropometry. It is an approximation; the final width is tested while pedalling.',
    },
  },

  handlebarReach: {
    diagram: 'handlebarReachDrop',
    pt: {
      title: 'Reach do guiador — profundidade da curva',
      summary:
        'Distância **horizontal** do centro do tubo do guiador ao ponto mais avançado da curva (drops). É o quanto o tronco ganha em alcance quando a mão desce da parte de cima para os drops.',
      steps: [
        'Com o guiador nivelado, esticar a fita na horizontal do centro do tubo (onde aperta o avanço) até ao centro da parte mais avançada da curva.',
        'Valores típicos: 70–90 mm; guiadores compactos ficam pelos 65–80 mm. Nesta aplicação o campo aceita 70–100 mm.',
        'Não confundir com o reach do QUADRO: o alcance total é quadro + avanço + reach do guiador — mexer num muda a leitura dos outros.',
        'Serve de contexto para interpretar o ângulo do cotovelo: com tronco acima do alvo e uma curva funda, o ajuste natural é um guiador mais compacto, não um avanço mais curto.',
      ],
      formula: 'Medida direta (mm) — tipicamente 70–90 mm',
      source:
        'Especificação do fabricante do guiador (convenção centro a centro). Nesta aplicação é descritivo: alimenta a leitura do cockpit, não prescreve um valor.',
    },
    en: {
      title: 'Handlebar reach — depth of the curve',
      summary:
        '**Horizontal** distance from the centre of the handlebar clamp to the forward-most point of the drops. It is how much reach the torso gains when the hand moves from the tops to the drops.',
      steps: [
        'With the bar level, run the tape horizontally from the clamp centre (where the stem bolts) to the centre of the most forward point of the drops.',
        'Typical values: 70–90 mm; compact bars sit around 65–80 mm. In this app the field accepts 70–100 mm.',
        'Do not confuse it with FRAME reach: total reach is frame + stem + bar reach — changing one changes how the others read.',
        'It gives context to the measured elbow angle: with the trunk above target and a deep curve, the natural fix is a more compact bar, not a shorter stem.',
      ],
      formula: 'Direct measurement (mm) — typically 70–90 mm',
      source:
        'Handlebar manufacturer specification (centre-to-centre convention). In this app it is descriptive: it feeds the cockpit reading, it does not prescribe a value.',
    },
  },

  handlebarDrop: {
    diagram: 'handlebarReachDrop',
    pt: {
      title: 'Drop do guiador — descida da curva',
      summary:
        'Distância **vertical** do centro do tubo do guiador ao centro da parte inferior da curva: é o quanto o tronco desce quando a mão passa para os drops.',
      steps: [
        'Com o guiador nivelado, medir na vertical do centro do tubo até ao centro do fundo da curva.',
        'Referências práticas: compacto 115–130 mm, tradicional 130–145 mm, profundo acima de 145 mm. Nesta aplicação o campo aceita 100–130 mm — acima disso o guiador fica fora do âmbito da análise.',
        'Um drop profundo que o atleta nunca usa (mão sempre em cima) indica forma de guiador ou altura do cockpit erradas — não um braço curto.',
        'Trocar de guiador também altera a altura das mãos na parte de cima: reavaliar os espaçadores depois da troca.',
      ],
      formula: 'Medida direta (mm) — compacto 115–130 / tradicional 130–145 / profundo > 145',
      source:
        'Especificação do fabricante do guiador. Nesta aplicação serve para interpretar o ângulo do tronco medido nas fotos/vídeo.',
    },
    en: {
      title: 'Handlebar drop — depth of the curvature',
      summary:
        '**Vertical** distance from the centre of the handlebar clamp to the centre of the bottom of the drops: how far the torso drops when the hand moves onto the drops.',
      steps: [
        'With the bar level, measure vertically from the clamp centre to the centre of the bottom of the curve.',
        'Practical references: compact 115–130 mm, traditional 130–145 mm, deep above 145 mm. In this app the field accepts 100–130 mm — above that the bar is outside the analysis scope.',
        'A deep drop the rider never uses (hands always on the tops) points to the wrong bar shape or cockpit height — not short arms.',
        'Changing the bar also changes hand height on the tops: re-assess the spacers after the swap.',
      ],
      formula: 'Direct measurement (mm) — compact 115–130 / traditional 130–145 / deep > 145',
      source:
        'Handlebar manufacturer specification. In this app it helps interpret the trunk angle measured in the photos/video.',
    },
  },

  stemLength: {
    diagram: 'stemLength',
    pt: {
      title: 'Comprimento do avanço (mesa)',
      summary:
        'Distância entre o **centro do tubo de direção** e o **centro do tubo do guiador**, medida ao longo do corpo do avanço. É a peça que muda mais depressa o alcance do cockpit.',
      steps: [
        'Ler o valor gravado no próprio avanço (ex.: 90, 100, 110 mm) ou medir centro a centro com o avanço montado.',
        'Cada 10 mm mexem de forma percetível no ângulo do cotovelo e na distribuição de peso entre mãos e selim.',
        'A inclinação do avanço (rise) também muda a altura: um avanço invertido baixa o guiador sem trocar de espaçadores.',
        'Com este valor escrito, a aplicação dá o alvo em número absoluto (ex.: "avanço atual 100 mm → 90 mm") em vez de só "encurtar 15 mm".',
      ],
      formula: 'Medida direta (mm), centro a centro',
      source: 'Convenção de fit: comprimento nominal do avanço, centro a centro.',
    },
    en: {
      title: 'Stem length',
      summary:
        'Distance between the **centre of the steerer tube** and the **centre of the handlebar clamp**, measured along the stem body. It is the part that changes cockpit reach fastest.',
      steps: [
        'Read the value stamped on the stem itself (e.g. 90, 100, 110 mm) or measure centre to centre with the stem fitted.',
        'Every 10 mm visibly changes the elbow angle and how the weight is shared between hands and saddle.',
        'Stem rise (angle) also changes height: a flipped stem lowers the bar without touching spacers.',
        'With this value entered, the app gives the target as an absolute number (e.g. "stem now 100 mm → 90 mm") instead of only "shorten 15 mm".',
      ],
      formula: 'Direct measurement (mm), centre to centre',
      source: 'Fit convention: nominal stem length, centre to centre.',
    },
  },

  crankLength: {
    diagram: 'crankLength',
    pt: {
      title: 'Comprimento de crenque recomendado',
      summary:
        'Comprimento da biela, medido **do centro do eixo pedaleiro ao centro do eixo do pedal**. Muda o fecho do joelho no ponto morto superior e o fecho da anca.',
      steps: [
        'Ler o valor gravado na própria biela (ex.: 170, 172,5). Comprimentos diferentes no mesmo cranque são erro de montagem.',
        'Faixas usadas aqui: cavalo < 74 cm → 165 mm; 74–81 cm → 170 mm; 81–86 cm → 172,5 mm; > 86 cm → 175 mm.',
        'Crenques mais curtos abrem o ângulo da anca e do joelho (útil em quadros agressivos); mais longos dão mais alavanca.',
        'Depois de mudar o crenque, a altura do selim efetiva muda: a regra dos 109% parte do pedal, a LeMond do eixo pedaleiro.',
      ],
      formula: 'faixas por cavalo (165 / 170 / 172,5 / 175 mm)',
      source:
        'Regra prática por cavalo, usada como ponto de partida. Não existe norma universal: a escolha depende de altura, modalidade e preferência.',
    },
    en: {
      title: 'Recommended crank length',
      summary:
        'Crank arm length, measured **from the centre of the bottom bracket to the centre of the pedal axle**. It changes knee closure at top dead centre and hip closure.',
      steps: [
        'Read the value stamped on the crank itself (e.g. 170, 172.5). Different lengths on the same crankset mean a build error.',
        'Bands used here: inseam < 74 cm → 165 mm; 74–81 cm → 170 mm; 81–86 cm → 172.5 mm; > 86 cm → 175 mm.',
        'Shorter cranks open hip and knee angles (useful on aggressive frames); longer ones give more leverage.',
        'After changing cranks the effective saddle height changes: the 109% rule starts at the pedal, LeMond at the bottom bracket.',
      ],
      formula: 'inseam bands (165 / 170 / 172.5 / 175 mm)',
      source:
        'Practical inseam-based rule used as a starting point. There is no universal standard: the choice depends on height, discipline and preference.',
    },
  },

  cleatPosition: {
    diagram: 'crankLength',
    pt: {
      title: 'Posição dos travessões / cleats na sapatilha (opcional)',
      summary:
        'Indica onde os travessões estão instalados nos rasgos da sola: **recuado (traseiro)**, **neutro (centro)** ou **avançado (dianteiro)**.',
      steps: [
        'Olhe para a sola da sapatilha e verifique a posição dos parafusos em relação aos rasgos de afinação.',
        'Se estiverem nos rasgos mais perto do calcanhar: selecione "Recuado (traseiro)".',
        'Se estiverem a meio do curso: selecione "Neutro (centro)".',
        'Se estiverem puxados para a ponta dos dedos: selecione "Avançado (dianteiro)".',
        'Se não souber, deixe em branco: o sistema estima o recuo de partida a partir do número de sapato.',
      ],
      formula: 'Posição no rasgo da sola da sapatilha',
      source: 'Steve Hogg / MyVeloFit (orientação prática de travessões)',
    },
    en: {
      title: 'Cleat position on cycling shoe (optional)',
      summary:
        'Indicates where cleats are currently mounted in the sole slots: **rearward (back)**, **neutral (center)**, or **forward (front)**.',
      steps: [
        'Inspect the shoe sole and note where the cleat bolts sit within the adjustment slots.',
        'If pushed all the way toward the heel: select "Rearward (back)".',
        'If centered in the slots: select "Neutral (center)".',
        'If pushed toward the toes: select "Forward (front)".',
        'If unsure, leave blank: the engine will estimate baseline setback from shoe size.',
      ],
      formula: 'Slot position on shoe sole',
      source: 'Steve Hogg / MyVeloFit (cleat positioning practice)',
    },
  },
};

/** Chaves disponíveis (útil para a verificação automática). */
export const HELP_KEYS = Object.keys(HELP_ENTRIES);

/**
 * Devolve o conteúdo de ajuda no idioma pedido, já com o desenho resolvido
 * para o formato esperado pelo componente `HelpTip`.
 */
export function getTheoreticalHelp(locale = 'pt') {
  const lang = locale === 'en' ? 'en' : 'pt';
  return Object.fromEntries(
    Object.entries(HELP_ENTRIES).map(([key, entry]) => [
      key,
      {
        title: entry[lang].title,
        summary: entry[lang].summary,
        steps: entry[lang].steps,
        formula: entry[lang].formula,
        source: entry[lang].source,
        diagram: entry.diagram,
      },
    ]),
  );
}
