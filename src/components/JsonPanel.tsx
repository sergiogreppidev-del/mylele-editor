import { serializeBacking, serializeEvents } from '../lib/chartFormat';
import type { BackingEvent, ChartEvent } from '../lib/chartFormat';

interface Props {
  /** La capa jugable: acordes o notas, según el modo del nivel. */
  events: ChartEvent[];
  backing?: BackingEvent[];
}

/** El JSON que se va a guardar, siempre a un clic: sirve para depurar y para confiar. */
export function JsonPanel({ events, backing = [] }: Props) {
  const fmt = (list: object[]) => '[\n' + list.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]';
  const clean = serializeEvents(events);
  const bck = serializeBacking(backing);

  return (
    <details className="json">
      <summary>
        ▸ Ver el JSON que se guarda ({clean.length} eventos
        {bck.length > 0 ? ` · ${bck.length} de fondo` : ''})
      </summary>
      <pre>{clean.length ? fmt(clean) : '[]'}</pre>
      {bck.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>
            Fondo
          </div>
          <pre>{fmt(bck)}</pre>
        </>
      )}
    </details>
  );
}
