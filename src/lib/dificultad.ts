/* ===================================================================
   MyLele Editor · Medir qué tan difícil es un nivel

   Por qué existe este archivo. Se midieron los tres niveles de acordes que
   estaban publicados y los tres daban lo mismo:

     nivel-2-acordes    4 acordes · 18,8 cambios/min · 2,9 dedos por cambio
     nivel-3-cambios    4 acordes · 17,5 cambios/min · 2,9 dedos por cambio
     nivel-4-rasgueos   4 acordes · 18,4 cambios/min · 2,9 dedos por cambio

   Lo único que variaba entre ellos era cuántas veces se rasguea. Y rasguear
   más no le agrega nada a la mano que está aprendiendo a formar acordes, que
   es la que sufre. Por eso la regla vieja —"acordes por compás"— no separaba
   nada: en canciones de principiante la armonía cambia una vez por compás
   sola, así que el límite nunca apretaba.

   Lo que sí hace difícil un nivel de acordes, en orden:
     1. cuántas formas distintas hay que memorizar
     2. cuáles (Am y C piden 1 dedo, F pide 2, G pide 3)
     3. qué transiciones (Am↔F mueve 1 dedo, F↔G mueve 5)
     4. cada cuánto hay que cambiar

   Todo eso se calcula con datos que ya están en la base: las digitaciones de
   la tabla de acordes, los eventos del chart y el BPM. No hace falta nada nuevo.
   =================================================================== */

import { beatsPerBar, chartLengthBeats } from './chartFormat';
import type { ChordEvent, Difficulty, Issue, MelodyEvent } from './chartFormat';

/** Digitaciones por acorde: 4 trastes, en orden G-C-E-A. Sale de la tabla `chords`. */
export type Digitaciones = Record<string, number[]>;

/* ---------------- Coste físico de la mano izquierda ---------------- */

/** Cuántos dedos pisan esta forma. Al aire (0) no cuenta. */
export function dedosDeLaForma(frets: number[] | undefined): number {
  return (frets ?? []).filter((f) => f > 0).length;
}

/**
 * Cuántos dedos hay que mover para pasar de una forma a la otra: los que se
 * levantan más los que se apoyan. Es la medida honesta de lo que cuesta un
 * cambio — y la que muestra que F↔G (5) es el salto más duro entre los cuatro
 * acordes cargados, mientras que Am↔F (1) es el más fácil del instrumento.
 */
export function costoTransicion(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b) return 0;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] > 0) n++; // se levanta
    if (b[i] > 0) n++; // se apoya
  }
  return n;
}

/** Los acordes ordenados del más fácil de formar al más difícil. */
export function porFacilidad(dig: Digitaciones): string[] {
  return Object.keys(dig).sort((a, b) => {
    const d = dedosDeLaForma(dig[a]) - dedosDeLaForma(dig[b]);
    if (d !== 0) return d;
    // A igual cantidad de dedos, más cerca de la cejuela es más cómodo.
    return Math.max(...dig[a], 0) - Math.max(...dig[b], 0);
  });
}

/* ---------------- Métricas de un nivel de acordes ---------------- */

export interface MetricasAcordes {
  tipo: 'chords';
  /** Formas distintas que el alumno tiene que saber. */
  distintos: string[];
  /** Transiciones reales: repetir el mismo acorde no cuenta. */
  cambios: number;
  segundos: number;
  cambiosPorMinuto: number;
  /** Promedio de dedos que se mueven en cada cambio. */
  dedosPorCambio: number;
  /** El salto más duro de la canción, que es el que traba al alumno. */
  peorSalto: { de: string; a: string; dedos: number } | null;
  /** Mano derecha: eje aparte, no entra en el sub-nivel. */
  rasgueos: number;
  rasgueosPorMinuto: number;
  /** Compases que aguanta cada acorde antes de cambiar, en promedio. */
  comasesPorAcorde: number;
}

export interface MetricasMelodia {
  tipo: 'melody';
  notas: number;
  segundos: number;
  notasPorMinuto: number;
  trasteMax: number;
  /** Cuántas posiciones distintas (cuerda + traste) hay que aprender. */
  posiciones: number;
  /** Cambios de cuerda: saltar de cuerda cuesta más que moverse en la misma. */
  saltosDeCuerda: number;
}

export type Metricas = MetricasAcordes | MetricasMelodia;

const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function medirAcordes(
  events: ChordEvent[],
  dig: Digitaciones,
  bpm: number,
  timeSig: string,
): MetricasAcordes {
  const orden = [...events].sort((a, b) => a.t - b.t);
  const beats = chartLengthBeats(orden);
  const segundos = bpm > 0 ? (beats * 60) / bpm : 0;
  const bpb = beatsPerBar(timeSig);

  // Bloques: rasguear cuatro veces el mismo C es UN acorde, no cuatro. Contar
  // eventos en vez de bloques era lo que hacía parecer difícil a nivel-4-rasgueos.
  const bloques: ChordEvent[] = orden.filter((e, i) => i === 0 || e.chord !== orden[i - 1].chord);

  let sumaDedos = 0;
  let peorSalto: MetricasAcordes['peorSalto'] = null;
  for (let i = 1; i < bloques.length; i++) {
    const de = bloques[i - 1].chord;
    const a = bloques[i].chord;
    const dedos = costoTransicion(dig[de], dig[a]);
    sumaDedos += dedos;
    if (!peorSalto || dedos > peorSalto.dedos) peorSalto = { de, a, dedos };
  }

  const cambios = Math.max(0, bloques.length - 1);
  const minutos = segundos / 60;

  return {
    tipo: 'chords',
    distintos: [...new Set(orden.map((e) => e.chord))],
    cambios,
    segundos: redondear(segundos),
    cambiosPorMinuto: minutos > 0 ? redondear(cambios / minutos) : 0,
    dedosPorCambio: cambios > 0 ? redondear(sumaDedos / cambios) : 0,
    peorSalto,
    rasgueos: orden.length,
    rasgueosPorMinuto: minutos > 0 ? redondear(orden.length / minutos) : 0,
    comasesPorAcorde: bloques.length > 0 && bpb > 0 ? redondear(beats / bpb / bloques.length) : 0,
  };
}

