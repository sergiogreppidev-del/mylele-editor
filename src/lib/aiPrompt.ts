/* Arma el pedido para una IA.

   Ojo con el reparto de quién sabe qué: el autor sabe qué canción quiere, pero
   NO sabe en qué compás está ni cuántos compases dura. La IA sí. Por eso, por
   defecto, el pedido le pide que ELLA declare el compás y el tempo, y el editor
   después los aplica al nivel. Solo cuando el autor está armando un ejercicio
   propio tiene sentido imponerle la medida. */

import type { NotationTarget } from './notation';
import type { ChartMode, Difficulty } from './chartFormat';

/** 'nivel' genera las tres capas de una sola vez. */
export type ImportTarget = NotationTarget | 'nivel';

interface PromptOptions {
  target: ImportTarget;
  title: string;
  bpm: number;
  timeSig: string;
  beatsPerBar: number;
  bars: number;
  knownChords: string[];
  /**
   * Los acordes que este sub-nivel permite: los N que menos dedos piden, calculados
   * de las digitaciones reales. Es distinto de `knownChords`, que sigue siendo TODO
   * el catálogo — si la IA se sale de la lista igual hay que poder leer la respuesta
   * y avisar, en vez de rechazarla como si el acorde no existiera.
   */
  acordesPermitidos?: string[];
  /**
   * Sub-nivel que se está creando. Cambia lo que se le pide a la MANO IZQUIERDA:
   * cuántas formas distintas, cuáles, y cada cuánto pueden cambiar. La música de
   * fondo no se toca — es la misma canción en los dos, y simplificarla "para que
   * combine" es justamente el error.
   */
  dificultad?: Difficulty;
  /**
   * Qué toca el alumno en este nivel: acordes o notas sueltas. Solo aplica al
   * pedido de nivel completo, y es dato obligatorio para la IA: sin esto no sabe
   * cuál de las capas es el juego y cuál es la música, y devolvía siempre las dos.
   */
  modo?: ChartMode;
  /** Qué canción o idea quiere el autor. Puede ir vacío. */
  pedido?: string;
  /**
   * La melodía que ya tiene el nivel, en notación. Cuando existe se la mandamos
   * para que arme los acordes SOBRE ESA melodía en vez de sobre la que recuerde.
   */
  melodiaDelNivel?: string;
  /**
   * true  = el autor impone compás, tempo y extensión (ejercicio a medida).
   * false = los decide la IA según la canción (lo normal).
   */
  imponerMedida: boolean;
}

const FORMATO = `FORMATO DE SALIDA (obligatorio)
Una sola línea con elementos separados por espacios.
- Cada elemento es NOMBRE/DURACION. La duración se mide en TIEMPOS (beats), no en segundos.
- Podés usar decimales: 1 = negra, .5 = corchea, 2 = blanca, 1.5 = negra con puntillo.
- "r/1" es un silencio de un tiempo.
- "~/1" es una LIGADURA: alarga lo anterior en vez de volver a tocarlo. Sirve cuando algo
  dura más de lo que queda del compás: "F/3 | ~/3" es UN solo golpe de seis tiempos.
- "|" separa compases. Poné una barra al final de cada compás.
- NO escribas tiempos de inicio ni números de compás: se calculan solos sumando las duraciones.`;

/**
 * EL RASGUEO SIGUE EL RITMO DE LA MELODÍA.
 *
 * Esto es lo último que se aprendió, y se aprendió jugando. Antes el pedido decía que
 * en Fácil cada compás llevaba un acorde de compás entero ("todos X/4"), y eso mezclaba
 * dos cosas distintas: cada cuánto CAMBIA la armonía (que sí es lo que hace difícil un
 * nivel) y cuántas veces se RASGUEA (que no le agrega ningún trabajo a la mano que forma
 * el acorde).
 *
 * El resultado se escuchaba: el final de Estrellita pide un Do sostenido y el juego
 * mostraba dos Do seguidos, así que había que cortar el acorde para volver a golpear
 * justo donde la canción respira. La corrección no es "más golpes" ni "menos golpes":
 * es que los golpes caigan donde la canción se mueve.
 */
