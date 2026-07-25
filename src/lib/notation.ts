/* ===================================================================
   MyLele · Notación de texto (MLN)
   Formato compacto y SECUENCIAL para escribir melodías y progresiones,
   pensado para que una IA lo genere sin equivocarse.

   La clave: quien escribe solo dice QUÉ suena y CUÁNTO dura.
   El beat de inicio (`t`) lo calcula este módulo sumando duraciones,
   así nunca se desfasa — que es el error típico cuando se le pide a una
   IA el JSON con los tiempos absolutos ya resueltos.

     notas    G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1
     acordes  | C/4 | Am/4 | F/2 G/2 | C/4

   `|` separa compases y sirve de red de seguridad: si un compás no suma
   los tiempos que debería, se avisa con el número exacto de compás.
   `r` es silencio (avanza el tiempo, no genera evento).
   La duración es opcional y por defecto vale 1 tiempo.
   =================================================================== */

import type { BackingEvent, ChordEvent, Issue, MelodyEvent, UkeString } from './chartFormat';
import { MAX_FRET, tidy } from './chartFormat';

/* ---------------- Alturas ---------------- */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Nota que produce cada cuerda al aire, en MIDI (G reentrante = agudo). */
export const STRING_MIDI: Record<UkeString, number> = { G: 67, C: 60, E: 64, A: 69 };

/** Rango realmente tocable en un ukelele GCEA con 12 trastes: C4 … A5. */
export const MIN_PLAYABLE_MIDI = 60; // C4, la cuerda C al aire
export const MAX_PLAYABLE_MIDI = 81; // A5, cuerda A en el traste 12

const PITCH_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;

/** "G4" · "A#3" · "Bb5" → número MIDI. Devuelve null si no es una altura válida. */
export function pitchToMidi(text: string): number | null {
  const m = PITCH_RE.exec(text.trim());
  if (!m) return null;
  const pc = LETTER_PC[m[1].toUpperCase()];
  if (pc === undefined) return null;
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + pc + alter;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** 67 → "G4". Siempre escribe sostenidos, nunca bemoles. */
export function midiToPitch(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[pc] + octave;
}

/** Solo el nombre de la nota, sin octava — que es lo que detecta el motor de audio. */
export function midiToNoteName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

/* ---------------- Nota → cuerda y traste ---------------- */

// Se prefiere el traste más bajo (más fácil de tocar). El orden de cuerdas solo
// desempata: la G es reentrante (aguda), así que va última para que una melodía
// no salte a ella sin necesidad.
const STRING_PREFERENCE: UkeString[] = ['A', 'E', 'C', 'G'];

export interface Tab {
  string: UkeString;
  fret: number;
}

/** Busca la digitación más cómoda para una altura. null si no entra en el ukelele. */
export function midiToTab(midi: number): Tab | null {
  let best: Tab | null = null;
  for (const s of STRING_PREFERENCE) {
    const fret = midi - STRING_MIDI[s];
    if (fret < 0 || fret > MAX_FRET) continue;
    if (!best || fret < best.fret) best = { string: s, fret };
  }
  return best;
}

/**
 * Busca cuántas octavas hay que mover una melodía para que entre en el ukelele.
 * Devuelve el desplazamiento en semitonos, o null si no entra de ninguna manera
 * (por ejemplo, si la melodía abarca más de dos octavas y media).
 */
export function octaveShiftToFit(midis: number[]): number | null {
  if (midis.length === 0) return 0;
  for (const shift of [0, 12, -12, 24, -24]) {
    if (midis.every((m) => m + shift >= MIN_PLAYABLE_MIDI && m + shift <= MAX_PLAYABLE_MIDI)) {
      return shift;
    }
  }
  return null;
}

/* ---------------- Validación del fondo ---------------- */

/** El fondo lo sintetiza la app, así que valida alturas, no digitaciones. */
export function validateBacking(events: BackingEvent[]): Issue[] {
  const issues: Issue[] = [];
  events.forEach((e, i) => {
    const ref = `nota ${i + 1} del fondo (beat ${e.t})`;
    if (!Number.isFinite(e.t) || e.t < 0) {
      issues.push({ level: 'error', message: `${ref}: el beat de inicio no puede ser negativo.` });
    }
    if (!Number.isFinite(e.dur) || e.dur <= 0) {
      issues.push({ level: 'error', message: `${ref}: la duración tiene que ser mayor a cero.` });
    }
    if (pitchToMidi(e.pitch) === null) {
      issues.push({ level: 'error', message: `${ref}: "${e.pitch}" no es una altura válida (se escribe como G4 o A#3).` });
    }
  });

  // El fondo es de una sola voz: si se pisan, la segunda tapa a la primera.
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].t + sorted[i - 1].dur > sorted[i].t + 0.001) {
      issues.push({
        level: 'warn',
        message: `En el fondo se superponen dos notas alrededor del beat ${tidy(sorted[i].t)}. Van a sonar juntas.`,
      });
      break; // con avisar una vez alcanza
    }
  }
  return issues;
}

