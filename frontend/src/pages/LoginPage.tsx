import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { currentUser, nameError, signIn } from '../services/session.ts';

/** De dónde venía la Recepcionista antes de que se le pidiera el nombre. */
type LoginState = { from?: string } | null;

/** Login simulado: solo pide el nombre de la Recepcionista (plan base, regla 10). */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as LoginState)?.from ?? '/';

  if (currentUser()) {
    return <Navigate to={from} replace />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = nameError(name);
    if (problem) {
      setError(problem);
      return;
    }
    signIn(name);
    navigate(from, { replace: true });
  };

  return (
    <main className="layout-main">
      <h1>HOSPITUA · Recepción</h1>
      <form className="login-form" onSubmit={submit} noValidate>
        <label htmlFor="receptionist-name">Nombre de la Recepcionista</label>
        <input
          id="receptionist-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? 'receptionist-name-error' : undefined}
          autoComplete="name"
        />
        {error && (
          <p
            id="receptionist-name-error"
            role="alert"
            className="error-message"
          >
            {error}
          </p>
        )}
        <button type="submit">Ingresar</button>
      </form>
    </main>
  );
}
