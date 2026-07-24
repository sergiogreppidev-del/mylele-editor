/* ===================================================================
   MyLele Editor · Formato de chart — fuente de verdad
   Los tiempos van SIEMPRE en beats (nunca en segundos).
     t   = beat de inicio (0 = primer tiempo del compás 1)
     dur = duración en beats
   Modo 'chords' → {t, chord, dur, dir}
   Modo 'melody' → {t, string, fret, dur}   ← TABLATURA, no el nombre de la nota.
     La app de alumnos calcula la nota sola con fretToNoteName (config.js)
     y dibuja el número de traste dentro del círculo.
   =================================================================== */

export type ChartMode = 'chords' | 'melody';
export type StrumDir = 'd' | 'u';
export type UkeString = 'G' | 'C' | 'E' | 'A';

/** Carriles de arriba hacia abajo en la pista del juego. */
export const UKE_STRINGS: UkeString[] = ['G', 'C', 'E', 'A'];
export const MAX_FRET = 12;
export const BPM_MIN = 40;
export const BPM_MAX = 200;

export interface ChordEvent {
  t: number;
  chord: string;
  dur: number;
  dir: StrumDir;
}
export interface MelodyEvent {
  t: number;
  string: UkeString;
  fret: number;
  dur: number;
}
export type ChartEvent = ChordEvent | MelodyEvent;

export function isChordEvent(e: ChartEvent): e is ChordEvent {
  return (e as ChordEvent).chord !== undefined;
}

export interface Song {
  id?: string;
  slug: string;
  title: string;
  artist: string | null;
  level: number;
  bpm: number;
  time_sig: string;
  tuning: string;
  audio_path: string | null;
  is_free: boolean;
  duration_s: number | null;
}

export interface Chart {
  id?: string;
  song_id: string;
  mode: ChartMode;
  version: number;
  events: ChartEvent[];
  published: boolean;
}

/* ---------------- Compases y beats ---------------- */

/** "4/4" → 4 beats por compás. El numerador es la cantidad de pulsos. */
export function beatsPerBar(timeSig: string): number {
  const n = Number(String(timeSig).split('/')[0]);
  return Number.isFinite(n) && n >= 1 && n <= 16 ? n : 4;
}

/** Último beat ocupado por el chart (donde termina el nivel). */
export function chartLengthBeats(events: ChartEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.t + e.dur), 0);
}

/** Cantidad de compases a dibujar: los que ocupa el chart, con un mínimo. */
export function barCount(events: ChartEvent[], timeSig: string, minBars = 4): number {
  const bpb = beatsPerBar(timeSig);
  return Math.max(minBars, Math.ceil(chartLengthBeats(events) / bpb) || minBars);
}

/** Redondeo a la subdivisión elegida (1 = negra, 0.5 = corchea, 0.25 = semicorchea). */
export function snap(beat: number, step: number): number {
  return Math.round(beat / step) * step;
}

/** Evita el 0.30000000000000004 de los flotantes al guardar. */
export function tidy(beat: number): number {
  return Math.round(beat * 1000) / 1000;
}

/* ---------------- Patrones de rasgueo ---------------- */

export type StrumPattern = 'todo-abajo' | 'alternado' | 'island';

/** Devuelve la dirección que le toca a un evento según el patrón y su posición en el compás. */
export function dirForBeat(pattern: StrumPattern, beatInBar: number): StrumDir {
  switch (pattern) {
    case 'todo-abajo':
      return 'd';
    case 'alternado':
      // Tiempo entero ↓, contratiempo ↑
      return Math.abs(beatInBar % 1) < 0.001 ? 'd' : 'u';
    case 'island': {
      // Island strum clásico: D – DU – UDU sobre 4 tiempos (corcheas)
      const eighth = Math.round(beatInBar * 2) % 8; // 0..7
      const map: Record<number, StrumDir | null> = {
        0: 'd', 1: null, 2: 'd', 3: 'u', 4: null, 5: 'u', 6: 'd', 7: 'u',
      };
      return map[eighth] ?? 'd';
    }
  }
}

/* ---------------- Validación ---------------- */

export interface Issue {
  level: 'error' | 'warn';
  message: string;
}

/**
 * Valida el chart entero. Los `error` bloquean publicar; los `warn` solo avisan.
 * Un chart inválido rompe el juego del alumno, así que esto no es opcional.
 */