const RASGUEO = [
  'EL RITMO DEL RASGUEO — sigue a la melodía, no al metrónomo',
  '- Un elemento de esta línea es UN rasgueo, y su duración es cuánto lo dejás sonar.',
  '  "C/2" es UN rasgueo que suena dos tiempos. NO son dos rasgueos de un tiempo.',
  '- Mirá la melodía compás por compás: donde la melodía se MUEVE, se rasguea; donde la',
  '  melodía SOSTIENE una nota larga, el acorde se sostiene con ella en un solo golpe.',
  '  Si la melodía hace cuatro negras, van cuatro rasgueos; si termina la frase con una',
  '  blanca, va UN rasgueo de dos tiempos, no dos de uno.',
  '- Si el acorde tiene que sonar más de lo que queda del compás, usá la ligadura:',
  '  "F/3 | ~/3" es un solo rasgueo de seis tiempos que cruza la barra.',
  '- Los SILENCIOS valen. Si la canción respira, poné "r/2" y que no se rasguee ahí.',
  '- Todos los rasgueos con la misma duración de punta a punta es el error a evitar:',
  '  eso es un metrónomo, y se nota apenas se juega.',
];

const SOLO_LA_LINEA = `Respondé ÚNICAMENTE con eso, sin explicaciones, sin comillas y sin bloque de código.`;

/* Estas tres cosas se escribieron para el pedido del nivel entero y solo vivían ahí.
   Pero un pedido de una sola capa las necesita igual: sin la anacrusa, "Feliz
   cumpleaños" arranca en el tiempo fuerte, el acento cae en la sílaba equivocada y
   la canción no se reconoce aunque las notas sean las correctas. */
const RITMO_TITULO = 'RITMO — esto es lo que más se equivoca, leelo con atención';
const RITMO_REAL = [
  '- Escribí el ritmo REAL de la canción, no todas las notas iguales. Si dos sílabas son',
  '  corcheas, van /.5 cada una; si una nota se sostiene tres tiempos, va /3.',
];
const RITMO_COMPASES = [
  '- ANACRUSA: muchas canciones no empiezan en el tiempo fuerte. Si la tuya arranca antes,',
  '  escribí ese arranque como un PRIMER COMPÁS CORTO. El caso típico es "Feliz cumpleaños":',
  '  el "Fe-liz" son dos corcheas que caen ANTES del primer compás, y el tiempo fuerte cae',
  '  recién en "cum". Si lo escribís empezando en el tiempo 1, el acento queda en la sílaba',
  '  equivocada y la canción no se reconoce aunque las notas sean las correctas.',
  '- Cada compás tiene que sumar EXACTAMENTE los tiempos del compás. Las únicas excepciones',
  '  son el primero (si hay anacrusa) y el último (si la canción termina antes de completarlo).',
  '  Un compás de más o de menos corre todo lo que viene después y arruina la canción entera.',
];

/**
 * Qué le pide cada sub-nivel a la mano izquierda.
 *
 * La regla anterior era "cuántos acordes por compás", y no separaba nada: se
 * midieron los tres niveles publicados y los tres daban ~18 cambios por minuto
 * con los mismos 4 acordes. En canciones de principiante la armonía cambia una
 * vez por compás sola, así que el límite nunca apretaba.
 *
 * Lo que sí distingue es CUÁNTAS formas hay que saber, CUÁLES, y CADA CUÁNTO
 * hay que cambiarlas. `permitidos` viene calculado de las digitaciones reales —
 * los N acordes que menos dedos piden— y no de una lista escrita a mano, así que
 * sigue teniendo sentido el día que se carguen acordes nuevos.
 */
