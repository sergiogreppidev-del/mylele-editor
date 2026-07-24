import { useMemo, useState } from 'react';
import { CandyButton } from './CandyButton';
import { Issues } from './Issues';
import { buildAiPrompt, TARGET_LABEL } from '../lib/aiPrompt';
import { parseNotation, toNotation } from '../lib/notation';
import type { NotationTarget } from '../lib/notation';
import { parseBacking, parseEvents, tidy } from '../lib/chartFormat';
import type { BackingEvent, ChordEvent, Issue, MelodyEvent } from '../lib/chartFormat';

interface Props {
  target: NotationTarget;
  title: string;
  bpm: number;
  timeSig: string;
  beatsPerBar: number;
  bars: number;
  knownChords: string[];
  /** Eventos actuales, para ofrecer "agregar al final" y exportar. */
  currentChords: ChordEvent[];
  currentBacking: BackingEvent[];
  onPreview: (chords: ChordEvent[], backing: BackingEvent[]) => void;
  onApply: (result: { chords?: ChordEvent[]; melody?: MelodyEvent[]; backing?: BackingEvent[] }) => void;
  onClose: () => void;
}

type Mode = 'replace' | 'append';

/**
 * Pegar → ver → escuchar → aceptar. No toca nada hasta que el autor aprueba,
 * que es la red de seguridad contra lo que la IA se manda mal.
 */
