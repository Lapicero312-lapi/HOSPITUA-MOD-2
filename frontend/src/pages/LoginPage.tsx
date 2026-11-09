import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { currentUser, nameError, signIn } from '../services/session.ts';

type LoginState = { from?: string } | null;

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = location.state as LoginState;
  const requestedPath = state?.from ?? '/';

  if (currentUser()) return <Navigate to={requestedPath} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const validationError = nameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    signIn(name);
    nav(requestedPath, { replace: true });
  };

  return (
    <form className="panel login" onSubmit={submit} noValidate>
      <h2>HOSPITUA · Recepción</h2>
      <p>Ingrese su nombre para registrar las acciones del turno.</p>
      <div className="field">
        <label htmlFor="receptionist-name">Nombre de la Recepcionista</label>
        <input
          id="receptionist-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="name"
        />
      </div>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      <button className="btn primary">Ingresar</button>
    </form>
  );
}
