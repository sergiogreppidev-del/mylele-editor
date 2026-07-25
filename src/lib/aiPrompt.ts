/* Arma el pedido para una IA.

   Ojo con el reparto de quién sabe qué: el autor sabe qué canción quiere, pero
   NO sabe en qué compás está ni cuántos compases dura. La IA sí. Por eso, por
   defecto, el pedido le pide que ELLA declare el compás y el tempo, y el editor
   después los aplica al nivel. Solo cuando el autor está armando un ejercicio
   propio tiene sentido imponerle la medida. */

import type { NotationTarget } from './notation';
import type { Difficulty } from './chartFormat';

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
   * Sub-nivel que se está creando. Cambia UNA sola cosa: cuántos acordes por
   * compás toca el alumno. La música de fondo no se toca — es la misma canción
   * en los dos, y simplificarla "para que combine" es justamente el error.
   */
  dificultad?: Difficulty;
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
- "|" separa compases. Poné una barra al final de cada compás.
- NO escribas tiempos de inicio ni números de compás: se calculan solos sumando las duraciones.`;

const SOLO_LA_LINEA = `Respondé ÚNICAMENTE con eso, sin explicaciones, sin comillas y sin bloque de código.`;

/**
 * La densidad de acordes es lo ÚNICO que separa a un sub-nivel del otro, así que
 * las reglas se escriben enteras para cada uno en vez de matizar un texto común:
 * un "salvo que sea el sub-nivel fácil" al final de una regla se lo saltean.
 */
function reglasDensidad(dificultad: Difficulty): string[] {
  if (dificultad === 'facil') {
    return [
      'CUÁNTOS ACORDES POR COMPÁS — regla dura, no la negocies',
      '- UN SOLO acorde por compás, ocupando el compás ENTERO: en 4/4 son todos "X/4"; en 3/4,',
      '  todos "X/3". La duración del acorde es igual a los tiempos del compás, siempre.',
      '- Está PROHIBIDO cambiar de acorde dentro de un compás. Nada de "F/2 C/2".',
      '- Si la armonía real de la canción cambia en la mitad del compás, ignorá el segundo',
      '  acorde y quedate con el que suena en el tiempo fuerte. Se pierde un matiz y está bien:',
      '  el alumno recién está aprendiendo a cambiar de posición y necesita tiempo para llegar.',
      '- Que un mismo acorde se repita varios compases seguidos NO es un problema, es lo esperado.',
      '- Único caso aparte: si hay anacrusa, el primer compás es corto y lleva un solo acorde',
      '  (o un silencio) que dure exactamente lo que ese compás corto.',
      '',
    ];
  }
  return [
    'CUÁNTOS ACORDES POR COMPÁS — regla dura, no la negocies',
    '- Como máximo DOS acordes por compás. Nunca tres o más.',
    '- Cuando la armonía cambia en la mitad del compás, escribí los dos, cada uno de media',
    '  duración: en 4/4 es "F/2 C/2". Ese es justo el ejercicio de este sub-nivel.',
    '- Pero no metas un cambio de más solo para que sea difícil: si en ese compás la canción',
    '  tiene un solo acorde, va uno solo, ocupando el compás entero.',
    '- Los dos acordes de un compás partido tienen que ser DISTINTOS. "C/2 C/2" es un error:',
    '  eso es un solo acorde de compás entero.',
    '- Que un mismo acorde dure varios compases seguidos sigue estando bien.',
    '',
  ];
}

export function buildAiPrompt(o: PromptOptions): string {
  if (o.target === 'nivel') return promptNivelCompleto(o);

  const pedido = o.pedido?.trim();
  const dif: Difficulty = o.dificultad ?? 'facil';
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
      `- Usá ÚNICAMENTE estos acordes: ${o.knownChords.join(', ') || '(no hay acordes cargados)'}. No inventes otros.`,
      '- Si la canción necesita un acorde que no está en esa lista, reemplazalo por el más parecido',
      '  (por ejemplo G7 -> G, Dm -> Am) y seguí adelante.',
      '- Antes de escribir, pensá la melodía y fijate qué notas caen en cada compás: el acorde',
      '  sale de ahí, no de la memoria.',
      '- No estires ni repitas nada para llegar a una cantidad redonda de compases: la canción dura',
      '  lo que dura. Twinkle Twinkle, por ejemplo, son 12 compases de 4/4, no 16.',
      '- Podés agregar :d (rasgueo hacia abajo) o :u (hacia arriba) después de la duración.',
      '  Si no ponés nada, es hacia abajo.',
      '',
      ...reglasDensidad(dif),
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

  partes.push(FORMATO, '');
  partes.push(o.imponerMedida ? SOLO_LA_LINEA : 'Respondé con los dos renglones de medida y después la línea de música, nada más.', '');

  /* ---- Ejemplo ---- */
  const bpb = o.imponerMedida ? o.beatsPerBar : 4;
  if (o.target === 'chords') {
    // El ejemplo tiene que mostrar la densidad que se está pidiendo: si muestra un
    // compás partido cuando se pidió uno por compás, la IA copia el ejemplo.
    partes.push(
      'MINIEJEMPLO DE LA FORMA — 4 compases inventados, NO es tu respuesta.',
      ...(dif === 'facil'
        ? [
            'Fijate que todos ocupan el compás entero y que el C se repite dos veces: así va.',
            ...(o.imponerMedida ? [] : ['BPM: 92', 'COMPAS: 4/4']),
            `| C/${bpb} | C/${bpb} | F/${bpb} | G/${bpb} |`,
          ]
        : [
            'Fijate que el tercero cambia de acorde en la mitad y los otros no.',
            ...(o.imponerMedida ? [] : ['BPM: 92', 'COMPAS: 4/4']),
            `| C/${bpb} | Am/${bpb} | F/${bpb / 2} C/${bpb / 2} | G/${bpb} |`,
          ]),
    );
  } else {
    partes.push(
      'MINIEJEMPLO DE LA FORMA — 3 compases inventados, NO es tu respuesta.',
      ...(o.imponerMedida ? [] : ['BPM: 120', 'COMPAS: 3/4']),
      '| G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 |',
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

  return partes.join('\n');
}

export const TARGET_LABEL: Record<ImportTarget, string> = {
  nivel: 'un nivel completo',
  chords: 'acordes (lo que toca el alumno)',
  melody: 'notas sueltas (lo que toca el alumno)',
  backing: 'melodía de fondo (la toca la app)',
};

/**
 * Pedido de un NIVEL ENTERO: la IA escribe el acompañamiento, la melodía y los
 * acordes en una sola pasada. La ventaja no es solo ahorrar pasos: al armar los
 * acordes tiene la melodía que acaba de escribir delante, que es exactamente lo
 * que le faltaba cuando los acordes salían despegados de la canción.
 */
function promptNivelCompleto(o: PromptOptions): string {
  const pedido = o.pedido?.trim();
  const acordes = o.knownChords.join(', ') || '(no hay acordes cargados)';
  const dif: Difficulty = o.dificultad ?? 'facil';

  return [
    'Sos un asistente que escribe niveles para MyLele, una app para aprender ukelele.',
    '',
    'TAREA',
    pedido
      ? `Escribí el nivel completo de: ${pedido}`
      : 'Escribí un nivel completo con una canción sencilla y reconocible.',
    'Son cuatro capas de la misma canción, alineadas entre sí:',
    '  MELODIA — la melodía de la canción. Una nota por vez.',
    '  BAJO    — la línea de bajo.',
    '  ACOMP   — el relleno armónico: arpegios, contracantos, acordes.',
    '  ACORDES — los acordes que rasguea el alumno.',
    '',
    'SEPARÁ DOS COSAS QUE NO SON LO MISMO',
    'MELODIA + BAJO + ACOMP son LA MÚSICA, la que reproduce la app. Tiene que sonar a un arreglo',
    'de verdad: rica, con movimiento y entretenida. NO tiene ninguna limitación de dificultad.',
    'ACORDES es EL JUEGO, lo único que toca el alumno. Eso sí tiene que ser simple.',
    'No simplifiques la música para que combine con el juego: son cosas distintas.',
    'Más abajo hay un límite de cuántos acordes por compás. Ese límite es SOLO para la capa',
    'ACORDES. MELODIA, BAJO y ACOMP no se tocan: la canción es la misma y suena igual de rica.',
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
    'RITMO — esto es lo que más se equivoca, leelo con atención',
    '- Escribí el ritmo REAL de la canción, no todas las notas iguales. Si dos sílabas son',
    '  corcheas, van /.5 cada una; si una nota se sostiene tres tiempos, va /3.',
    '- ANACRUSA: muchas canciones no empiezan en el tiempo fuerte. Si la tuya arranca antes,',
    '  escribí ese arranque como un PRIMER COMPÁS CORTO. El caso típico es "Feliz cumpleaños":',
    '  el "Fe-liz" son dos corcheas que caen ANTES del primer compás, y el tiempo fuerte cae',
    '  recién en "cum". Si lo escribís empezando en el tiempo 1, el acento queda en la sílaba',
    '  equivocada y la canción no se reconoce aunque las notas sean las correctas.',
    '- Cada compás tiene que sumar EXACTAMENTE los tiempos del compás. Las únicas excepciones',
    '  son el primero (si hay anacrusa) y el último (si la canción termina antes de completarlo).',
    '  Un compás de más o de menos corre todo lo que viene después y arruina la canción entera.',
    '',
    'REGLAS',
    '- Las CUATRO capas tienen que durar LO MISMO y estar alineadas: el acorde del compás 3 tiene',
    '  que corresponder a lo que suena en el compás 3 de la melodía. Si hay anacrusa, las cuatro',
    '  capas la comparten.',
    `- ACORDES: usá únicamente estos: ${acordes}. Si la canción pide otro, poné el más parecido`,
    '  (G7 -> G, Dm -> Am). Cuántos entran por compás está en la sección siguiente.',
    '- MELODIA: notas entre C4 y A5 (el rango del ukelele), una sola por vez.',
    '- BAJO: registro grave, C2 a C4. Una nota por vez.',
    '- ACOMP: registro medio, C3 a C6. Para que suenen varias notas juntas se escriben entre',
    '  corchetes: "[C3,E3,G3]/2". Podés mezclar notas sueltas y corchetes en el mismo renglón.',
    '',
    ...reglasDensidad(dif),
    'Repito porque es el error más común: esto limita SOLO el renglón ACORDES.',
    '',
    'FORMATO DE SALIDA',
    'Los tiempos se miden en TIEMPOS (beats): 1 = negra, .5 = corchea, 2 = blanca, 1.5 = con puntillo.',
    '"r/1" es un silencio. "|" separa compases; poné una barra al final de cada compás.',
    'NO escribas tiempos de inicio ni números de compás: se calculan solos sumando las duraciones.',
    '',
    'MINIEJEMPLO DE LA FORMA — son 3 compases inventados, NO es una canción ni es tu respuesta.',
    'Está solo para que veas cómo se escribe: el primer compás es una anacrusa de un tiempo, el',
    'bajo se mueve en vez de repetir la fundamental y el acompañamiento arpegia.',
    'BPM: 120',
    'COMPAS: 3/4',
    'MELODIA: | G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 |',
    'BAJO: | r/1 | C2/1 G2/1 E2/1 | G2/2 G2/1 |',
    'ACOMP: | r/1 | r/1 [E3,G3]/1 [C4,E4]/1 | [D3,G3]/2 r/1 |',
    'ACORDES: | r/1 | C/3 | G/3 |',
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
    '1. ¿Están los seis renglones? BPM, COMPAS, MELODIA, BAJO, ACOMP y ACORDES.',
    '2. ¿Las cuatro capas tienen la MISMA cantidad de compases y suman los mismos tiempos?',
    '3. ¿Cada compás suma exactamente los tiempos del compás, salvo el primero y el último?',
    '4. ¿Está la canción completa, sin abreviar ninguna repetición?',
    dif === 'facil'
      ? '5. En ACORDES, ¿hay UN SOLO acorde en cada compás, ocupando el compás entero?'
      : '5. En ACORDES, ¿ningún compás tiene más de DOS acordes, y los partidos son distintos entre sí?',
    '6. ¿MELODIA, BAJO y ACOMP quedaron ricos, sin haberlos simplificado por el límite de acordes?',
    '',
    'RESPUESTA',
    'Devolvé solamente esos seis renglones, sin explicaciones, sin comentarios y sin bloque de',
    'código. Empezá directamente con "BPM:".',
  ].join('\n');
}