/* ---------------- Parser ---------------- */

export type NotationTarget = 'chords' | 'melody' | 'backing';

/** Lo que la IA propone para el nivel, leído de la cabecera de su respuesta. */
export interface SuggestedSetup {
  bpm?: number;
  timeSig?: string;
}

export interface ParsedNotation {
  chordEvents: ChordEvent[];
  melodyEvents: MelodyEvent[];
  backingEvents: BackingEvent[];
  issues: Issue[];
  /** Semitonos que se aplicaron para que la melodía entrara en el ukelele. */
  appliedShift: number;
  totalBeats: number;
  /** Compás y tempo propuestos por quien escribió la notación (si los declaró). */
  suggested: SuggestedSetup;
  /** Tiempos por compás que se usaron para verificar: los propuestos si los hay. */
  beatsPerBarUsed: number;
}

const HEADER_RE = /^\s*(bpm|tempo|comp[aá]s|compas)\s*[:=]\s*(.+?)\s*$/i;

/**
 * Saca de la respuesta las líneas tipo "BPM: 120" o "COMPAS: 3/4".
 * Es la forma de que la IA diga qué medida le corresponde a la canción, en vez de
 * que se la impongamos nosotros sin saberla.
 */
function extractHeader(text: string): { rest: string; suggested: SuggestedSetup } {
  const suggested: SuggestedSetup = {};
  const kept: string[] = [];

  for (const line of text.split('\n')) {
    const m = HEADER_RE.exec(line);
    if (!m) {
      kept.push(line);
      continue;
    }
    const clave = m[1].toLowerCase();
    const valor = m[2].trim();
    if (clave === 'bpm' || clave === 'tempo') {
      const n = parseFloat(valor);
      if (Number.isFinite(n)) suggested.bpm = Math.round(n);
    } else {
      const ts = /^(\d+)\s*\/\s*(\d+)$/.exec(valor);
      if (ts) suggested.timeSig = `${ts[1]}/${ts[2]}`;
    }
  }
  return { rest: kept.join('\n'), suggested };
}

interface Token {
  raw: string;
  name: string;
  dur: number;
  dir?: 'd' | 'u';
}

const REST_NAMES = new Set(['r', 'R', '-', '_']);

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/**
 * Convierte el texto en eventos con sus tiempos ya calculados.
 * `autoTranspose` mueve la melodía por octavas si no entra en el ukelele
 * (solo aplica al modo melody: el fondo puede sonar en cualquier octava).
 */
