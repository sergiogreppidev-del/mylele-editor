/* ===================================================================
   MyLele Editor · Reproducción de prueba
   Metrónomo + acompañamiento sintetizado, para escuchar el chart antes
   de publicarlo. SIN micrófono y SIN detección: acá solo se valida que
   el nivel suene y se lea bien.

   playSynth / chordFreqs / scheduleBacking / scheduleClick están PORTADOS
   de game.js:158-219 de la app de alumnos (el groove reggae), para que lo
   que se escucha en el editor sea lo mismo que va a escuchar el alumno.
   =================================================================== */

import type { BackingEvent, ChordEvent, MelodyEvent } from './chartFormat';
import { STRING_MIDI, pitchToMidi } from './notation';

/** pitch classes por acorde, tal como vienen de la tabla `chords`. */
export type ChordPcs = Record<string, number[]>;

export interface PlayOptions {
  events: ChordEvent[];
  bpm: number;
  beatsPerBar: number;
  chordPcs: ChordPcs;
  /** Notas sueltas que toca el alumno, en tablatura. */
  melodyNotes?: MelodyEvent[];
  /** Melodía de acompañamiento importada (la toca la app, no el alumno). */
  backingNotes?: BackingEvent[];
  /** Acompañamiento GRABADO. Si viene, reemplaza a todo lo sintetizado. */
  recordedUrl?: string | null;
  /** Corrimiento en segundos de la grabación respecto del tiempo 1. */
  recordedOffset?: number;
  countInBars?: number;
  metronome?: boolean;
  backing?: boolean;
  /** beat actual (negativo durante la cuenta de entrada) */
  onBeat?: (beat: number) => void;
  onEnd?: () => void;
}

