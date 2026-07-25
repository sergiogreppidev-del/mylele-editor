/* Arma el pedido para una IA.

   Ojo con el reparto de quién sabe qué: el autor sabe qué canción quiere, pero
   NO sabe en qué compás está ni cuántos compases dura. La IA sí. Por eso, por
   defecto, el pedido le pide que ELLA declare el compás y el tempo, y el editor
   después los aplica al nivel. Solo cuando el autor está armando un ejercicio
   propio tiene sentido imponerle la medida. */

import type { NotationTarget } from './notation';

interface PromptOptions {
  target: NotationTarget;
  title: string;
  bpm: number;
  timeSig: string;
  beatsPerBar: number;
  bars: number;
  knownChords: string[];
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

export function buildAiPrompt(o: PromptOptions): string {
  const pedido = o.pedido?.trim();
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
      '',
      '- LO MÁS IMPORTANTE: poné cada acorde donde REALMENTE cambia en la canción, y hacelo durar',
      '  lo que dura ahí. Muchas canciones cambian de acorde en la mitad del compás: eso se escribe',
      '  con dos acordes de media duración, por ejemplo "F/2 C/2" en un compás de 4/4.',
      '- NO pongas un acorde por compás por comodidad. Si la armonía cambia dos veces en un compás,',
      '  escribí los dos; si un acorde dura tres compases, escribilo como uno solo largo.',
      '- No estires ni repitas nada para llegar a una cantidad redonda de compases: la canción dura',
      '  lo que dura. Twinkle Twinkle, por ejemplo, son 12 compases de 4/4, no 16.',
      '- Antes de escribir, pensá la melodía y fijate en qué sílaba cae cada cambio de acorde.',
      '',
      '- Podés agregar :d (rasgueo hacia abajo) o :u (hacia arriba) después de la duración.',
      '  Si no ponés nada, es hacia abajo.',
      '',
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
    partes.push(
      'EJEMPLO (fijate que el tercer compás cambia de acorde en la mitad)',
      ...(o.imponerMedida ? [] : ['BPM: 92', 'COMPAS: 4/4']),
      `| C/${bpb} | Am/${bpb} | F/${bpb / 2} C/${bpb / 2} | G/${bpb} |`,
    );
  } else {
    partes.push(
      'EJEMPLO',
      ...(o.imponerMedida ? [] : ['BPM: 120', 'COMPAS: 3/4']),
      '| G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 |',
    );
  }

  return partes.join('\n');
}

export const TARGET_LABEL: Record<NotationTarget, string> = {
  chords: 'acordes (lo que toca el alumno)',
  melody: 'notas sueltas (lo que toca el alumno)',
  backing: 'melodía de fondo (la toca la app)',
};