export function parseNotation(
  text: string,
  opts: {
    target: NotationTarget;
    beatsPerBar: number;
    knownChords: string[];
    autoTranspose?: boolean;
  },
): ParsedNotation {
  const issues: Issue[] = [];
  const chordEvents: ChordEvent[] = [];
  const melodyEvents: MelodyEvent[] = [];
  const backingEvents: BackingEvent[] = [];

  // La cabecera se saca primero: si la IA declaró el compás, los compases se
  // verifican contra ESE, no contra el que tenga puesto el nivel. Si no, cada
  // compás daría un aviso falso solo porque la canción está en 3/4 y el nivel en 4/4.
  const { rest, suggested } = extractHeader(stripComments(text));
  const beatsPerBarUsed = suggested.timeSig
    ? Number(suggested.timeSig.split('/')[0]) || opts.beatsPerBar
    : opts.beatsPerBar;

  const clean = rest.trim();
  if (!clean) {
    return {
      chordEvents, melodyEvents, backingEvents, issues,
      appliedShift: 0, totalBeats: 0, suggested, beatsPerBarUsed,
    };
  }

  const pieces = clean.split(/\s+/).filter(Boolean);
  const chordSet = new Set(opts.knownChords);

  // --- 1) Tokenizar, verificando compases sobre la marcha ---
  const tokens: Token[] = [];
  let barIndex = 0;
  let barSum = 0;
  let seenAnyToken = false;

  const closeBar = () => {
    if (!seenAnyToken) return; // un "|" al principio no abre compás
    if (barSum === 0) return; // "|" al final o dos seguidas: no es un compás vacío
    barIndex++;
    if (Math.abs(barSum - beatsPerBarUsed) > 0.001) {
      // El primer compás corto es una anacrusa legítima (arranque en alzada).
      const esAnacrusa = barIndex === 1 && barSum < beatsPerBarUsed;
      issues.push({
        level: 'warn',
        message: esAnacrusa
          ? `El compás 1 suma ${tidy(barSum)} de ${beatsPerBarUsed} tiempos. Si es una anacrusa (arranque en alzada) está bien; si no, revisalo.`
          : `El compás ${barIndex} suma ${tidy(barSum)} tiempos y debería sumar ${beatsPerBarUsed}.`,
      });
    }
    barSum = 0;
  };

  for (const piece of pieces) {
    if (piece === '|' || piece === '||') {
      closeBar();
      continue;
    }

    const [namePart, durPart, dirPart] = splitToken(piece);
    if (!namePart) {
      issues.push({ level: 'error', message: `No entiendo "${piece}".` });
      continue;
    }

    let dur = 1;
    if (durPart !== undefined) {
      const parsed = Number(durPart);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        issues.push({
          level: 'error',
          message: `En "${piece}" la duración "${durPart}" no es un número de tiempos válido.`,
        });
        continue;
      }
      dur = parsed;
    }

    let dir: 'd' | 'u' | undefined;
    if (dirPart !== undefined) {
      const d = dirPart.toLowerCase();
      if (d !== 'd' && d !== 'u') {
        issues.push({
          level: 'error',
          message: `En "${piece}" la dirección "${dirPart}" no vale: usá :d (abajo) o :u (arriba).`,
        });
        continue;
      }
      dir = d;
    }

    tokens.push({ raw: piece, name: namePart, dur, dir });
    barSum += dur;
    seenAnyToken = true;
  }
  closeBar();

  // --- 2) Resolver alturas y decidir si hay que transponer ---
  let appliedShift = 0;
  if (opts.target !== 'chords') {
    const midis: number[] = [];
    for (const tk of tokens) {
      if (REST_NAMES.has(tk.name)) continue;
      const midi = pitchToMidi(tk.name);
      if (midi === null) {
        issues.push({
          level: 'error',
          message: `"${tk.raw}" no es una nota. Se escribe nota + octava, por ejemplo G4, A#3 o Bb5. Para un silencio, r.`,
        });
        continue;
      }
      midis.push(midi);
    }

    if (opts.target === 'melody' && midis.length > 0) {
      const fits = midis.every((m) => m >= MIN_PLAYABLE_MIDI && m <= MAX_PLAYABLE_MIDI);
      if (!fits) {
        const shift = opts.autoTranspose ? octaveShiftToFit(midis) : null;
        if (shift !== null && shift !== 0) {
          appliedShift = shift;
          issues.push({
            level: 'warn',
            message: `La melodía no entraba en el ukelele, así que se movió ${Math.abs(shift) / 12} octava${Math.abs(shift) > 12 ? 's' : ''} ${shift > 0 ? 'hacia arriba' : 'hacia abajo'}. Suena igual, más ${shift > 0 ? 'aguda' : 'grave'}.`,
          });
        } else if (shift === null && opts.autoTranspose) {
          issues.push({
            level: 'error',
            message: `La melodía no entra en un ukelele ni moviéndola de octava: abarca de ${midiToPitch(Math.min(...midis))} a ${midiToPitch(Math.max(...midis))}, y el instrumento va de C4 a A5.`,
          });
        }
      }
    }
  }

  // --- 3) Construir los eventos con el tiempo acumulado ---
  let t = 0;
  for (const tk of tokens) {
    const isRest = REST_NAMES.has(tk.name);

    if (opts.target === 'chords') {
      if (!isRest) {
        if (!chordSet.has(tk.name)) {
          issues.push({
            level: 'error',
            message: `El acorde "${tk.name}" no existe en tu tabla de acordes. Disponibles: ${opts.knownChords.join(', ') || '(ninguno)'}.`,
          });
        } else {
          chordEvents.push({ t: tidy(t), chord: tk.name, dur: tidy(tk.dur), dir: tk.dir ?? 'd' });
        }
      }
    } else if (!isRest) {
      const base = pitchToMidi(tk.name);
      if (base !== null) {
        const midi = base + appliedShift;
        if (opts.target === 'backing') {
          backingEvents.push({ t: tidy(t), pitch: midiToPitch(midi), dur: tidy(tk.dur) });
        } else {
          const tab = midiToTab(midi);
          if (!tab) {
            issues.push({
              level: 'error',
              message: `La nota ${midiToPitch(midi)} no se puede tocar en un ukelele (el rango es C4 a A5).`,
            });
          } else {
            melodyEvents.push({ t: tidy(t), string: tab.string, fret: tab.fret, dur: tidy(tk.dur) });
          }
        }
      }
    }

    t += tk.dur;
  }

  if (tokens.length === 0) {
    issues.push({ level: 'error', message: 'No encontré ninguna nota ni acorde en el texto.' });
  }

  return {
    chordEvents, melodyEvents, backingEvents, issues,
    appliedShift, totalBeats: tidy(t), suggested, beatsPerBarUsed,
  };
}

