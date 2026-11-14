import { useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AnimatedLogo, type DoorState } from '../components/brand.tsx';
import { Concierge, type ConciergeMood } from '../components/Concierge.tsx';
import {
  ArrowRightIcon,
  MoonIcon,
  ShiftBadgeIcon,
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

/**
 * Login simulado: solo pide el nombre de la Recepcionista (plan base, regla 10). La puerta del logo se
 * entreabre al cargar y se abre del todo mientras la Recepcionista escribe o apunta a "Ingresar".
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [aiming, setAiming] = useState(false);
  const from = (location.state as LoginState)?.from ?? '/';
  const door: DoorState = typing || aiming ? 'open' : 'peek';
  // Túa mira el formulario mientras se escribe y se sacude si el nombre no sirve.
  const mood: ConciergeMood = typing
    ? 'attentive'
    : error !== null
      ? 'error'
      : 'greeting';

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
        <header className="login-top login-step" style={step(0)}>
          <AnimatedLogo door={door} size={44} />
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
            <Concierge
              mood={mood}
              size={132}
              className="login-concierge-mobile login-step"
            />
            <span className="login-eyebrow login-step" style={step(1)}>
              Recepción · Módulo 2
            </span>
            <h1 className="login-title login-step" style={step(2)}>
              Apertura de turno en recepción
            </h1>
            <form className="login-form" onSubmit={submit} noValidate>
              <div className="login-field login-step" style={step(3)}>
                <label htmlFor="receptionist-name">
                  Nombre de la Recepcionista
                </label>
                <div className="login-input">
                  <ShiftBadgeIcon size={16} className="login-input-icon" />
                  <input
                    id="receptionist-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    aria-invalid={error !== null}
                    aria-describedby={
                      error ? 'receptionist-name-error' : undefined
                    }
                    autoComplete="name"
                    placeholder="Ej. Ana Pérez"
                  />
                </div>
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
                style={step(4)}
                onMouseEnter={() => setAiming(true)}
                onMouseLeave={() => setAiming(false)}
                onFocus={() => setAiming(true)}
                onBlur={() => setAiming(false)}
              >
                Ingresar
                <ArrowRightIcon size={15} />
              </button>
            </form>
          </div>
        </main>

        <footer className="login-bottom login-step" style={step(5)}>
          <span>HOSPITUA · MÓDULO 2</span>
          <span>RESERVAS Y CUMPLIMIENTO LEGAL</span>
        </footer>
      </div>

      <LoginVisual door={door} mood={mood} />
    </div>
  );
}
