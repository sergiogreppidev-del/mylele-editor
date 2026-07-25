import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { checkIsAdmin, friendlyError, supabase } from './lib/supabase';
import { listChords, listSongs } from './lib/db';
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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [songs, setSongs] = useState<SongRow[]>([]);
  const [chords, setChords] = useState<ChordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'list' });

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    try {
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
          onClick={() => setRoute(route.name === 'chords' ? { name: 'list' } : { name: 'chords' })}
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
            onBack={() => setRoute({ name: 'list' })}
            onReload={reload}
          />
        ) : route.name === 'list' ? (
          <LevelList
            songs={songs}
            digitaciones={Object.fromEntries(chords.map((c) => [c.id, c.frets]))}
            canEdit={isAdmin}
            onOpen={(songId, nuevoModo) => setRoute({ name: 'editor', songId, nuevoModo })}
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
            onBack={() => setRoute({ name: 'list' })}
            onReload={reload}
          />
        )}
      </main>
    </div>
  );
}
