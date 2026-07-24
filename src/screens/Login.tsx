import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { CandyButton } from '../components/CandyButton';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(friendlyError(error));
    setBusy(false);
    // Si salió bien, App reacciona al cambio de sesión.
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>MyLele Editor</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: -8 }}>
          Herramienta interna para crear niveles.
        </p>

        <label className="field">
          <span>Mail</span>
          <input
            className="f"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Contraseña</span>
          <input
            className="f"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="notice bad">{error}</div>}

        <CandyButton type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </CandyButton>
      </form>
    </div>
  );
}
