/* Colores por acorde. Los cuatro originales están fijados por el sistema de
   diseño de MyLele (C lima · Am uva · F sandía · G cielo); los acordes nuevos
   toman un color de la misma paleta de forma estable. */

export interface Candy {
  bg: string;
  shadow: string;
}

const PALETTE: Candy[] = [
  { bg: '#7FD94C', shadow: '#54AC26' }, // lima
  { bg: '#A263FF', shadow: '#7838DC' }, // uva
  { bg: '#FF5F7E', shadow: '#D3395A' }, // sandía
  { bg: '#4FC9F5', shadow: '#2196C9' }, // cielo
  { bg: '#FFC42E', shadow: '#DD9700' }, // sol
];

const FIXED: Record<string, Candy> = {
  C: PALETTE[0],
  Am: PALETTE[1],
  F: PALETTE[2],
  G: PALETTE[3],
};

export function chordColor(id: string): Candy {
  if (FIXED[id]) return FIXED[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
