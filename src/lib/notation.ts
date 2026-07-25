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

import type { BackingEvent, ChordEvent, Issue, MelodyEvent, UkeString, Voice } from './chartFormat';
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

  // El fondo es polifónico: varias notas a la vez son un acorde, no un error.
  // Lo único que se avisa es un amontonamiento absurdo, que suele ser un pegado
  // duplicado por accidente y suena a barro.
  const porTiempo = new Map<number, number>();
  for (const e of events) {
    const k = Math.round(e.t * 1000);
    porTiempo.set(k, (porTiempo.get(k) ?? 0) + 1);
  }
  const maxJuntas = Math.max(0, ...porTiempo.values());
  if (maxJuntas > 6) {
    issues.push({
      level: 'warn',
      message: `Hay ${maxJuntas} notas de fondo sonando exactamente juntas. Es mucho: fijate que no se haya pegado dos veces lo mismo.`,
    });
  }
  return issues;
}

/* ---------------- Parser ---------------- */

export type NotationTarget = 'chords' | 'melody' | 'backing';

/** Lo que la IA propone para el nivel, leído de la cabecera de su respuesta. */
export interface SuggestedSetup {
  bpm?: number;
  timeSig?: string;
  /** Tiempos antes del primer compás completo, deducidos del primer compás corto. */
  pickup?: number;
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
  /** Normalmente una sola. Varias cuando el token es "[C3,E3,G3]" (notas simultáneas). */
  names: string[];
  poly: boolean;
  dur: number;
  dir?: 'd' | 'u';
}

const REST_NAMES = new Set(['r', 'R', '-', '_']);
const esSilencio = (tk: { names: string[]; poly: boolean }) =>
  !tk.poly && tk.names.length === 1 && REST_NAMES.has(tk.names[0]);

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

export interface ParseOptions {
  target: NotationTarget;
  beatsPerBar: number;
  knownChords: string[];
  autoTranspose?: boolean;
}

const SECCION_RE = /^\s*(fondo|backing|bajo|bass|acomp|acompa[nñ]amiento|melod[ií]a|melody|acordes|chords)\s*:\s*(.*)$/i;

/**
 * Cada sección va a una capa y, si es del acompañamiento, con qué rol suena.
 * Los roles existen para que la mezcla no trate a todas las notas por igual:
 * la melodía tiene que destacarse por encima del bajo y del relleno.
 */
const SECCION_DEST: Record<string, { target: NotationTarget; voice?: Voice }> = {
  melodia: { target: 'melody' }, 'melodía': { target: 'melody' }, melody: { target: 'melody' },
  bajo: { target: 'backing', voice: 'bass' }, bass: { target: 'backing', voice: 'bass' },
  acomp: { target: 'backing', voice: 'acomp' },
  acompanamiento: { target: 'backing', voice: 'acomp' },
  'acompañamiento': { target: 'backing', voice: 'acomp' },
  fondo: { target: 'backing', voice: 'acomp' }, backing: { target: 'backing', voice: 'acomp' },
  acordes: { target: 'chords' }, chords: { target: 'chords' },
};
const SECCION_LABEL: Record<NotationTarget, string> = {
  chords: 'Acordes',
  melody: 'Melodía',
  backing: 'Fondo',
};

/**
 * Reparte el texto en capas. Un nivel entero se pega de una sola vez así:
 *
 *   BPM: 100
 *   COMPAS: 4/4
 *   FONDO:   | [C3,E3,G3]/4 | ...
 *   MELODIA: | C4/1 C4/1 G4/1 G4/1 | ...
 *   ACORDES: | C/4 | F/2 C/2 |
 *
 * Sin encabezados de sección, todo el texto es una sola capa —la del `target`
 * que pidió quien llama—, que es como funcionaba antes.
 */
interface Seccion {
  target: NotationTarget;
  voice?: Voice;
  body: string[];
}

function splitSections(
  text: string,
  target: NotationTarget,
): { target: NotationTarget; voice?: Voice; body: string }[] {
  const out: Seccion[] = [];
  let actual: Seccion | null = null;

  for (const line of text.split('\n')) {
    const m = SECCION_RE.exec(line);
    if (m) {
      const dest = SECCION_DEST[m[1].toLowerCase()];
      actual = { target: dest.target, voice: dest.voice, body: m[2] ? [m[2]] : [] };
      out.push(actual);
    } else if (actual) {
      actual.body.push(line);
    } else if (line.trim()) {
      // Texto suelto antes de cualquier sección: es la capa que se pidió.
      actual = { target, body: [line] };
      out.push(actual);
    }
  }
  return out.map((s) => ({ target: s.target, voice: s.voice, body: s.body.join('\n') }));
}

const NOMBRES_SECCION = Object.keys(SECCION_DEST);