export class PreviewAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private raf = 0;
  private endTimer: number | null = null;
  private playing = false;
  private source: AudioBufferSourceNode | null = null;
  /** Los archivos decodificados se guardan por URL: decodificar tarda y se repite mucho. */
  private static cache = new Map<string, AudioBuffer>();

  /**
   * Descarga y decodifica la grabación. Hay que hacerlo antes de reproducir, porque
   * el arranque tiene que caer en el mismo reloj que el metrónomo: si se decodifica
   * sobre la marcha, la música entra corrida y no se puede juzgar el calce.
   */
  async loadRecorded(url: string): Promise<AudioBuffer> {
    const hit = PreviewAudio.cache.get(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar el audio (${res.status}).`);
    const bytes = await res.arrayBuffer();
    const buf = await this.ensureCtx().decodeAudioData(bytes);
    PreviewAudio.cache.set(url, buf);
    return buf;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  // --- clic del metrónomo (programado con precisión) — game.js:158 ---
  private scheduleClick(time: number, accent: boolean) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1200 : 850;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // --- una voz del sintetizador — game.js:183 ---
  private playSynth(time: number, freq: number, dur: number, type: OscillatorType, peak: number) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(time);
    osc.stop(time + dur + 0.03);
  }

  // --- game.js:193 ---
  private chordFreqs(pcs: number[] | undefined, octave: number): number[] {
    if (!pcs) return [];
    return pcs.map((pc) => 261.63 * Math.pow(2, pc / 12 + (octave - 4)));
  }

  // --- acompañamiento reggae/island (bajo + chop + percusión) — game.js:197 ---
  private scheduleBacking(events: ChordEvent[], startTime: number, countInBeats: number, beatDur: number, chordPcs: ChordPcs) {
    for (const e of events) {
      const pcs = chordPcs[e.chord];
      if (!pcs || pcs.length === 0) continue;
      const rootPc = pcs[0];
      const dur = e.dur || 4;
      const barStart = startTime + (countInBeats + e.t) * beatDur;
      const chopFreqs = this.chordFreqs(pcs, 5); // acordes brillantes arriba

      // Los eventos cortos (rasgueos de una corchea) no aguantan el patrón de
      // 2 tiempos: en ese caso solo suena el acorde en su onset.
      const wholeBeats = Math.floor(dur);
      for (let b = 0; b < wholeBeats; b++) {
        const bt = barStart + b * beatDur;
        // bajo grave relajado en tiempos 1 y 3 (one drop)
        if (b % 2 === 0) {
          const bf = 261.63 * Math.pow(2, rootPc / 12 - 2); // octava 2
          this.playSynth(bt, bf, beatDur * 0.55, 'sine', 0.24);
        }
        // el "chop" en el contratiempo (la corchea del "y")
        const up = bt + beatDur * 0.5;
        chopFreqs.forEach((f) => this.playSynth(up, f, 0.13, 'triangle', 0.06));
        // golpe de percusión suave en el 3
        if (b === 2) this.playSynth(bt, 160, 0.09, 'square', 0.05);
      }
    }
  }

  /**
   * Rasgueo del propio chart: hace audible CADA evento en su onset, que es lo que
   * se está editando. Las cuerdas entran escalonadas y el orden se invierte en los
   * rasgueos hacia arriba, así se distingue ↓ de ↑ al escuchar.
   */
  private scheduleStrums(events: ChordEvent[], startTime: number, countInBeats: number, beatDur: number, chordPcs: ChordPcs) {
    for (const e of events) {
      const pcs = chordPcs[e.chord];
      if (!pcs || pcs.length === 0) continue;
      const at = startTime + (countInBeats + e.t) * beatDur;
      const freqs = this.chordFreqs(pcs, 4);
      const order = e.dir === 'u' ? [...freqs].reverse() : freqs;
      const spread = Math.min(0.03, beatDur * 0.12);
      order.forEach((f, i) => {
        this.playSynth(at + i * spread, f * 2, Math.min(0.45, beatDur * e.dur), 'triangle', 0.13);
      });
    }
  }

  /**
   * Melodía de fondo. Suena más fuerte y con otro timbre que el "chop" del groove
   * para que se distinga de lo que el alumno tiene que tocar.
   */
  private scheduleBackingMelody(notes: BackingEvent[], startTime: number, countInBeats: number, beatDur: number) {
    // El fondo es polifónico: si tres notas arrancan juntas, sus amplitudes se suman
    // y satura. Se reparte el volumen entre las voces que suenan a la vez.
    const juntas = new Map<number, number>();
    for (const n of notes) {
      const k = Math.round(n.t * 1000);
      juntas.set(k, (juntas.get(k) ?? 0) + 1);
    }
    for (const n of notes) {
      const midi = pitchToMidi(n.pitch);
      if (midi === null) continue;
      const voces = juntas.get(Math.round(n.t * 1000)) ?? 1;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const at = startTime + (countInBeats + n.t) * beatDur;
      // 0.9 en vez de 1: deja un respiro entre notas para que no suene ligado.
      this.playSynth(at, freq, Math.max(0.08, n.dur * beatDur * 0.9), 'sine', 0.2 / Math.sqrt(voces));
    }
  }

  /**
   * Las notas que toca el alumno, para escuchar cómo suena la melodía del nivel.
   * Timbre distinto del fondo, así se distingue lo propio de lo ajeno.
   */
  private scheduleMelody(notes: MelodyEvent[], startTime: number, countInBeats: number, beatDur: number) {
    for (const n of notes) {
      const midi = STRING_MIDI[n.string] + n.fret;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const at = startTime + (countInBeats + n.t) * beatDur;
      this.playSynth(at, freq, Math.max(0.1, n.dur * beatDur * 0.9), 'triangle', 0.22);
    }
  }

  play(opts: PlayOptions) {
    this.stop();
    const ctx = this.ensureCtx();
    const {
      events, bpm, beatsPerBar, chordPcs, backingNotes = [], melodyNotes = [],
      recordedUrl = null, recordedOffset = 0,
      countInBars = 1, metronome = true, backing = true,
      onBeat, onEnd,
    } = opts;
    // La grabación tiene que estar ya decodificada (loadRecorded) para arrancar a tiempo.
    const recorded = recordedUrl ? PreviewAudio.cache.get(recordedUrl) ?? null : null;

    const beatDur = 60 / bpm;
    const countInBeats = countInBars * beatsPerBar;
    const startTime = ctx.currentTime + 0.25;
    // El nivel dura lo que dure la capa más larga: el fondo puede pasarse de lo jugable.
    const lastBeat = Math.max(
      events.reduce((m, e) => Math.max(m, e.t + (e.dur || 1)), 0),
      melodyNotes.reduce((m, e) => Math.max(m, e.t + (e.dur || 1)), 0),
      backingNotes.reduce((m, e) => Math.max(m, e.t + (e.dur || 1)), 0),
    );
    const totalBeats = countInBeats + Math.ceil(lastBeat);

    if (metronome) {
      // Igual que en la app de alumnos: con grabación, el clic marca solo la entrada.
      const hasta = recorded ? countInBeats : totalBeats;
      for (let i = 0; i < hasta; i++) {
        this.scheduleClick(startTime + i * beatDur, i % beatsPerBar === 0);
      }
    }
    if (recorded) {
      const src = ctx.createBufferSource();
      src.buffer = recorded;
      src.connect(this.master!);
      const when = startTime + countInBeats * beatDur + recordedOffset;
      if (when >= ctx.currentTime) src.start(when);
      else src.start(ctx.currentTime, ctx.currentTime - when); // ya pasó: entra por el medio
      this.source = src;
    } else if (backing) {
      this.scheduleBacking(events, startTime, countInBeats, beatDur, chordPcs);
      this.scheduleStrums(events, startTime, countInBeats, beatDur, chordPcs);
      this.scheduleBackingMelody(backingNotes, startTime, countInBeats, beatDur);
    }
    // Las notas del alumno suenan siempre: son lo que se está editando.
    this.scheduleMelody(melodyNotes, startTime, countInBeats, beatDur);

    this.playing = true;

    // Cursor: beat actual, negativo mientras corre la cuenta de entrada.
    const tick = () => {
      if (!this.playing || !this.ctx) return;
      const beat = (this.ctx.currentTime - startTime) / beatDur - countInBeats;
      onBeat?.(beat);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    const totalMs = (totalBeats + 1) * beatDur * 1000 + 300;
    this.endTimer = window.setTimeout(() => {
      this.stop();
      onEnd?.();
    }, totalMs);
  }

  stop() {
    this.playing = false;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* ya estaba detenida */
      }
      this.source = null;
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = null;
    // Cortar lo ya programado: se cierra el contexto y se rearma en el próximo play.
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
