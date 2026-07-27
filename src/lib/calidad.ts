/* ===================================================================
   MyLele Editor · Control de calidad de una canción

   Dos verificaciones que hasta ahora se hacían a oído, canción por canción,
   y que son justo las que más veces salieron mal:

   1. ¿La armonía es de esta canción? Si el acorde de un compás no contiene
      ninguna nota de la melodía que suena ahí, o está corrido o es de otra
      versión. Es el detector de "los acordes no se parecen a la canción".
      La pieza que hace falta —saber qué nota suena en cada momento— ya estaba
      escrita en LevelOverview y nunca se llamaba desde ningún lado.

   2. ¿El acompañamiento es música o un metrónomo con alturas? El defecto que
      más veces hubo que corregir a mano: el bajo y el relleno repiten el mismo
      patrón en todos los compases y la canción no se reconoce. Eso se puede
      medir: si todos los compases tienen la misma forma, avisar.

   3. ¿El RASGUEO sigue a la canción o al metrónomo? El mismo defecto, pero en
      la capa que toca el alumno. Un golpe por tiempo de punta a punta obliga a
      cortar el acorde justo donde la canción respira: el final de Estrellita
      pide un Do sostenido y el juego mostraba dos Do seguidos.
   =================================================================== */

import { beatsPerBar, tidy } from './chartFormat';
import type { BackingEvent, ChordEvent, Issue, MelodyEvent } from './chartFormat';
import { STRING_MIDI, pitchToMidi } from './notation';

/** Una nota de la melodía, venga de donde venga, reducida a lo que importa acá. */
export interface NotaMelodica {
  t: number;
  dur: number;
  midi: number;
}

/**
 * La melodía del nivel, esté donde esté. En un nivel de notas es la capa jugable;
 * en uno de acordes vive dentro del acompañamiento marcada como 'lead'.
 */
export function melodiaDelNivel(melody: MelodyEvent[], backing: BackingEvent[]): NotaMelodica[] {
  if (melody.length > 0) {
    return melody.map((n) => ({ t: n.t, dur: n.dur, midi: STRING_MIDI[n.string] + n.fret }));
  }
  const lead: NotaMelodica[] = [];
  for (const n of backing) {
    if (n.v !== 'lead') continue;
    const midi = pitchToMidi(n.pitch);
    if (midi !== null) lead.push({ t: n.t, dur: n.dur, midi });
  }
  return lead;
}

export interface ChoqueArmonico {
  /** Índice del acorde en la lista original, para poder marcarlo en pantalla. */
  index: number;
  chord: string;
  t: number;
  /** Ninguna nota de la melodía pertenece al acorde. Casi siempre está corrido. */
  ninguna: boolean;
  /** Notas que suenan durante el acorde y le son de verdad ajenas. */
  ajenas: string[];
}

const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Cuánto se pisan dos tramos de tiempo. */
function solape(aT: number, aDur: number, bT: number, bDur: number): number {
  return Math.max(0, Math.min(aT + aDur, bT + bDur) - Math.max(aT, bT));
}

/* LAS NOTAS QUE NO SON DEL ACORDE PERO SUENAN BIEN IGUAL
   ------------------------------------------------------
   Una tríada tiene tres notas, y la melodía de cualquier canción de verdad pasa
   todo el tiempo por notas que no son ninguna de esas tres. La sexta, la novena
   y la séptima son las más comunes y son CONSONANTES: no delatan ningún error.

   Esto no era teoría: Cielito lindo daba OCHO errores que impedían publicarla, y
   los ocho eran de este tipo. El «ay» sostenido es un La sobre Do —una sexta— y
   el control decía «el acorde Do no contiene NINGUNA nota de la melodía». El Fa
   sobre Sol que marcaba como ajeno es, literalmente, el G7 de la transcripción
   original. La canción estaba bien; el control estaba mal.

   Se miden como intervalos desde la FUNDAMENTAL, que es la primera de
   `pitch_classes`. Contar «a cuántos semitonos está de la nota más cercana del
   acorde» no sirve: el Si sobre Fa está a dos semitonos del La, y sin embargo es
   un tritono contra la fundamental. */
const CONSONANTES_MAYOR = new Set([2, 9, 10, 11]); // 9ª, 6ª, 7ª menor, 7ª mayor
const CONSONANTES_MENOR = new Set([2, 5, 9, 10]); // 9ª, 11ª, 6ª dórica, 7ª menor

/**
 * Corta un evento en pedazos, uno por compás, y le pone a cada uno su número de
 * compás (−1 = la anacrusa). Un acorde puede durar más que un compás: el «ay» de
 * Cielito lindo es un solo rasgueo de seis tiempos.
 */
