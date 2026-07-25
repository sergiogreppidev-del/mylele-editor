/* ===================================================================
   MyLele Editor · Herramientas de estructura (repetir, duplicar compás)

   Vive aparte de la pantalla para poder probarlo. El bug que motivó esto:
   "Repetir todo × 2" copiaba solo la capa que toca el alumno, así que a
   partir de la segunda vuelta el ejercicio quedaba en silencio. El mismo
   defecto tenía "Duplicar compás", que corría los acordes y dejaba el
   acompañamiento donde estaba.

   La regla que ordena todo: una operación de ESTRUCTURA le pasa a la canción
   entera, no a una capa. Y el bloque se mide sobre la capa MÁS LARGA — si se
   midiera solo lo jugable y el fondo fuera más largo, cada vuelta pisaría el
   final de la anterior.
   =================================================================== */

import { tidy } from './chartFormat';

/** Cualquier cosa ubicada en el tiempo: acorde, nota o nota de fondo. */
type Ubicado = { t: number };

/**
 * Cuánto dura el bloque que se repite, redondeado a compases enteros.
 *
 * Se cuenta DESDE la anacrusa: con alzada los compases no empiezan en múltiplos
 * de `bpb`, arrancan corridos. Redondear desde cero dejaba el bloque un pedazo
 * corto y cada repetición entraba a destiempo.
 */
export function bloqueDeRepeticion(largo: number, pickup: number, bpb: number): number {
  if (largo <= pickup) return Math.max(bpb, tidy(largo));
  return tidy(pickup + Math.ceil((largo - pickup) / bpb) * bpb);
}

/** Pega el material N veces seguidas, corriendo cada copia un bloque entero. */
export function repetir<T extends Ubicado>(list: T[], veces: number, bloque: number): T[] {
  if (veces < 2 || list.length === 0) return list;
  const out = [...list];
  for (let k = 1; k < veces; k++) {
    for (const e of list) out.push({ ...e, t: tidy(e.t + bloque * k) });
  }
  return out;
}

/**
 * Copia un compás e inserta la copia justo después, corriendo lo que venga detrás.
 * `desde` es el tiempo en que empieza ese compás (ya con la anacrusa sumada).
 */
export function duplicarCompas<T extends Ubicado>(list: T[], desde: number, bpb: number): T[] {
  const hasta = desde + bpb;
  const corridos = list.map((e) => (e.t >= hasta - 0.001 ? { ...e, t: tidy(e.t + bpb) } : e));
  const copia = list
    .filter((e) => e.t >= desde - 0.001 && e.t < hasta - 0.001)
    .map((e) => ({ ...e, t: tidy(e.t + bpb) }));
  return [...corridos, ...copia];
}

/** Dónde empieza el compás número `n` (1 = el primero después de la anacrusa). */
export function inicioDelCompas(n: number, pickup: number, bpb: number): number {
  return tidy(pickup + Math.max(0, n - 1) * bpb);
}