export function validateChart(
  events: ChartEvent[],
  mode: ChartMode,
  opts: { knownChords: string[]; timeSig: string },
): Issue[] {
  const issues: Issue[] = [];
  const chordSet = new Set(opts.knownChords);

  if (events.length === 0) {
    issues.push({ level: 'error', message: 'El nivel no tiene ningún evento.' });
    return issues;
  }

  events.forEach((e, i) => {
    const ref = `evento ${i + 1} (beat ${e.t})`;
    if (!Number.isFinite(e.t) || e.t < 0) {
      issues.push({ level: 'error', message: `${ref}: el beat de inicio no puede ser negativo.` });
    }
    if (!Number.isFinite(e.dur) || e.dur <= 0) {
      issues.push({ level: 'error', message: `${ref}: la duración tiene que ser mayor a cero.` });
    }

    if (isChordEvent(e)) {
      if (mode !== 'chords') {
        issues.push({ level: 'error', message: `${ref}: es un acorde dentro de un nivel de notas.` });
      }
      if (!chordSet.has(e.chord)) {
        issues.push({
          level: 'error',
          message: `${ref}: el acorde "${e.chord}" no existe en la tabla de acordes — la app no lo dibuja ni lo detecta.`,
        });
      }
      if (e.dir !== 'd' && e.dir !== 'u') {
        issues.push({ level: 'error', message: `${ref}: dirección de rasgueo inválida.` });
      }
    } else {
      if (mode !== 'melody') {
        issues.push({ level: 'error', message: `${ref}: es una nota dentro de un nivel de acordes.` });
      }
      if (!UKE_STRINGS.includes(e.string)) {
        issues.push({ level: 'error', message: `${ref}: cuerda "${e.string}" inválida (van G, C, E o A).` });
      }
      if (!Number.isInteger(e.fret) || e.fret < 0 || e.fret > MAX_FRET) {
        issues.push({ level: 'error', message: `${ref}: traste ${e.fret} fuera de rango (0 a ${MAX_FRET}).` });
      }
    }
  });

  // Solapamientos. En acordes no puede haber dos sonando a la vez; en notas sí,
  // siempre que sean de cuerdas distintas (eso es un arpegio).
  const groups = new Map<string, ChartEvent[]>();
  for (const e of events) {
    const key = isChordEvent(e) ? 'chords' : e.string;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.t + prev.dur > cur.t + 0.001) {
        const where = key === 'chords' ? '' : ` en la cuerda ${key}`;
        issues.push({
          level: 'error',
          message: `Se superponen dos eventos${where}: uno arranca en el beat ${cur.t} y el anterior todavía no terminó.`,
        });
      }
    }
  }

  // Avisos: el nivel no cierra en un compás entero.
  const bpb = beatsPerBar(opts.timeSig);
  const len = chartLengthBeats(events);
  if (Math.abs(len % bpb) > 0.001) {
    issues.push({
      level: 'warn',
      message: `El nivel termina a mitad de compás (dura ${tidy(len)} beats y el compás es de ${bpb}).`,
    });
  }

  return issues;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSong(song: Song): Issue[] {
  const issues: Issue[] = [];
  if (!song.title.trim()) issues.push({ level: 'error', message: 'Falta el título del nivel.' });
  if (!SLUG_RE.test(song.slug)) {
    issues.push({
      level: 'error',
      message: 'El identificador (slug) solo admite minúsculas, números y guiones. Ej: nivel-5-vals.',
    });
  }
  if (!Number.isFinite(song.bpm) || song.bpm < BPM_MIN || song.bpm > BPM_MAX) {
    issues.push({ level: 'error', message: `El BPM tiene que estar entre ${BPM_MIN} y ${BPM_MAX}.` });
  }
  if (!Number.isInteger(song.level) || song.level < 1) {
    issues.push({ level: 'error', message: 'El número de nivel tiene que ser 1 o más.' });
  }
  if (!/^\d+\/\d+$/.test(song.time_sig)) {
    issues.push({ level: 'error', message: 'El compás se escribe como 4/4 o 3/4.' });
  }
  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/* ---------------- Serialización ---------------- */

/** Ordena por beat y deja solo las claves que la app de alumnos entiende. */
export function serializeEvents(events: ChartEvent[]): ChartEvent[] {
  return [...events]
    .sort((a, b) => a.t - b.t)
    .map((e) =>
      isChordEvent(e)
        ? ({ t: tidy(e.t), chord: e.chord, dur: tidy(e.dur), dir: e.dir } as ChordEvent)
        : ({ t: tidy(e.t), string: e.string, fret: e.fret, dur: tidy(e.dur) } as MelodyEvent),
    );
}

/** Lee lo que hay en la base, tolerando charts viejos sin `dir`. */
export function parseEvents(raw: unknown): ChartEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartEvent[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const t = Number(r.t) || 0;
    const dur = Number(r.dur) || 1;
    if (typeof r.chord === 'string') {
      out.push({ t, chord: r.chord, dur, dir: r.dir === 'u' ? 'u' : 'd' });
    } else if (typeof r.string === 'string') {
      out.push({ t, string: r.string as UkeString, fret: Number(r.fret) || 0, dur });
    }
    // Los charts viejos con {note:'C'} no se importan: el editor trabaja en
    // tablatura (cuerda + traste) y no hay forma de deducir el traste desde la nota.
  }
  return out;
}
