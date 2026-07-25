/* ===================================================================
   MyLele Editor · Qué chart se edita y de qué tipo es un nivel

   Vive aparte de db.ts a propósito. db.ts habla con Supabase y no se puede
   cargar en las pruebas sin credenciales, así que toda esta lógica quedaba
   sin cubrir — y es exactamente donde se escondieron los dos peores errores
   que tuvimos:

     · agarrar el primer chart de la lista, cuando el orden que devuelve
       PostgREST no está garantizado (la app terminó tocando el fondo en
       vez de los acordes);
     · preguntar siempre por el sub-nivel 'facil', cuando la canción podía
       estar guardada en el otro (el editor mostraba como perdido un chart
       que estaba publicado).

   Acá no hay red: son decisiones sobre datos ya traídos. Por eso se puede
   probar, y por eso están todas juntas.
   =================================================================== */

import { BACKING_MODE } from './chartFormat';
import type { AnyChartMode, ChartMode, Difficulty } from './chartFormat';

/** Lo mínimo que hace falta para elegir. La fila real trae más campos. */
export interface PickableChart {
  mode: AnyChartMode;
  difficulty: Difficulty;
  version: number;
  published: boolean;
}

/** Los charts que toca el alumno. El acompañamiento nunca cuenta como jugable. */
export function playableCharts<T extends PickableChart>(charts: T[]): T[] {
  return charts.filter((c) => c.mode !== BACKING_MODE);
}

/**
 * De un grupo de charts equivalentes, el que manda: primero el publicado,
 * y entre borradores el de versión más alta. Nunca "el primero que venga".
 */
function elMasVigente<T extends PickableChart>(lista: T[]): T | null {
  if (lista.length === 0) return null;
  return (
    lista.find((c) => c.published) ??
    [...lista].sort((a, b) => b.version - a.version)[0]
  );
}

/**
 * El chart jugable del nivel: el que define de qué tipo es y qué sub-nivel tiene.
 * Se elige sin preguntar por dificultad, porque una canción vive en UN sub-nivel:
 * el sub-nivel es la receta con la que se creó, no una variante que se elige después.
 */
export function playableChart<T extends PickableChart>(charts: T[]): T | null {
  return elMasVigente(playableCharts(charts));
}

/** ¿Es un nivel de acordes o de notas? Por defecto acordes, para un nivel vacío. */
export function songMode<T extends PickableChart>(charts: T[]): ChartMode {
  return (playableChart(charts)?.mode as ChartMode) ?? 'chords';
}

/** En qué sub-nivel vive esta canción. Por defecto el primero, para un nivel vacío. */
export function songDifficulty<T extends PickableChart>(charts: T[]): Difficulty {
  return playableChart(charts)?.difficulty ?? 'facil';
}

/** El fondo es el mismo para los dos sub-niveles, así que vive siempre en el primero. */
export function difficultyFor(mode: AnyChartMode, difficulty: Difficulty): Difficulty {
  return mode === BACKING_MODE ? 'facil' : difficulty;
}

function mismos<T extends PickableChart>(charts: T[], mode: AnyChartMode, difficulty: Difficulty): T[] {
  const dif = difficultyFor(mode, difficulty);
  return charts.filter((c) => c.mode === mode && c.difficulty === dif);
}

/** El chart que se está editando: el borrador si existe, si no el publicado. */
export function workingChart<T extends PickableChart>(
  charts: T[], mode: AnyChartMode, difficulty: Difficulty,
): T | null {
  const same = mismos(charts, mode, difficulty);
  const borrador = same.filter((c) => !c.published).sort((a, b) => b.version - a.version)[0];
  return borrador ?? same.find((c) => c.published) ?? null;
}

/** El chart que están viendo los alumnos ahora mismo. */
export function publishedChart<T extends PickableChart>(
  charts: T[], mode: AnyChartMode, difficulty: Difficulty,
): T | null {
  return mismos(charts, mode, difficulty).find((c) => c.published) ?? null;
}

/** Un borrador nuevo se guarda por encima de la última versión, sin pisar la publicada. */
export function nextVersion<T extends PickableChart>(
  charts: T[], mode: AnyChartMode, difficulty: Difficulty,
): number {
  return mismos(charts, mode, difficulty).reduce((m, c) => Math.max(m, c.version), 0) + 1;
}

/** El borrador de esa combinación, si ya existe uno que haya que pisar. */
export function draftToOverwrite<T extends PickableChart>(
  charts: T[], mode: AnyChartMode, difficulty: Difficulty,
): T | null {
  return mismos(charts, mode, difficulty)
    .filter((c) => !c.published)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Qué sub-niveles tiene cargados una canción, para mostrarlos en el listado. */
export function difficultiesPresent<T extends PickableChart>(charts: T[]): Difficulty[] {
  const set = new Set(playableCharts(charts).map((c) => c.difficulty));
  return [...set];
}