/** Separa "G#4/.5:u" en sus tres partes. */
function splitToken(piece: string): [string, string | undefined, string | undefined] {
  const colon = piece.indexOf(':');
  const dir = colon === -1 ? undefined : piece.slice(colon + 1);
  const rest = colon === -1 ? piece : piece.slice(0, colon);
  const slash = rest.indexOf('/');
  if (slash === -1) return [rest, undefined, dir];
  return [rest.slice(0, slash), rest.slice(slash + 1), dir];
}

/* ---------------- Serialización (para el camino de vuelta) ---------------- */

function fmtDur(d: number): string {
  const s = String(tidy(d));
  return s.startsWith('0.') ? s.slice(1) : s; // 0.5 → .5
}

/** Convierte eventos de vuelta a texto, para poder pegárselos a una IA y pedirle cambios. */
export function toNotation(
  events: (ChordEvent | MelodyEvent | BackingEvent)[],
  beatsPerBar: number,
): string {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const out: string[] = [];
  let cursor = 0;
  let nextBar = beatsPerBar;

  const bar = () => {
    out.push('|');
    nextBar += beatsPerBar;
  };

  for (const e of sorted) {
    // Los huecos se rellenan con silencios, cortados en cada barra de compás:
    // si no, un silencio largo se come la barra y los compases quedan corridos.
    while (e.t > cursor + 0.001) {
      const stop = Math.min(e.t, nextBar);
      if (stop > cursor + 0.001) {
        out.push(`r/${fmtDur(stop - cursor)}`);
        cursor = stop;
      }
      if (Math.abs(cursor - nextBar) < 0.001) bar();
    }
    if (Math.abs(cursor - nextBar) < 0.001) bar();

    if ('chord' in e) out.push(`${e.chord}/${fmtDur(e.dur)}${e.dir === 'u' ? ':u' : ''}`);
    else if ('pitch' in e) out.push(`${e.pitch}/${fmtDur(e.dur)}`);
    else out.push(`${midiToPitch(STRING_MIDI[e.string] + e.fret)}/${fmtDur(e.dur)}`);

    cursor = e.t + e.dur;
    // Una nota que cruza el compás no se parte: se corre la próxima barra.
    while (cursor > nextBar + 0.001) nextBar += beatsPerBar;
  }
  return out.join(' ');
}