function reglasSubNivel(dificultad: Difficulty, permitidos: string[]): string[] {
  const lista = permitidos.join(', ') || '(no hay acordes cargados)';
  const comun = [
    'CUÁNTAS VECES PUEDE CAMBIAR EL ACORDE — regla dura, no la negocies',
    'Ojo: esto limita cada cuánto CAMBIA la armonía. NO limita cuántas veces se rasguea:',
    'eso lo decide la melodía, y está explicado en su propia sección.',
  ];
  if (dificultad === 'facil') {
    return [
      ...comun,
      `- Usá SOLO estos acordes: ${lista}. Son los que menos dedos piden. Ninguno más,`,
      '  aunque la canción original los tenga: reemplazalos por el más parecido de esa lista.',
      '- UN SOLO acorde por compás. El compás entero se toca con el mismo acorde, aunque',
      '  lo rasguees varias veces: "C/1 C/1 C/2" es un compás de Do, y está perfecto.',
      '- Está prohibido que en un mismo compás haya DOS acordes distintos.',
      '- Si la armonía real cambia en la mitad del compás, quedate con el del tiempo fuerte.',
      '  Se pierde un matiz y está bien: el alumno recién aprende a cambiar de posición.',
      '- Apuntá a que un mismo acorde aguante DOS COMPASES O MÁS antes de cambiar. Que se',
      '  repita varios compases seguidos NO es un problema: es el objetivo.',
      '- Todos los rasgueos hacia abajo. No uses ":u" en esta etapa.',
      '- Si la canción que te pidieron necesita sí o sí más acordes o cambios más rápidos,',
      '  DECILO en un renglón que empiece con "NOTA:" antes del BPM, y entregá igual la versión',
      '  simplificada. No te salgas de la regla por tu cuenta.',
      '',
    ];
  }
  return [
    ...comun,
    `- Usá únicamente estos acordes: ${lista}. Si la canción pide otro, poné el más parecido.`,
    '- Un acorde por compás es lo normal. Podés cambiar de acorde en la mitad del compás,',
    '  una sola vez, y solo donde la armonía realmente cambia ahí.',
    '- Nunca tres o más acordes DISTINTOS en un mismo compás.',
    '- No metas un cambio de más solo para que sea difícil: si el compás tiene un solo acorde,',
    '  va uno solo. Un acorde que dura varios compases seguidos sigue estando bien.',
    '',
  ];
}

