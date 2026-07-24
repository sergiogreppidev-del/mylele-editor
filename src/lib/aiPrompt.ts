/* Arma el pedido completo para una IA, con el formato y los datos del nivel ya
   metidos adentro. La idea es no tener que explicar el formato cada vez ni
   corregir a mano lo que venga mal. */

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
}

const FORMATO_COMUN = `FORMATO DE SALIDA (obligatorio)
Escribís una sola línea de texto con elementos separados por espacios.
- Cada elemento es NOMBRE/DURACION. La duración se mide en TIEMPOS (beats), no en segundos.
- Podés usar decimales: 1 = negra, .5 = corchea, 2 = blanca, 1.5 = negra con puntillo.
- "r/1" es un silencio de un tiempo.
- "|" separa compases. Poné una barra al final de cada compás.
- NO escribas tiempos de inicio ni números de compás: se calculan solos sumando las duraciones.
- Respondé ÚNICAMENTE con esa línea, sin explicaciones, sin comillas y sin bloque de código.`;

export function buildAiPrompt(o: PromptOptions): string {
  const pedido = o.pedido?.trim();
  const cabecera = [
    'Sos un asistente que escribe partituras para MyLele, una app para aprender ukelele.',
    '',
    `NIVEL: "${o.title || 'sin título'}"`,
    `Compás: ${o.timeSig} (${o.beatsPerBar} tiempos por compás) · Tempo: ${o.bpm} BPM`,
    `Extensión: ${o.bars} compases (${o.bars * o.beatsPerBar} tiempos en total). Llenalos todos.`,
    '',
  ].join('\n');

  let tarea: string;
  let ejemplo: string;
  let reglas: string;

  if (o.target === 'chords') {
    tarea = pedido
      ? `TAREA\nEscribí la progresión de acordes de: ${pedido}`
      : 'TAREA\nEscribí una progresión de acordes que suene bien y sea fácil para alguien que arranca.';
    reglas = [
      'REGLAS',
      `- Usá ÚNICAMENTE estos acordes: ${o.knownChords.join(', ') || '(no hay acordes cargados)'}. No inventes otros.`,
      '- Podés agregar :d (rasgueo hacia abajo) o :u (hacia arriba) después de la duración. Si no ponés nada, es hacia abajo.',
      '- Para alguien que recién empieza, un acorde por compás ya está bien.',
    ].join('\n');
    ejemplo = `EJEMPLO (${o.beatsPerBar} tiempos por compás)\n| C/${o.beatsPerBar} | Am/${o.beatsPerBar} | F/${o.beatsPerBar} | G/${o.beatsPerBar} |`;
  } else if (o.target === 'melody') {
    tarea = pedido
      ? `TAREA\nEscribí la melodía de: ${pedido}`
      : 'TAREA\nEscribí una melodía simple y reconocible para practicar notas sueltas.';
    reglas = [
      'REGLAS',
      '- Cada nota se escribe con su nombre y su octava: C4, G4, A#3, Bb5.',
      '- IMPORTANTE: esta melodía la toca el alumno en un ukelele, así que TODAS las notas',
      '  tienen que estar entre C4 y A5. Si la melodía original es más grave, subila de octava.',
      '- Una sola voz: nada de dos notas sonando a la vez.',
    ].join('\n');
    ejemplo = 'EJEMPLO\n| G4/1 G4/1 A4/1 G4/1 | C5/2 B4/2 |';
  } else {
    tarea = pedido
      ? `TAREA\nEscribí la melodía de acompañamiento de: ${pedido}`
      : 'TAREA\nEscribí una melodía de acompañamiento que suene de fondo mientras el alumno toca.';
    reglas = [
      'REGLAS',
      '- Cada nota se escribe con su nombre y su octava: C4, G4, A#3, Bb5.',
      '- Esto NO lo toca el alumno: lo reproduce la app, así que podés usar cualquier octava (C2 a C7).',
      '- Una sola voz: nada de dos notas sonando a la vez.',
    ].join('\n');
    ejemplo = 'EJEMPLO\n| G4/.5 G4/.5 A4/1 G4/1 | C5/1 B4/2 r/1 |';
  }

  return [cabecera, tarea, '', reglas, '', FORMATO_COMUN, '', ejemplo].join('\n');
}

export const TARGET_LABEL: Record<NotationTarget, string> = {
  chords: 'acordes (lo que toca el alumno)',
  melody: 'notas sueltas (lo que toca el alumno)',
  backing: 'melodía de fondo (la toca la app)',
};
