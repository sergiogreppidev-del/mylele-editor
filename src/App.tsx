import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { checkIsAdmin, friendlyError, supabase } from './lib/supabase';
import { getSong, listChords, listSongs } from './lib/db';
import type { ChordRow, SongRow } from './lib/db';
import { CandyButton } from './components/CandyButton';
import { Login } from './screens/Login';
import { LevelList } from './screens/LevelList';
import { ChartEditor } from './screens/ChartEditor';
import { ChordsAdmin } from './screens/ChordsAdmin';

import type { ChartMode } from './lib/chartFormat';

/** Al crear, el tipo viaja en la ruta: se eligió en el listado y ya no se discute. */
type Route =
  | { name: 'list' }
  | { name: 'editor'; songId: string | null; nuevoModo?: ChartMode }
  | { name: 'chords' };

/* La pantalla vive en la dirección, no solo en memoria. Antes un F5 —o el botón
   de atrás del navegador— te devolvía al listado y perdías dónde estabas. */
function rutaDesdeHash(): Route {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (h === 'acordes') return { name: 'chords' };
  const nuevo = /^nivel\/nuevo\/(chords|melody)$/.exec(h);
  if (nuevo) return { name: 'editor', songId: null, nuevoModo: nuevo[1] as ChartMode };
  const uno = /^nivel\/(.+)$/.exec(h);
  if (uno) return { name: 'editor', songId: uno[1] };
  return { name: 'list' };
}

function hashDeRuta(r: Route): string {
  if (r.name === 'chords') return '#/acordes';
  if (r.name === 'editor') {
    return r.songId ? `#/nivel/${r.songId}` : `#/nivel/nuevo/${r.nuevoModo ?? 'chords'}`;
  }
  return '#/niveles';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [songs, setSongs] = useState<SongRow[]>([]);
  const [chords, setChords] = useState<ChordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /* La dirección es la única fuente de la ruta: se navega escribiéndola y el
     estado se actualiza por el evento. Así no hay dos verdades que sincronizar. */
  const [route, setRoute] = useState<Route>(rutaDesdeHash);
  const ir = useCallback((r: Route) => {
    const h = hashDeRuta(r);
    if (window.location.hash === h) setRoute(r);
    else window.location.hash = h;
  }, []);

  useEffect(() => {
    const alCambiar = () => setRoute(rutaDesdeHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* Con qué canciones cuenta el listado, para poder refrescar una sola. Va en un
     ref para que `reload` no cambie de identidad en cada render. */
  const songsRef = useRef<SongRow[]>([]);
  useEffect(() => {
    songsRef.current = songs;
  }, [songs]);

  /**
   * Refresca el catálogo. Con un `songId` que ya esté en la lista, vuelve a traer
   * SOLO esa canción: guardar un nivel no tiene por qué descargar todas las demás
   * con todos sus eventos. Sin id, o si la canción es nueva, trae todo.
   */
  const reload = useCallback(async (songId?: string) => {
    try {
      if (songId && songsRef.current.some((s) => s.id === songId)) {
        const fresh = await getSong(songId);
        setSongs((prev) => prev.map((s) => (s.id === songId ? fresh : s)));
        setError(null);
        return;
      }
      const [s, c] = await Promise.all([listSongs(), listChords()]);
      setSongs(s);
      setChords(c);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void checkIsAdmin().then(setIsAdmin);
    void reload();
  }, [session, reload]);

  if (!ready) return null;
  if (!session) return <Login />;

  return (
    <div className="page">
      <header className="appbar">
        <h1>MyLele Editor</h1>
        <span className="badge mode">{isAdmin ? 'Editor' : 'Solo lectura'}</span>
        <div className="spacer" />
        <CandyButton
          small
          tone={route.name === 'chords' ? 'sun' : 'ghost'}
          onClick={() => ir(route.name === 'chords' ? { name: 'list' } : { name: 'chords' })}
        >
          🎸 Acordes
        </CandyButton>
        <span className="who">{session.user.email}</span>
        <CandyButton small tone="ghost" onClick={() => void supabase.auth.signOut()}>
          Salir
        </CandyButton>
      </header>

      <main className="page-body stack-16">
        {!isAdmin && (
          <div className="notice warn">
            Estás logueado pero tu usuario no figura en la lista de administradores, así que no podés
            guardar cambios. Hay que agregarlo a la tabla <b>admins</b> desde Supabase.
          </div>
        )}
        {error && <div className="notice bad">{error}</div>}

        {route.name === 'chords' ? (
          <ChordsAdmin
            chords={chords}
            songs={songs}
            canEdit={isAdmin}
            onBack={() => ir({ name: 'list' })}
            onReload={reload}
          />
        ) : route.name === 'list' ? (
          <LevelList
            songs={songs}
            digitaciones={Object.fromEntries(chords.map((c) => [c.id, c.frets]))}
            canEdit={isAdmin}
            onOpen={(songId, nuevoModo) => ir({ name: 'editor', songId, nuevoModo })}
            onReload={reload}
          />
        ) : (
          <ChartEditor
            // El modo entra en la clave: entrar a crear un nivel de notas y después
            // uno de acordes tiene que remontar el editor, no reusar el estado viejo.
            key={route.songId ?? `nuevo-${route.nuevoModo ?? 'chords'}`}
            songId={route.songId}
            nuevoModo={route.nuevoModo}
            chords={chords}
            canEdit={isAdmin}
            onBack={() => ir({ name: 'list' })}
            onReload={reload}
          />
        )}
      </main>
    </div>
  );
}