/**
 * Cuando una IA se queda sin espacio, la respuesta no termina prolija: se corta a
 * la mitad del nombre de la capa que venía después ("... [C3,E3,G3]/2 | ACORD").
 *
 * Ese pedazo suelto hacía un desastre desproporcionado. Se leía como si fuera una
 * nota ('"ACORD" no es una nota') y, peor, hacía que el último compás dejara de
 * ser el último y perdiera el permiso de terminar corto ('el compás 9 suma 2 y
 * tiene que sumar 3'). Dos errores desconcertantes para una sola causa, y ninguno
 * de los dos nombraba la causa. Así que se detecta y se dice lo que pasó.
 */
function recortarColaTruncada(text: string, knownChords: string[]): { text: string; issue?: Issue } {
  const m = /(?:\s|^)([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})\s*$/.exec(text);
  if (!m) return { text };

  const frag = m[1];
  // Podría ser música legítima: una nota (Bb5), o un acorde de nombre largo.
  if (pitchToMidi(frag) !== null || knownChords.includes(frag)) return { text };
  if (!NOMBRES_SECCION.some((n) => n.startsWith(frag.toLowerCase()))) return { text };

  return {
    text: text.slice(0, m.index),
    issue: {
      level: 'error',
      message: `La respuesta se cortó antes de terminar: queda un "${frag}" suelto al final, que es el principio de una capa que nunca llegó. Volvé a generarla — el resto de lo que llegó está bien.`,
    },
  };
}

/** Convierte el texto en eventos con sus tiempos ya calculados. */
export function parseNotation(text: string, opts: ParseOptions): ParsedNotation {
  // La cabecera se saca primero: si la IA declaró el compás, los compases se
  // verifican contra ESE, no contra el que tenga puesto el nivel.
  const { rest: crudo, suggested } = extractHeader(stripComments(text));
  const { text: rest, issue: corte } = recortarColaTruncada(crudo, opts.knownChords);
  const beatsPerBarUsed = suggested.timeSig
    ? Number(suggested.timeSig.split('/')[0]) || opts.beatsPerBar
    : opts.beatsPerBar;

  const vacio: ParsedNotation = {
    chordEvents: [], melodyEvents: [], backingEvents: [],
    // El aviso del corte va primero: es la causa de todo lo que venga detrás.
    issues: corte ? [corte] : [],
    appliedShift: 0, totalBeats: 0, suggested, beatsPerBarUsed,
  };

  const secciones = splitSections(rest, opts.target);
  if (secciones.length === 0) return vacio;

  // Cada capa se analiza por separado y después se juntan los resultados. Con
  // varias capas, los avisos se etiquetan para saber cuál de las tres falló.
  return secciones.reduce<ParsedNotation>((acc, s) => {
    const r = parseLayer(s.body, { ...opts, target: s.target }, beatsPerBarUsed, s.voice);
    const etiqueta = secciones.length > 1 ? SECCION_LABEL[s.target] + ' · ' : '';
    return {
      ...acc,
      chordEvents: [...acc.chordEvents, ...r.chordEvents],
      melodyEvents: [...acc.melodyEvents, ...r.melodyEvents],
      backingEvents: [...acc.backingEvents, ...r.backingEvents],
      issues: [...acc.issues, ...r.issues.map((i) => ({ ...i, message: etiqueta + i.message }))],
      appliedShift: r.appliedShift || acc.appliedShift,
      totalBeats: Math.max(acc.totalBeats, r.totalBeats),
      // Todas las capas comparten la anacrusa: alcanza con que una la declare.
      suggested: { ...acc.suggested, ...(r.suggested.pickup ? { pickup: r.suggested.pickup } : {}) },
    };
  }, vacio);
}

