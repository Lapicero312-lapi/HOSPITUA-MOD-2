import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { nameError } from '../services/session';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = location.state as { from?: string } | null;
  const requestedPath = state?.from ?? '/';
  if (user) return <Navigate to={requestedPath} replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const validationError = nameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    login(name.trim());
    nav(requestedPath, { replace: true });
  };
  return (
    <form className="panel login" onSubmit={submit}>
      <h2>HOSPITUA · Recepción</h2>
      <p>Ingrese su nombre para registrar las acciones del turno.</p>
      <div className="field">
        <label htmlFor="n">Nombre de la Recepcionista</label>
        <input
          id="n"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      {error && <div role="alert">{error}</div>}
      <button className="btn primary">Ingresar</button>
    </form>
  );
}