export function buildAiPrompt(o: PromptOptions): string {
  if (o.target === 'nivel') return promptNivelCompleto(o);

  const pedido = o.pedido?.trim();
  const dif: Difficulty = o.dificultad ?? 'facil';
  const permitidos = o.acordesPermitidos?.length ? o.acordesPermitidos : o.knownChords;
  const partes: string[] = [
    'Sos un asistente que escribe partituras para MyLele, una app para aprender ukelele.',
    '',
  ];

  /* ---- Qué se pide ---- */
  if (o.target === 'chords') {
    partes.push(
      pedido
        ? `TAREA\nEscribí la progresión de acordes de: ${pedido}`
        : 'TAREA\nEscribí una progresión de acordes que suene bien y sea fácil para alguien que arranca.',
    );
  } else if (o.target === 'melody') {
    partes.push(
      pedido
        ? `TAREA\nEscribí la melodía de: ${pedido}`
        : 'TAREA\nEscribí una melodía simple y reconocible para practicar notas sueltas.',
    );
  } else {
    partes.push(
      pedido
        ? `TAREA\nEscribí la melodía de acompañamiento de: ${pedido}`
        : 'TAREA\nEscribí una melodía de acompañamiento que suene de fondo mientras el alumno toca.',
    );
  }
  partes.push('');

  /* ---- La medida: la pone la IA o la impone el autor ---- */
  if (o.imponerMedida) {
    partes.push(
      'MEDIDA (fija, respetala)',
      `Compás: ${o.timeSig} (${o.beatsPerBar} tiempos por compás) · Tempo: ${o.bpm} BPM`,
      `Extensión: ${o.bars} compases (${o.bars * o.beatsPerBar} tiempos). Llenalos todos.`,
      '',
    );
  } else {
    partes.push(
      'MEDIDA (la decidís vos)',
      'No fuerces la canción a un compás ni a un tempo que no le corresponden, y no la cortes',
      'para que entre en una cantidad de compases: escribila como es, completa.',
      'Antes de la línea de música, declará en dos renglones qué le corresponde:',
      '',
      'BPM: <número entre 40 y 200>',
      'COMPAS: <por ejemplo 4/4, 3/4 o 6/8>',
      '',
    );
  }

  /* ---- Reglas propias de cada capa ---- */
  if (o.target === 'chords') {
    partes.push(
      'REGLAS',
      '- Qué acordes podés usar y cada cuánto pueden cambiar está más abajo, en su propia sección.',
      '- Si la canción necesita un acorde que no está permitido, reemplazalo por el más parecido',
      '  de los que sí (por ejemplo G7 -> G, Dm -> Am) y seguí adelante.',
      '- Antes de escribir, pensá la melodía y fijate qué notas caen en cada compás: el acorde',
      '  sale de ahí, no de la memoria.',
      '- No estires ni repitas nada para llegar a una cantidad redonda de compases: la canción dura',
      '  lo que dura. Twinkle Twinkle, por ejemplo, son 12 compases de 4/4, no 16.',
      '- Podés agregar :d (rasgueo hacia abajo) o :u (hacia arriba) después de la duración.',
      '  Si no ponés nada, es hacia abajo.',
      '',
      ...RASGUEO,
      '',
      ...reglasSubNivel(dif, permitidos),
    );

    // Si el nivel ya tiene la melodía cargada, se la damos: armonizar ESTA melodía
    // es mucho más confiable que confiar en cómo se acuerde la canción.
    if (o.melodiaDelNivel) {
      partes.push(
        'LA MELODÍA DE ESTE NIVEL (armonizá exactamente esta, no otra versión)',
        'Está en la misma notación: nota+octava/duración, y "|" separa compases.',
        '',
        o.melodiaDelNivel,
        '',
        '- Los acordes tienen que sumar la MISMA cantidad de tiempos que esta melodía.',
        '- Cada acorde tiene que contener las notas que suenan mientras dura.',
        '',
      );
    }
  } else if (o.target === 'melody') {
    partes.push(
      'REGLAS',
      '- Cada nota se escribe con su nombre y su octava: C4, G4, A#3, Bb5.',
      '- IMPORTANTE: esta melodía la toca el alumno en un ukelele, así que TODAS las notas',
      '  tienen que estar entre C4 y A5. Si la melodía original es más grave, subila de octava.',
      '- Una sola voz: nada de dos notas sonando a la vez.',
      '',
    );
  } else {
    partes.push(
      'REGLAS',
      '- Cada nota se escribe con su nombre y su octava: C4, G4, A#3, Bb5.',
      '- Esto NO lo toca el alumno: lo reproduce la app, así que podés usar cualquier octava (C2 a C7).',
      '- Una sola voz: nada de dos notas sonando a la vez.',
      '',
    );
  }

  // La anacrusa y la suma de compases valen para cualquier capa. El "ritmo real"
  // habla de sílabas y notas, así que en acordes no viene al caso.
  partes.push(
    RITMO_TITULO,
    ...(o.target === 'chords' ? [] : RITMO_REAL),
    ...RITMO_COMPASES,
    '',
  );

  partes.push(FORMATO, '');
  partes.push(o.imponerMedida ? SOLO_LA_LINEA : 'Respondé con los dos renglones de medida y después la línea de música, nada más.', '');

  /* ---- Ejemplo ---- */
  const bpb = o.imponerMedida ? o.beatsPerBar : 4;
  // El ejemplo tiene que sumar el compás que se está pidiendo. Escrito con duraciones
  // fijas ("C/1 C/1 C/2") le enseñaba a la IA un compás de 4 tiempos aunque el nivel
  // fuera de 3, que es exactamente el error que el resto del pedido le prohíbe.
  const cierre = bpb >= 4 ? `C/1 C/1 C/${bpb - 2}` : `C/1 C/${bpb - 1}`;
  if (o.target === 'chords') {
    // El ejemplo tiene que mostrar la densidad que se está pidiendo: si muestra un
    // compás partido cuando se pidió uno por compás, la IA copia el ejemplo.
    partes.push(
      'MINIEJEMPLO DE LA FORMA — 4 compases inventados, NO es tu respuesta.',
      ...(dif === 'facil'
        ? [
            'Fijate en tres cosas: cada compás tiene UN SOLO acorde; los golpes NO duran todos',
            'lo mismo (siguen a la melodía); y el último se sostiene en vez de repetirse.',
            ...(o.imponerMedida ? [] : ['BPM: 92', 'COMPAS: 4/4']),
            `| ${cierre} | ${Array(bpb).fill('C/1').join(' ')} | F/${bpb / 2} F/${bpb / 2} | G/${bpb} |`,
          ]
        : [
            'Fijate que el tercero cambia de acorde en la mitad, los otros no, y que las',
            'duraciones de los golpes son distintas entre sí porque siguen a la melodía.',
            ...(o.imponerMedida ? [] : ['BPM: 92', 'COMPAS: 4/4']),
            `| ${cierre} | Am/${bpb} | F/${bpb / 2} C/${bpb / 2} | G/${bpb} |`,
          ]),
    );
  } else {
    // El ejemplo anterior era, literalmente, el arranque de "Feliz cumpleaños". Cuando
    // justo se pedía esa canción, el modelo copiaba el ejemplo y se daba por terminado:
    // el mismo anclaje que ya había roto el pedido del nivel entero. Ahora es una
    // melodía inventada, y de paso muestra anacrusa y duraciones variadas.
    partes.push(
      'MINIEJEMPLO DE LA FORMA — 3 compases inventados, NO es tu respuesta ni es una canción.',
      'Fijate en dos cosas: el primer compás es corto (anacrusa de un tiempo) y las',
      'duraciones son distintas entre sí, no todas iguales.',
      ...(o.imponerMedida
        ? ['(el ejemplo va en 3/4 solo para mostrar la forma; vos usá el compás pedido)']
        : ['BPM: 120', 'COMPAS: 3/4']),
      '| D4/1 | F4/1 A4/1.5 G4/.5 | E4/2 r/1 |',
    );
  }

  partes.push(
    '',
    'ESCRIBILO COMPLETO',
    'El miniejemplo es corto porque muestra la forma, no porque las canciones duren eso.',
    'Escribí de principio a fin, sin abreviar: nada de "...", "etc." ni "(se repite)". Si una',
    'parte se repite, escribila de nuevo entera. Si te queda largo, podés usar varios renglones.',
    'No pidas confirmación ni ofrezcas continuar: entregá el resultado terminado.',
  );

  // La verificación final va última a propósito: es lo último que lee el modelo
  // antes de responder, y es lo que lo hace releer en vez de entregar de una.
  partes.push(
    '',
    'ANTES DE RESPONDER, VERIFICÁ (y corregí si hace falta)',
    ...(o.imponerMedida ? [] : ['1. ¿Están los renglones BPM y COMPAS antes de la música?']),
    '2. ¿Cada compás suma exactamente los tiempos del compás, salvo el primero y el último?',
    '3. Si la canción tiene anacrusa, ¿el primer compás quedó corto?',
    '4. ¿Está completa, sin abreviar ninguna repetición?',
    ...(o.target === 'melody'
      ? ['5. ¿Todas las notas están entre C4 y A5, que es lo que se puede tocar en el ukelele?']
      : o.target === 'chords'
        ? [
            dif === 'facil'
              ? '5. ¿Hay UN SOLO acorde por compás (aunque se rasguee varias veces)?'
              : '5. ¿Ningún compás tiene más de DOS acordes distintos?',
            '6. ¿Los rasgueos siguen el ritmo de la melodía, o te quedaron todos de la misma',
            '   duración? Si son todos iguales, es un metrónomo: volvé a mirar dónde sostiene',
            '   la melodía y juntá esos golpes en uno solo más largo.',
          ]
        : []),
  );

  return partes.join('\n');
}

