/* ===================================================================
   MyLele · Teoría de acordes
   Deduce las notas de un acorde a partir de su nombre y las verifica
   contra la digitación que se dibujó en el diagrama.

   Esto alimenta `pitch_classes`, que es lo que usa el motor de audio para
   detectar el acorde. Un valor mal puesto acá no rompe nada visible: hace
   que el acorde simplemente no se detecte nunca. Por eso se deduce solo
   y se contrasta con los trastes, en vez de pedirlo a mano.
   =================================================================== */

import type { Issue, UkeString } from './chartFormat';
import { STRING_MIDI } from './notation';
import { UKE_STRINGS } from './chartFormat';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOMBRE_ES: Record<string, string> = {
  C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si',
};

interface Quality {
  /** Intervalos en semitonos desde la fundamental. */
  intervals: number[];
  es: string;
}

// El orden NO importa: la comparación de abajo es exacta, no por prefijo, así que
// "m7" nunca se puede confundir con "m". Están agrupados por familia para poder
// leerlos, nada más. (El comentario anterior decía lo contrario y frenaba a quien
// quisiera tocarlo, haciéndole creer que había un riesgo que no existe.)
const QUALITIES: [string, Quality][] = [
  ['maj7', { intervals: [0, 4, 7, 11], es: 'mayor séptima' }],
  ['dim7', { intervals: [0, 3, 6, 9], es: 'disminuido séptima' }],
  ['sus2', { intervals: [0, 2, 7], es: 'sus2' }],
  ['sus4', { intervals: [0, 5, 7], es: 'sus4' }],
  ['add9', { intervals: [0, 4, 7, 2], es: 'con novena' }],
  ['min7', { intervals: [0, 3, 7, 10], es: 'menor séptima' }],
  ['dim', { intervals: [0, 3, 6], es: 'disminuido' }],
  ['aug', { intervals: [0, 4, 8], es: 'aumentado' }],
  ['maj', { intervals: [0, 4, 7], es: 'mayor' }],
  ['min', { intervals: [0, 3, 7], es: 'menor' }],
  ['m7', { intervals: [0, 3, 7, 10], es: 'menor séptima' }],
  ['m6', { intervals: [0, 3, 7, 9], es: 'menor sexta' }],
  ['M7', { intervals: [0, 4, 7, 11], es: 'mayor séptima' }],
  ['m', { intervals: [0, 3, 7], es: 'menor' }],
  ['7', { intervals: [0, 4, 7, 10], es: 'séptima' }],
  ['6', { intervals: [0, 4, 7, 9], es: 'sexta' }],
  ['+', { intervals: [0, 4, 8], es: 'aumentado' }],
  // Habituales en ukelele que faltaban:
  ['sus', { intervals: [0, 5, 7], es: 'sus4' }],   // "sus" a secas se usa como sus4
  ['m7b5', { intervals: [0, 3, 6, 10], es: 'semidisminuido' }],
  ['9', { intervals: [0, 4, 7, 10, 2], es: 'novena' }],
  ['m9', { intervals: [0, 3, 7, 10, 2], es: 'menor novena' }],
  ['madd9', { intervals: [0, 3, 7, 2], es: 'menor con novena' }],
  ['', { intervals: [0, 4, 7], es: 'mayor' }],
];

export interface ParsedChord {
  rootPc: number;
  rootName: string;
  quality: Quality;
  /** Clases de altura en orden: fundamental, tercera, quinta, (séptima). */
  pitchClasses: number[];
  /** Un peso por clase de altura, en la misma posición. */
  weights: number[];
  nombreEs: string;
}