function porCompas(
  t: number,
  dur: number,
  bpb: number,
  pickup: number,
): { compas: number; t: number; dur: number }[] {
  const out: { compas: number; t: number; dur: number }[] = [];
  let cursor = t;
  const fin = t + dur;
  while (cursor < fin - 0.001) {
    const compas = cursor < pickup ? -1 : Math.floor((cursor - pickup) / bpb);
    const corte = compas < 0 ? pickup : pickup + (compas + 1) * bpb;
    const hasta = Math.min(fin, corte);
    out.push({ compas, t: cursor, dur: hasta - cursor });
    cursor = hasta;
  }
  return out;
}

/**
 * ¿Cada acorde calza con lo que canta la melodía mientras dura?
 *
 * Se pesa por duración, no por cantidad de notas: una nota de paso corta que no
 * pertenece al acorde es normal y no tiene que dar aviso; lo que delata un error
 * es que la mayor parte de lo que suena sea ajeno.
 *
 * Tres categorías, no dos:
 *   propia  — es una nota del acorde
 *   vecina  — no lo es, pero es una extensión consonante (ver arriba)
 *   ajena   — choca de verdad: segunda menor, tritono, la tercera cambiada
 *
 * LO QUE SE JUZGA ES «EL DO DE ESTE COMPÁS», NO CADA RASGUEO
 * ----------------------------------------------------------
 * Antes se miraba evento por evento, y eso funcionaba cuando un compás tenía un
 * acorde y punto. Desde que el rasgueo sigue el ritmo de la melodía hay un golpe
 * por nota, y entonces aparece un rasgueo que cubre UNA SOLA nota de la melodía.
 * Si esa nota es de paso, el control decía «el acorde Do no contiene NINGUNA nota
 * de la melodía» — y tenía razón sobre ese rasgueo suelto, pero la pregunta estaba
 * mal hecha: la armonía no se juzga golpe a golpe.
 *
 * El compás 2 del Himno a la alegría canta Sol Fa Mi Re sobre un Do. Mirado
 * entero, tres de las cuatro notas cierran. Mirado rasgueo por rasgueo, el
 * segundo golpe solo ve el Fa y parece un error.
 */
export function verificarArmonia(
  chords: ChordEvent[],
  melodia: NotaMelodica[],
  chordPcs: Record<string, number[]>,
  medida: { beatsPerBar: number; pickup: number } = { beatsPerBar: 4, pickup: 0 },
): ChoqueArmonico[] {
  if (melodia.length === 0) return [];

  // Los rasgueos del mismo acorde dentro del mismo compás son UNA sola cosa.
  const grupos = new Map<
    string,
    { index: number; chord: string; t: number; tramos: { t: number; dur: number }[] }
  >();

  chords.forEach((c, index) => {
    if (!chordPcs[c.chord]?.length) return;
    for (const tr of porCompas(c.t, c.dur, medida.beatsPerBar, medida.pickup)) {
      const clave = `${tr.compas}|${c.chord}`;
      const ya = grupos.get(clave);
      if (ya) ya.tramos.push(tr);
      else grupos.set(clave, { index, chord: c.chord, t: tr.t, tramos: [tr] });
    }
  });

  const out: ChoqueArmonico[] = [];

  for (const g of grupos.values()) {
    const pcs = chordPcs[g.chord];
    const suyas = new Set(pcs.map((p) => ((p % 12) + 12) % 12));

    // La fundamental es la primera de `pitch_classes`, y la tercera dice si el
    // acorde es mayor o menor: sobre un menor la 11ª suena bien (no hay tercera
    // mayor con la que chocar) y la tercera mayor sí molesta.
    const fundamental = ((pcs[0] % 12) + 12) % 12;
    const tercera = pcs.length > 1 ? (((pcs[1] - pcs[0]) % 12) + 12) % 12 : 4;
    const consonantes = tercera === 3 ? CONSONANTES_MENOR : CONSONANTES_MAYOR;

    let propio = 0;
    let vecino = 0;
    let ajeno = 0;
    const ajenas = new Set<string>();

    for (const n of melodia) {
      let cuanto = 0;
      for (const tr of g.tramos) cuanto += solape(tr.t, tr.dur, n.t, n.dur);
      if (cuanto <= 0.001) continue;
      const pc = ((n.midi % 12) + 12) % 12;
      if (suyas.has(pc)) propio += cuanto;
      else if (consonantes.has((pc - fundamental + 12) % 12)) vecino += cuanto;
      else {
        ajeno += cuanto;
        ajenas.add(NOMBRES[pc]);
      }
    }

    if (propio + vecino + ajeno <= 0.001) continue; // no hay melodía acá: nada que decir

    if (propio <= 0.001 && vecino <= 0.001) {
      // Ni una nota del acorde ni una extensión consonante: o está corrido, o es
      // de otra versión de la canción.
      out.push({ index: g.index, chord: g.chord, t: g.t, ninguna: true, ajenas: [...ajenas] });
    } else if (ajeno > propio + vecino) {
      // La melodía pasa más tiempo chocando que calzando. Tiene que ser MÁS, no
      // empatar: una corchea de paso contra una negra buena empata, y avisar de
      // eso es ruido.
      out.push({ index: g.index, chord: g.chord, t: g.t, ninguna: false, ajenas: [...ajenas] });
    }
  }

  return out.sort((a, b) => a.t - b.t);
}