export function medirMelodia(events: MelodyEvent[], bpm: number): MetricasMelodia {
  const orden = [...events].sort((a, b) => a.t - b.t);
  const beats = chartLengthBeats(orden);
  const segundos = bpm > 0 ? (beats * 60) / bpm : 0;
  const minutos = segundos / 60;

  let saltos = 0;
  for (let i = 1; i < orden.length; i++) {
    if (orden[i].string !== orden[i - 1].string) saltos++;
  }

  return {
    tipo: 'melody',
    notas: orden.length,
    segundos: redondear(segundos),
    notasPorMinuto: minutos > 0 ? redondear(orden.length / minutos) : 0,
    trasteMax: orden.reduce((m, e) => Math.max(m, e.fret), 0),
    posiciones: new Set(orden.map((e) => `${e.string}${e.fret}`)).size,
    saltosDeCuerda: saltos,
  };
}

/* ---------------- Qué pide cada sub-nivel ---------------- */

/**
 * Los topes de cada sub-nivel. Están elegidos contra lo medido: los niveles que
 * ya existían estaban todos en 18 cambios/min con 4 acordes, así que ese es el
 * techo del segundo sub-nivel, y el primero tiene que quedar claramente por debajo.
 *
 * `acordesPermitidos` no lista acordes por nombre a propósito: se toman los N más
 * fáciles de los que haya cargados, calculado con las digitaciones. Así el día que
 * entren D o Em la regla sigue teniendo sentido sola.
 */
export interface Perfil {
  id: Difficulty;
  /** Cuántas formas distintas como máximo. */
  maxDistintos: number;
  /** Cambios de acorde por minuto. Es el esfuerzo real de la mano izquierda. */
  maxCambiosPorMinuto: number;
  /** Promedio de dedos por cambio. Deja afuera las progresiones con saltos duros. */
  maxDedosPorCambio: number;
  /** Compases que debería aguantar cada acorde. */
  minCompasesPorAcorde: number;
}

export const PERFILES: Record<Difficulty, Perfil> = {
  facil: { id: 'facil', maxDistintos: 3, maxCambiosPorMinuto: 11, maxDedosPorCambio: 3, minCompasesPorAcorde: 2 },
  dificil: { id: 'dificil', maxDistintos: 4, maxCambiosPorMinuto: 20, maxDedosPorCambio: 5, minCompasesPorAcorde: 1 },
};

/** Los acordes que se le van a permitir a la IA en este sub-nivel. */
export function acordesPara(dif: Difficulty, dig: Digitaciones): string[] {
  return porFacilidad(dig).slice(0, PERFILES[dif].maxDistintos);
}

/**
 * ¿El chart cumple lo que promete su sub-nivel? Avisa, no bloquea: a veces la
 * canción manda y está bien pasarse. Lo que no puede pasar es no enterarse.
 */
export function verificarPerfil(m: MetricasAcordes, dif: Difficulty, dig: Digitaciones): Issue[] {
  const p = PERFILES[dif];
  const out: Issue[] = [];
  const permitidos = new Set(acordesPara(dif, dig));

  const deMas = m.distintos.filter((c) => !permitidos.has(c));
  if (deMas.length) {
    out.push({
      level: 'warn',
      message: `Este sub-nivel apunta a los ${p.maxDistintos} acordes más fáciles (${[...permitidos].join(', ')}), y la canción usa además ${deMas.join(', ')}. Si es a propósito, dejalo.`,
    });
  }
  if (m.cambiosPorMinuto > p.maxCambiosPorMinuto) {
    out.push({
      level: 'warn',
      message: `${m.cambiosPorMinuto} cambios de acorde por minuto, y este sub-nivel apunta a ${p.maxCambiosPorMinuto}. La mano izquierda no llega: bajá el BPM o hacé que los acordes duren más.`,
    });
  }
  if (m.dedosPorCambio > p.maxDedosPorCambio) {
    out.push({
      level: 'warn',
      message: `Cada cambio mueve ${m.dedosPorCambio} dedos en promedio (el tope de este sub-nivel es ${p.maxDedosPorCambio}). Suele ser un acorde de 3 dedos metido entre dos de uno.`,
    });
  }
  if (m.peorSalto && m.peorSalto.dedos >= 5) {
    out.push({
      level: 'warn',
      message: `El salto ${m.peorSalto.de} → ${m.peorSalto.a} mueve ${m.peorSalto.dedos} dedos: es el que va a trabar al alumno. Fijate si se puede evitar o darle más tiempo.`,
    });
  }
  return out;
}