export const TARGET_LABEL: Record<ImportTarget, string> = {
  nivel: 'un nivel completo',
  chords: 'acordes (lo que toca el alumno)',
  melody: 'notas sueltas (lo que toca el alumno)',
  backing: 'melodía de fondo (la toca la app)',
};

/**
 * Pedido de un NIVEL ENTERO: la IA escribe la música y la capa jugable en una
 * sola pasada. La ventaja no es solo ahorrar pasos: al armar los acordes tiene
 * la melodía que acaba de escribir delante, que es exactamente lo que le faltaba
 * cuando los acordes salían despegados de la canción.
 *
 * OJO con `modo`. Antes este pedido siempre incluía el renglón de acordes, y el
 * editor deducía el tipo de nivel de si habían llegado acordes o no — o sea que
 * SIEMPRE deducía "acordes" y no había forma de crear un nivel de notas. Ahora
 * el tipo lo elige el autor antes de pedir nada, y acá se le dice a la IA cuál
 * de las capas es el juego. En un nivel de notas ni siquiera se piden acordes:
 * la armonía ya está en el acompañamiento y pedirla de más solo gasta espacio.
 */
function promptNivelCompleto(o: PromptOptions): string {
  const pedido = o.pedido?.trim();
  const permitidos = o.acordesPermitidos?.length ? o.acordesPermitidos : o.knownChords;
  const dif: Difficulty = o.dificultad ?? 'facil';
  const tocaAcordes = (o.modo ?? 'chords') === 'chords';

  return [
    'Sos un asistente que escribe niveles para MyLele, una app para aprender ukelele.',
    '',
    'TAREA',
    pedido
      ? `Escribí el nivel completo de: ${pedido}`
      : 'Escribí un nivel completo con una canción sencilla y reconocible.',
    tocaAcordes
      ? 'Son cuatro capas de la misma canción, alineadas entre sí:'
      : 'Son tres capas de la misma canción, alineadas entre sí:',
    '  MELODIA — la melodía de la canción. Una nota por vez.',
    '  BAJO    — la línea de bajo.',
    '  ACOMP   — el relleno armónico: arpegios, contracantos, acordes.',
    ...(tocaAcordes ? ['  ACORDES — los acordes que rasguea el alumno.'] : []),
    '',
    'SEPARÁ DOS COSAS QUE NO SON LO MISMO',
    ...(tocaAcordes
      ? [
          'MELODIA + BAJO + ACOMP son LA MÚSICA, la que reproduce la app. Tiene que sonar a un arreglo',
          'de verdad: rica, con movimiento y entretenida. NO tiene ninguna limitación de dificultad.',
          'ACORDES es EL JUEGO, lo único que toca el alumno. Eso sí tiene que ser simple.',
          'No simplifiques la música para que combine con el juego: son cosas distintas.',
          'Más abajo hay un límite de cuántos acordes por compás. Ese límite es SOLO para la capa',
          'ACORDES. MELODIA, BAJO y ACOMP no se tocan: la canción es la misma y suena igual de rica.',
        ]
      : [
          'ESTE ES UN NIVEL DE NOTAS SUELTAS: el alumno toca LA MELODIA, nota por nota, en el mástil.',
          'BAJO + ACOMP son LA MÚSICA que reproduce la app por debajo. Tienen que sonar a un arreglo',
          'de verdad: ricos, con movimiento. NO tienen ninguna limitación de dificultad.',
          'MELODIA es EL JUEGO. No la simplifiques por eso —la melodía ES la canción y recortarla la',
          'vuelve irreconocible—, pero sí tiene que entrar entera en el ukelele.',
          'NO escribas un renglón ACORDES: en este nivel no se usa. La armonía va en ACOMP.',
        ]),
    '',
    'CÓMO QUE SEA UN ARREGLO Y NO UN METRÓNOMO CON ALTURAS',
    '- El error típico es poner el bajo en el tiempo 1 y el mismo bloque de acordes en los demás,',
    '  igual en todos los compases. Eso suena a metrónomo, no a música. Evitalo.',
    '- BAJO: que se mueva. Fundamental, quinta, notas de paso que conecten un acorde con el',
    '  siguiente. No la misma nota tres veces por compás.',
    '- ACOMP: arpegios en vez de bloques, contratiempos, alguna contramelodía. Que la textura',
    '  CAMBIE entre secciones: más suave al principio, más lleno en la parte final.',
    '- Podés usar silencios para dar aire. Un arreglo que no respira cansa.',
    '- Si la canción tiene un final, cerralo: un acorde largo, un arpegio que baje, algo.',
    '',
    'MEDIDA (la decidís vos)',
    'No fuerces la canción a un compás ni a un tempo que no le corresponden, y no la cortes ni la',
    'estires para llegar a una cantidad redonda de compases: escribila como es, completa.',
    '',
    RITMO_TITULO,
    ...RITMO_REAL,
    ...RITMO_COMPASES,
    '',
    'REGLAS',
    tocaAcordes
      ? '- Las CUATRO capas tienen que durar LO MISMO y estar alineadas: el acorde del compás 3 tiene'
      : '- Las TRES capas tienen que durar LO MISMO y estar alineadas: lo que suena en el compás 3',
    tocaAcordes
      ? '  que corresponder a lo que suena en el compás 3 de la melodía. Si hay anacrusa, las cuatro'
      : '  del acompañamiento tiene que corresponder al compás 3 de la melodía. Si hay anacrusa, las',
    '  capas la comparten.',
    ...(tocaAcordes
      ? [
          '- ACORDES: cuáles podés usar y cada cuánto pueden cambiar está más abajo, en su propia',
          '  sección. Si la canción pide uno que no está permitido, poné el más parecido de los que sí.',
          '- MELODIA: notas entre C4 y A5 (el rango del ukelele), una sola por vez.',
        ]
      : [
          '- MELODIA: esto es lo que TOCA EL ALUMNO, así que TODAS las notas tienen que estar entre',
          '  C4 y A5, que es lo que se puede tocar en un ukelele de 12 trastes. Si la melodía original',
          '  es más grave o más aguda, subila o bajala de octava entera para que entre.',
          '- MELODIA: una sola nota por vez. Nunca corchetes acá: el alumno tiene un solo dedo por nota.',
        ]),
    '- BAJO: registro grave, C2 a C4. Una nota por vez.',
    '- ACOMP: registro medio, C3 a C6. Para que suenen varias notas juntas se escriben entre',
    '  corchetes: "[C3,E3,G3]/2". Podés mezclar notas sueltas y corchetes en el mismo renglón.',
    ...(tocaAcordes
      ? [
          '',
          ...RASGUEO,
          '- Tenés la melodía delante porque la escribís vos en el mismo pedido: usala.',
          '  Compás por compás, mirá el renglón MELODIA y copiá SU ritmo en el de ACORDES.',
          '',
          ...reglasSubNivel(dif, permitidos),
          'Repito porque es el error más común: esto limita SOLO el renglón ACORDES.',
        ]
      : [
          '- ACOMP tiene que sostener la armonía de la canción, porque acá no hay renglón de acordes:',
          '  es lo único que le da contexto armónico a la melodía que toca el alumno.',
        ]),
    '',
    'FORMATO DE SALIDA',
    'Los tiempos se miden en TIEMPOS (beats): 1 = negra, .5 = corchea, 2 = blanca, 1.5 = con puntillo.',
    '"r/1" es un silencio. "~/1" es una ligadura: alarga lo anterior en vez de volver a tocarlo,',
    'y sirve para que algo cruce la barra de compás ("F/3 | ~/3" dura seis tiempos).',
    '"|" separa compases; poné una barra al final de cada compás.',
    'NO escribas tiempos de inicio ni números de compás: se calculan solos sumando las duraciones.',
    '',
    'MINIEJEMPLO DE LA FORMA — una anacrusa y 4 compases inventados, NO es una canción ni es tu respuesta.',
    'Está solo para que veas cómo se escribe. Mirá cuatro cosas: el primer compás es una',
    'anacrusa de un tiempo; el bajo se mueve en vez de repetir la fundamental; el acompañamiento',
    'arpegia; y los ACORDES siguen el ritmo de la MELODIA — dos golpes donde la melodía se mueve,',
    'uno sostenido con ligadura donde la melodía sostiene.',
    'BPM: 120',
    'COMPAS: 3/4',
    'MELODIA: | D4/1 | F4/1 A4/1.5 G4/.5 | E4/2 F4/1 | A4/3 | ~/3 |',
    'BAJO: | r/1 | D2/1 A2/1 F2/1 | C3/2 C3/1 | F2/1 A2/1 C3/1 | F2/1 C3/1 A2/1 |',
    'ACOMP: | r/1 | r/1 [F3,A3]/1 [D4,F4]/1 | [E3,G3]/2 r/1 | [F3,A3]/1 C4/1 A3/1 | [F3,A3,C4]/3 |',
    // Fijate que las duraciones de ACORDES son las MISMAS que las de MELODIA compás por
    // compás. Es literalmente la regla, mostrada en vez de explicada.
    ...(tocaAcordes ? ['ACORDES: | r/1 | F/1 F/1.5 F/.5 | C/2 C/1 | F/3 | ~/3 |'] : []),
    '',
    'ESCRIBÍ LA CANCIÓN ENTERA',
    'Ese miniejemplo tiene 3 compases porque muestra la forma, no porque las canciones duren eso.',
    'Vos tenés que escribir la canción COMPLETA, del primer compás al último.',
    '- Prohibido abreviar: nada de "...", "etc.", "(se repite)", "(igual que antes)" ni resúmenes.',
    '  Si una parte se repite, escribila de nuevo entera, compás por compás.',
    '- Si una capa te queda muy larga, podés partirla en varios renglones: todo lo que va después',
    '  de "MELODIA:" y antes del siguiente nombre de capa cuenta como esa capa.',
    '- No pidas confirmación ni ofrezcas continuar después: entregá la canción terminada.',
    '',
    'ANTES DE RESPONDER, VERIFICÁ (y corregí si hace falta)',
    tocaAcordes
      ? '1. ¿Están los seis renglones? BPM, COMPAS, MELODIA, BAJO, ACOMP y ACORDES.'
      : '1. ¿Están los cinco renglones? BPM, COMPAS, MELODIA, BAJO y ACOMP. (ACORDES no va.)',
    tocaAcordes
      ? '2. ¿Las cuatro capas tienen la MISMA cantidad de compases y suman los mismos tiempos?'
      : '2. ¿Las tres capas tienen la MISMA cantidad de compases y suman los mismos tiempos?',
    '3. ¿Cada compás suma exactamente los tiempos del compás, salvo el primero y el último?',
    '4. ¿Está la canción completa, sin abreviar ninguna repetición?',
    ...(tocaAcordes
      ? [
          dif === 'facil'
            ? '5. En ACORDES, ¿hay UN SOLO acorde por compás (aunque se rasguee varias veces)?'
            : '5. En ACORDES, ¿ningún compás tiene más de DOS acordes distintos?',
          '6. ¿MELODIA, BAJO y ACOMP quedaron ricos, sin haberlos simplificado por el límite de acordes?',
          '7. Compará ACORDES contra MELODIA compás por compás: ¿los golpes caen donde la melodía',
          '   se mueve y se sostienen donde la melodía sostiene? Si en ACORDES te quedaron todas',
          '   las duraciones iguales, está mal: eso es un metrónomo, no un rasgueo.',
        ]
      : [
          '5. En MELODIA, ¿TODAS las notas están entre C4 y A5? Es lo que el alumno puede tocar.',
          '6. ¿BAJO y ACOMP quedaron ricos, y ACOMP sostiene la armonía sin renglón de acordes?',
        ]),
    '',
    'RESPUESTA',
    'Devolvé solamente esos seis renglones, sin explicaciones, sin comentarios y sin bloque de',
    'código. Empezá directamente con "BPM:".',
  ].join('\n');
}