export function ImportDialog(props: Props) {
  const { target, beatsPerBar, knownChords, bars } = props;
  const [text, setText] = useState('');
  const [pedido, setPedido] = useState('');
  const [mode, setMode] = useState<Mode>('replace');
  const [copied, setCopied] = useState(false);

  const currentEnd = useMemo(() => {
    const list = target === 'backing' ? props.currentBacking : props.currentChords;
    const end = list.reduce((m, e) => Math.max(m, e.t + e.dur), 0);
    // Al agregar al final se arranca en el compás siguiente, no pegado a la última nota.
    return Math.ceil(end / beatsPerBar) * beatsPerBar;
  }, [props.currentBacking, props.currentChords, target, beatsPerBar]);

  const parsed = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // Si arranca con "[" es el JSON del propio editor, no la notación de texto.
    if (trimmed.startsWith('[')) {
      try {
        const raw = JSON.parse(trimmed);
        const issues: Issue[] = [];
        if (target === 'backing') {
          const backing = parseBacking(raw);
          if (backing.length === 0) issues.push({ level: 'error', message: 'El JSON no tiene notas de fondo con "pitch".' });
          return { kind: 'json' as const, chords: [], melody: [], backing, issues, totalBeats: end(backing) };
        }
        const evs = parseEvents(raw);
        if (evs.length === 0) issues.push({ level: 'error', message: 'El JSON no tiene eventos reconocibles.' });
        const chords = evs.filter((e): e is ChordEvent => 'chord' in e);
        const melody = evs.filter((e): e is MelodyEvent => 'string' in e);
        return { kind: 'json' as const, chords, melody, backing: [], issues, totalBeats: end(evs) };
      } catch {
        return {
          kind: 'json' as const, chords: [], melody: [], backing: [], totalBeats: 0,
          issues: [{ level: 'error' as const, message: 'Eso parece JSON pero está mal escrito (falta una coma o un corchete).' }],
        };
      }
    }

    const r = parseNotation(trimmed, { target, beatsPerBar, knownChords, autoTranspose: true });
    return {
      kind: 'notation' as const,
      chords: r.chordEvents,
      melody: r.melodyEvents,
      backing: r.backingEvents,
      issues: r.issues,
      totalBeats: r.totalBeats,
    };
  }, [text, target, beatsPerBar, knownChords]);

  const errors = parsed?.issues.filter((i) => i.level === 'error').length ?? 0;
  const count = parsed ? parsed.chords.length + parsed.melody.length + parsed.backing.length : 0;
  const canApply = !!parsed && errors === 0 && count > 0;

  const offset = mode === 'append' ? currentEnd : 0;
  const shifted = useMemo(() => {
    if (!parsed) return { chords: [], melody: [], backing: [] };
    const bump = <T extends { t: number }>(list: T[]): T[] => list.map((e) => ({ ...e, t: tidy(e.t + offset) }));
    return { chords: bump(parsed.chords), melody: bump(parsed.melody), backing: bump(parsed.backing) };
  }, [parsed, offset]);

  async function copyPrompt() {
    const prompt = buildAiPrompt({
      target, title: props.title, bpm: props.bpm, timeSig: props.timeSig,
      beatsPerBar, bars, knownChords, pedido,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Si el navegador bloquea el portapapeles, al menos lo dejamos a la vista.
      setText(prompt);
    }
  }

  function exportCurrent() {
    const list = target === 'backing' ? props.currentBacking : props.currentChords;
    setText(toNotation(list, beatsPerBar));
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ fontSize: 20 }}>Importar {TARGET_LABEL[target]}</h2>
          <div className="grow" />
          <CandyButton small tone="ghost" onClick={props.onClose}>
            ✕
          </CandyButton>
        </div>

        {/* --- paso 1: pedirle a la IA --- */}
        <div className="step">
          <div className="section-title">1 · Pedile la canción a una IA</div>
          <div className="row">
            <input
              className="f grow"
              placeholder="Qué querés. Ej: Feliz cumpleaños en Do"
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
            />
            <CandyButton small tone="sun" onClick={() => void copyPrompt()}>
              {copied ? '✓ Copiado' : '📋 Copiar instrucciones'}
            </CandyButton>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Copia un pedido con el formato, el compás, el tempo y los acordes de este nivel ya explicados.
            Lo pegás en Claude o ChatGPT y te devuelve la línea lista para el paso 2.
          </p>
        </div>

        {/* --- paso 2: pegar --- */}
        <div className="step">
          <div className="row">
            <div className="section-title grow">2 · Pegá lo que te dio</div>
            <CandyButton small tone="ghost" onClick={exportCurrent}>
              Traer lo que ya hay
            </CandyButton>
          </div>
          <textarea
            className="f mono"
            rows={4}
            placeholder={
              target === 'chords'
                ? '| C/4 | Am/4 | F/4 | G/4 |'
                : '| G4/.5 G4/.5 A4/1 G4/1 | C5/1 B4/2 r/1 |'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Acepta la notación de texto o el JSON que genera este mismo editor.
          </p>
        </div>

        {/* --- paso 3: revisar --- */}
        {parsed && (
          <div className="step">
            <div className="section-title">3 · Revisá antes de aceptar</div>
            {count > 0 && (
              <div className="notice good" style={{ marginBottom: 8 }}>
                {count} {target === 'chords' ? 'acordes' : 'notas'} · {tidy(parsed.totalBeats)} tiempos ·{' '}
                {Math.round((parsed.totalBeats / beatsPerBar) * 10) / 10} compases
              </div>
            )}
            <Issues issues={parsed.issues} />
            {canApply && (
              <div className="row" style={{ marginTop: 8 }}>
                <CandyButton small tone="lime" onClick={() => props.onPreview(shifted.chords, shifted.backing)}>
                  ▶ Escuchar
                </CandyButton>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    className="f"
                    type="radio"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />
                  <span>Reemplazar todo</span>
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    className="f"
                    type="radio"
                    checked={mode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  <span>Agregar desde el compás {Math.floor(currentEnd / beatsPerBar) + 1}</span>
                </label>
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 4 }}>
          <CandyButton
            tone="lime"
            disabled={!canApply}
            onClick={() => {
              if (!parsed) return;
              props.onApply(
                target === 'backing'
                  ? { backing: mode === 'append' ? [...props.currentBacking, ...shifted.backing] : shifted.backing }
                  : target === 'chords'
                    ? { chords: mode === 'append' ? [...props.currentChords, ...shifted.chords] : shifted.chords }
                    : { melody: shifted.melody },
              );
            }}
          >
            Aceptar
          </CandyButton>
          <CandyButton tone="ghost" onClick={props.onClose}>
            Cancelar
          </CandyButton>
          <div className="grow" />
          <span className="muted">Nada se guarda hasta que le des a Guardar borrador.</span>
        </div>
      </div>
    </div>
  );
}

function end(list: { t: number; dur: number }[]): number {
  return tidy(list.reduce((m, e) => Math.max(m, e.t + e.dur), 0));
}