/** Analiza UNA capa. La cabecera ya viene sacada y el compás ya está resuelto. */
function parseLayer(
  text: string,
  opts: ParseOptions,
  beatsPerBarUsed: number,
  voice: Voice = 'acomp',
): ParsedNotation {
  const issues: Issue[] = [];
  const chordEvents: ChordEvent[] = [];
  const melodyEvents: MelodyEvent[] = [];
  const backingEvents: BackingEvent[] = [];
  const suggested: SuggestedSetup = {};

  const clean = text.trim();
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

  // Los compases se juzgan al final, cuando ya se sabe cuál es el último: solo el
  // primero (anacrusa) y el último (final incompleto) pueden quedar cortos.
  const barSums: number[] = [];
  let pickupDetectado = 0;
  const closeBar = () => {
    if (!seenAnyToken) return; // un "|" al principio no abre compás
    if (barSum === 0) return; // "|" al final o dos seguidas: no es un compás vacío
    barIndex++;
    barSums.push(barSum);
    barSum = 0;
  };

  for (const piece of pieces) {
    if (piece === '|' || piece === '||') {
      closeBar();
      continue;
    }

    const { names, poly, dur: durPart, dir: dirPart } = splitToken(piece);
    if (names.length === 0) {
      issues.push({ level: 'error', message: `No entiendo "${piece}".` });
      continue;
    }
    if (poly && opts.target !== 'backing') {
      issues.push({
        level: 'error',
        message:
          opts.target === 'chords'
            ? `"${piece}": los corchetes son para notas simultáneas del fondo. Un acorde se escribe por su nombre, como C/4.`
            : `"${piece}": el alumno toca una nota por vez. Si querés que suenen varias juntas, va en la capa de fondo o como acorde.`,
      });
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

    tokens.push({ raw: piece, names, poly, dur, dir });
    barSum += dur;
    seenAnyToken = true;
  }
  closeBar();

  // --- 1b) Juzgar los compases ---
  // Un compás que no suma corre TODO lo que viene después, y la canción se escucha
  // desfasada aunque las notas sean las correctas. Por eso ahora bloquea en vez de
  // solo avisar: la única excepción son los extremos, que sí pueden ser cortos.
  barSums.forEach((sum, i) => {
    if (Math.abs(sum - beatsPerBarUsed) <= 0.001) return;
    const esPrimero = i === 0;
    const esUltimo = i === barSums.length - 1;
    const corto = sum < beatsPerBarUsed;

    if (corto && esPrimero) {
      // El primer compás corto ES la anacrusa: se guarda para que las barras y el
      // acento del metrónomo caigan donde corresponde en vez de cada N desde cero.
      pickupDetectado = tidy(sum);
      issues.push({
        level: 'warn',
        message: `Arranca con una anacrusa de ${tidy(sum)} de ${beatsPerBarUsed} tiempos (el primer tiempo fuerte cae después). Si no era la intención, revisá el primer compás.`,
      });
    } else if (corto && esUltimo) {
      issues.push({
        level: 'warn',
        message: `El último compás suma ${tidy(sum)} de ${beatsPerBarUsed} tiempos. Si la canción termina antes de completarlo está bien.`,
      });
    } else {
      issues.push({
        level: 'error',
        message: `El compás ${i + 1} suma ${tidy(sum)} tiempos y tiene que sumar ${beatsPerBarUsed}. ${
          corto ? 'Le falta' : 'Le sobra'
        } ${tidy(Math.abs(sum - beatsPerBarUsed))}, y eso corre de lugar todo lo que viene después.`,
      });
    }
  });

  // --- 2) Resolver alturas y decidir si hay que transponer ---
  let appliedShift = 0;
  if (opts.target !== 'chords') {
    const midis: number[] = [];
    for (const tk of tokens) {
      if (esSilencio(tk)) continue;
      for (const name of tk.names) {
        const midi = pitchToMidi(name);
        if (midi === null) {
          issues.push({
            level: 'error',
            message: `"${tk.raw}" no es una nota. Se escribe nota + octava, por ejemplo G4, A#3 o Bb5. Para un silencio, r.`,
          });
          continue;
        }
        midis.push(midi);
      }
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
    const isRest = esSilencio(tk);

    if (opts.target === 'chords') {
      if (!isRest) {
        const nombre = tk.names[0];
        if (!chordSet.has(nombre)) {
          issues.push({
            level: 'error',
            message: `El acorde "${nombre}" no existe en tu tabla de acordes. Disponibles: ${opts.knownChords.join(', ') || '(ninguno)'}.`,
          });
        } else {
          chordEvents.push({ t: tidy(t), chord: nombre, dur: tidy(tk.dur), dir: tk.dir ?? 'd' });
        }
      }
    } else if (!isRest) {
      // Un token puede traer varias notas: todas arrancan en el mismo tiempo.
      for (const name of tk.names) {
        const base = pitchToMidi(name);
        if (base === null) continue; // ya se avisó al resolver las alturas
        const midi = base + appliedShift;
        if (opts.target === 'backing') {
          backingEvents.push({ t: tidy(t), pitch: midiToPitch(midi), dur: tidy(tk.dur), v: voice });
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
    appliedShift, totalBeats: tidy(t),
    suggested: pickupDetectado > 0 ? { pickup: pickupDetectado } : {},
    beatsPerBarUsed,
  };
}

/** Separa "G#4/.5:u" o "[C3,E3,G3]/2" en nombre(s), duración y dirección. */
function splitToken(piece: string): {
  names: string[];
  poly: boolean;
  dur?: string;
  dir?: string;
} {
  const colon = piece.indexOf(':');
  const dir = colon === -1 ? undefined : piece.slice(colon + 1);
  const rest = colon === -1 ? piece : piece.slice(0, colon);
  // Los corchetes no contienen "/", así que la primera barra siempre separa la duración.
  const slash = rest.indexOf('/');
  const namePart = slash === -1 ? rest : rest.slice(0, slash);
  const dur = slash === -1 ? undefined : rest.slice(slash + 1);

  if (namePart.startsWith('[') && namePart.endsWith(']')) {
    const names = namePart
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { names, poly: true, dur, dir };
  }
  return { names: namePart ? [namePart] : [], poly: false, dur, dir };
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