/**
 * Los choques, traducidos a avisos, ubicados por compás para poder ir a mirarlos.
 *
 * Hay como mucho UN aviso por compás y por acorde, porque así los agrupa
 * `verificarArmonia`. Antes salía uno por RASGUEO y la lista mostraba dos veces
 * seguidas la misma frase, palabra por palabra: leído por alguien que no escribió
 * el código, eso no parece «dos golpes con el mismo problema», parece que la app
 * se equivocó y repitió el renglón.
 */
export function avisosDeArmonia(
  choques: ChoqueArmonico[],
  timeSig: string,
  pickup: number,
): Issue[] {
  const bpb = beatsPerBar(timeSig);
  const compasDe = (t: number) => (t < pickup ? 'la anacrusa' : `el compás ${Math.floor((t - pickup) / bpb) + 1}`);

  return choques.map((c) => ({
    level: c.ninguna ? 'error' : 'warn',
    message: c.ninguna
      ? `En ${compasDe(c.t)} el acorde ${c.chord} no contiene NINGUNA nota de la melodía (suena ${c.ajenas.join(', ')}). O está corrido, o es de otra versión de la canción.`
      : `En ${compasDe(c.t)} la melodía pasa más tiempo fuera del acorde ${c.chord} que dentro (${c.ajenas.join(', ')}). Fijate si no va otro acorde.`,
  }));
}

/* ---------------- ¿Música o metrónomo? ---------------- */

/**
 * La firma rítmica de un compás: en qué momentos, relativos al inicio del compás,
 * empieza algo. No mira las alturas — un bajo que hace "fundamental, fundamental,
 * fundamental" con notas distintas sigue siendo un metrónomo.
 */
function firmaDelCompas(notas: { t: number; dur: number }[], inicio: number, largo: number): string {
  const dentro = notas
    .filter((n) => n.t >= inicio - 0.001 && n.t < inicio + largo - 0.001)
    .map((n) => tidy(n.t - inicio))
    .sort((a, b) => a - b);
  return [...new Set(dentro)].join(',');
}

/**
 * Avisa cuando el acompañamiento repite el mismo patrón compás tras compás.
 * Es el defecto que más veces hubo que corregir a mano: la canción no se
 * reconoce aunque las notas sean correctas, porque no respira.
 */
