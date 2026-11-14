import { useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import {
  ArrowRightIcon,
  BrandGlyph,
  MoonIcon,
  SunIcon,
} from '../components/icons.tsx';
import { currentUser, nameError, signIn } from '../services/session.ts';
import { useTheme } from '../services/theme.ts';
import { LoginVisual } from './LoginVisual.tsx';
import './LoginPage.css';

/** De dónde venía la Recepcionista antes de que se le pidiera el nombre. */
type LoginState = { from?: string } | null;

/** El orden de entrada en cascada de cada pieza del formulario. */
const step = (index: number) => ({ '--i': index }) as CSSProperties;

/** Login simulado: solo pide el nombre de la Recepcionista (plan base, regla 10). */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
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
    <div className="login">
      <div className="login-side">
        <header className="login-top">
          <span className="login-brand">
            <span className="brand-mark" aria-hidden="true">
              <BrandGlyph />
            </span>
            HOSPITUA
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={
              theme === 'dark'
                ? 'Cambiar a tema claro'
                : 'Cambiar a tema oscuro'
            }
            onClick={toggle}
          >
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
        </header>

        <main className="login-main">
          <div className="login-card">
            <span className="login-eyebrow login-step" style={step(0)}>
              Inicio de turno
            </span>
            <h1 className="login-title login-step" style={step(1)}>
              HOSPITUA · Recepción
            </h1>
            <form className="login-form" onSubmit={submit} noValidate>
              <div className="login-field login-step" style={step(2)}>
                <label htmlFor="receptionist-name">
                  Nombre de la Recepcionista
                </label>
                <input
                  id="receptionist-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={error !== null}
                  aria-describedby={
                    error ? 'receptionist-name-error' : undefined
                  }
                  autoComplete="name"
                  placeholder="Ej. Ana Pérez"
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
              </div>
              <button
                type="submit"
                className="ui-button--primary login-submit login-step"
                style={step(3)}
              >
                Ingresar
                <ArrowRightIcon size={15} />
              </button>
            </form>
          </div>
        </main>

        <footer className="login-bottom">
          Módulo 2 · Operación de reservas y cumplimiento legal
        </footer>
      </div>

      <LoginVisual />
    </div>
  );
}