/** "Am" · "G7" · "F#m7" · "Bb" → las notas que lo componen. null si no se entiende. */
export function parseChordName(id: string): ParsedChord | null {
  const txt = id.trim();
  const m = /^([A-G])([#b]?)(.*)$/.exec(txt);
  if (!m) return null;

  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const rootPc = (((LETTER_PC[m[1]] + alter) % 12) + 12) % 12;
  const suffix = m[3];

  const found = QUALITIES.find(([s]) => s === suffix);
  if (!found) return null;
  const quality = found[1];

  const pitchClasses = quality.intervals.map((i) => (rootPc + i) % 12);

  // La fundamental pesa más porque es la que más se sostiene. La séptima pesa
  // menos: aparece y desaparece según cómo se rasguee, y exigirla da falsos
  // negativos. Las extensiones (novena en adelante) pesan menos todavía.
  //
  // OJO: esto es un punto de partida razonable, NO una calibración. Los pesos del
  // G que hay en la base ({1.0, 1.6, 0.5}) se midieron contra grabaciones reales y
  // son muy distintos de lo que sale de acá. Por eso el editor no los recalcula al
  // guardar un acorde que ya existe: los respeta.
  const weights = pitchClasses.map((_, i) =>
    i === 0 ? 1.3 : i === 3 ? 0.9 : i >= 4 ? 0.8 : 1.0,
  );

  const rootName = m[1] + m[2];
  const nombreEs = `${NOMBRE_ES[m[1]] ?? m[1]}${m[2] === '#' ? ' sostenido' : m[2] === 'b' ? ' bemol' : ''} ${quality.es}`;

  return { rootPc, rootName, quality, pitchClasses, weights, nombreEs };
}

export function pcName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

/** Las notas que realmente suenan con esa digitación (sin repetir). */
export function fingeringPitchClasses(frets: number[]): number[] {
  const out = new Set<number>();
  UKE_STRINGS.forEach((s: UkeString, i) => {
    const fret = frets[i];
    if (!Number.isFinite(fret) || fret < 0) return;
    out.add((STRING_MIDI[s] + fret) % 12);
  });
  return [...out].sort((a, b) => a - b);
}

/**
 * Contrasta el nombre del acorde con la digitación dibujada.
 * Es la única forma de darse cuenta de que un acorde nuevo está mal cargado
 * antes de que el alumno se pelee con un acorde que nunca se detecta.
 */
export function validateChordShape(id: string, frets: number[]): Issue[] {
  const issues: Issue[] = [];
  const parsed = parseChordName(id);

  if (!parsed) {
    issues.push({
      level: 'error',
      message: `No entiendo el acorde "${id}". Se escribe con la nota en mayúscula y el tipo: C, Am, G7, F#m7, Bbmaj7.`,
    });
    return issues;
  }

  if (frets.length !== 4 || frets.some((f) => !Number.isInteger(f) || f < 0 || f > 12)) {
    issues.push({ level: 'error', message: 'Los cuatro trastes tienen que ser números enteros entre 0 y 12.' });
    return issues;
  }

  const suenan = new Set(fingeringPitchClasses(frets));
  const faltan = parsed.pitchClasses.filter((pc) => !suenan.has(pc));
  if (faltan.length) {
    issues.push({
      level: 'error',
      message: `Con esa digitación no suena ${faltan.map(pcName).join(' ni ')}, que ${faltan.length > 1 ? 'son notas' : 'es una nota'} de ${id}. Revisá los trastes.`,
    });
  }

  const sobran = [...suenan].filter((pc) => !parsed.pitchClasses.includes(pc));
  if (sobran.length) {
    issues.push({
      level: 'warn',
      message: `La digitación suma ${sobran.map(pcName).join(' y ')}, que no ${sobran.length > 1 ? 'pertenecen' : 'pertenece'} a ${id}. Puede ser a propósito, pero suele ser un traste mal puesto.`,
    });
  }

  const maxFret = Math.max(...frets);
  if (maxFret > 4) {
    issues.push({
      level: 'warn',
      message: `Este acorde va hasta el traste ${maxFret}. Se dibuja bien, pero para alguien que arranca conviene una posición más cerca de la cejuela.`,
    });
  }

  return issues;
}

/** Sugiere los dedos: numera de a uno los trastes pisados, del más grave al más agudo. */
export function suggestFingers(frets: number[]): number[] {
  const pressed = frets
    .map((f, i) => ({ f, i }))
    .filter((x) => x.f > 0)
    .sort((a, b) => a.f - b.f || a.i - b.i);
  const out = [0, 0, 0, 0];
  pressed.forEach((x, n) => {
    out[x.i] = Math.min(4, n + 1);
  });
  return out;
}
