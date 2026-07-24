import type { Issue } from '../lib/chartFormat';

/** Muestra los problemas del nivel. Los errores bloquean publicar; los avisos no. */
export function Issues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  return (
    <div className="col">
      {errors.length > 0 && (
        <div className="notice bad">
          🚫 {errors.length === 1 ? 'Hay 1 problema que impide publicar' : `Hay ${errors.length} problemas que impiden publicar`}:
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="notice warn">
          ⚠️ Avisos (se puede publicar igual):
          <ul>
            {warns.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