export function detectarMetronomo(
  backing: BackingEvent[],
  timeSig: string,
  pickup: number,
): Issue[] {
  const bpb = beatsPerBar(timeSig);

  /* NO HAY FONDO — el caso que este control no miraba.
     Estaba escrito para "el acompañamiento es mecánico" y arrancaba con
     `if (acomp.length === 0) return []`: una canción SIN capa de fondo no daba ni un
     aviso, que es peor que una mecánica. Sin fondo la app solo toca el metrónomo, y el
     alumno rasguea acordes sueltos contra un clic — no hay canción.
     Pasó de verdad: se cargaron once canciones de práctica con la capa de acordes y
     nada más, y ningún control dijo nada hasta que alguien las jugó. */
  if (backing.length === 0) {
    return [
      {
        level: 'warn',
        message:
          'Este nivel no tiene capa de FONDO. La app va a tocar solo el metrónomo: el alumno rasguea contra un clic y no hay canción. Pedile a la IA la melodía, el bajo y el acompañamiento.',
      },
    ];
  }

  const acomp = backing.filter((n) => (n.v ?? 'acomp') !== 'lead');
  if (acomp.length === 0) {
    return [
      {
        level: 'warn',
        message:
          'El fondo tiene melodía pero no tiene bajo ni acompañamiento. Va a sonar a una sola voz suelta, no a un arreglo.',
      },
    ];
  }

  const fin = acomp.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  // La anacrusa es un compás corto y siempre distinto: no entra en la comparación.
  const compases = Math.floor((fin - pickup) / bpb);
  if (compases < 4) return []; // muy corto para sacar conclusiones

  const firmas: string[] = [];
  for (let i = 0; i < compases; i++) {
    firmas.push(firmaDelCompas(acomp, pickup + i * bpb, bpb));
  }

  const distintas = new Set(firmas.filter((f) => f !== ''));
  if (distintas.size === 0) return [];

  const out: Issue[] = [];
  if (distintas.size === 1) {
    out.push({
      level: 'warn',
      message: `Los ${compases} compases del acompañamiento tienen exactamente el mismo ritmo. Eso suena a metrónomo con alturas, no a un arreglo: la canción no se reconoce aunque las notas estén bien. Pedile a la IA que le dé movimiento al bajo y arpegios al relleno.`,
    });
  } else if (distintas.size <= Math.max(2, Math.floor(compases / 4))) {
    out.push({
      level: 'warn',
      message: `El acompañamiento repite ${distintas.size} patrones en ${compases} compases. Suena mecánico: conviene que la textura cambie entre secciones.`,
    });
  }

  // El bajo clavado en el tiempo 1 y nada más es el otro síntoma clásico.
  const bajo = backing.filter((n) => n.v === 'bass');
  if (bajo.length >= 4) {
    const enElUno = bajo.filter((n) => Math.abs((n.t - pickup) % bpb) < 0.001).length;
    if (enElUno === bajo.length) {
      out.push({
        level: 'warn',
        message: 'El bajo toca solamente en el tiempo 1 de cada compás. Que se mueva —fundamental, quinta, notas de paso— cambia por completo cómo suena.',
      });
    }
  }

  return out;
}

/* ---------------- ¿El rasgueo sigue a la canción? ---------------- */

/**
 * Avisa cuando la capa que toca el alumno es un golpe por tiempo de punta a punta.
 *
 * Este control faltaba, y su ausencia costó caro: las once canciones de práctica se
 * cargaron con un rasgueo parejo y nadie dijo nada hasta que se jugaron. Lo que se
 * escucha es que el juego te pide DOS golpes donde la canción sostiene UNO —el final
 * de Estrellita es el caso claro— y hay que cortar el acorde para volver a golpear
 * justo donde la música respira.
 *
 * NO mide cuántos golpes hay. Un rasgueo denso está perfecto si la melodía es densa;
 * lo que delata el problema es que TODOS duren lo mismo, porque ninguna canción se
 * mueve pareja de principio a fin.
 *
 * Se compara contra la melodía solo para el aviso más útil —"acá la melodía sostiene
 * y vos golpeás dos veces"—, pero el aviso base no la necesita.
 */
export function detectarRasgueoMecanico(
  chords: ChordEvent[],
  melodia: NotaMelodica[],
): Issue[] {
  // Con pocos golpes no hay de dónde sacar una conclusión: cuatro acordes iguales
  // pueden ser una intro, no un defecto.
  if (chords.length < 8) return [];

  const duraciones = new Set(chords.map((c) => tidy(c.dur)));
  if (duraciones.size > 1) return [];

  const dur = [...duraciones][0];
  const base = `Los ${chords.length} rasgueos duran exactamente lo mismo (${dur} ${dur === 1 ? 'tiempo' : 'tiempos'} cada uno).`;

  // Si tenemos la melodía, se puede señalar el lugar concreto donde molesta: una nota
  // larga cubierta por varios golpes es exactamente el "dos Do en vez de uno".
  const sostenida = melodia.find(
    (n) => n.dur > dur + 0.001 && chords.filter((c) => solape(c.t, c.dur, n.t, n.dur) > 0.001).length > 1,
  );

  return [
    {
      level: 'warn',
      message: sostenida
        ? `${base} Eso es un metrónomo, no un rasgueo. Mirá el tiempo ${tidy(sostenida.t)}: la melodía sostiene ${tidy(sostenida.dur)} tiempos y el alumno tiene que golpear varias veces ahí, o sea cortar el acorde justo donde la canción respira. Pedile a la IA que el rasgueo siga el ritmo de la melodía.`
        : `${base} Eso es un metrónomo, no un rasgueo: ninguna canción se mueve pareja de principio a fin. Pedile a la IA que el rasgueo siga el ritmo de la melodía —un golpe largo donde la melodía sostiene, varios donde se mueve.`,
    },
  ];
}
