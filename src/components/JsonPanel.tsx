import { serializeEvents } from '../lib/chartFormat';
import type { ChartEvent } from '../lib/chartFormat';

/** El JSON que se va a guardar, siempre a un clic: sirve para depurar y para confiar. */
export function JsonPanel({ events }: { events: ChartEvent[] }) {
  const clean = serializeEvents(events);
  const text = '[\n' + clean.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]';
  return (
    <details className="json">
      <summary>▸ Ver el JSON que se guarda ({clean.length} eventos)</summary>
      <pre>{text}</pre>
    </details>
  );
}
