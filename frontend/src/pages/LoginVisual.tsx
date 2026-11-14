import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NAV_ITEMS } from '../components/navigation.tsx';

const ZONE = 'America/Bogota';

const TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DATE = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Qué parte del día de Colombia ya pasó (0 a 1). */
function dayProgress(now: Date): number {
  const [hours, minutes] = PARTS.format(now).split(':').map(Number);
  return (hours * 60 + minutes) / (24 * 60);
}

const RING_RADIUS = 34;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * El panel derecho del login: retícula con un foco que sigue al cursor y una composición de tarjetas
 * translúcidas que levitan e inclinan con paralaje. Es decorativo (`aria-hidden`): solo muestra la hora
 * de Colombia y el avance de la jornada.
 */
export function LoginVisual() {
  const panelRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [now, setNow] = useState(() => new Date());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    // El anillo se llena después de montar, para que se vea la animación.
    const start = window.setTimeout(() => setReady(true), 250);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(start);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = panel.getBoundingClientRect();
      const x = clientX - box.left;
      const y = clientY - box.top;
      const nx = x / box.width - 0.5;
      const ny = y / box.height - 0.5;
      panel.style.setProperty('--mx', `${x}px`);
      panel.style.setProperty('--my', `${y}px`);
      panel.style.setProperty('--ry', `${(nx * 6).toFixed(2)}deg`);
      panel.style.setProperty('--rx', `${(-ny * 6).toFixed(2)}deg`);
      panel.dataset.active = 'true';
    });
  };

  const reset = () => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    cancelAnimationFrame(frame.current);
    panel.style.setProperty('--rx', '0deg');
    panel.style.setProperty('--ry', '0deg');
    panel.dataset.active = 'false';
  };

  const progress = dayProgress(now);
  const percent = Math.round(progress * 100);

  return (
    <div
      ref={panelRef}
      className="login-visual"
      aria-hidden="true"
      onPointerMove={track}
      onPointerLeave={reset}
    >
      <div className="login-grid" />
      <div className="login-spotlight" />

      <div className="login-stage">
        <div className="login-stack">
          {/* Jornada: el avance del día */}
          <div
            className="glass glass--ring"
            style={{ '--float-delay': '-1.5s' } as CSSProperties}
          >
            <span className="glass-label">Jornada</span>
            <div className="ring">
              <svg width="84" height="84" viewBox="0 0 84 84">
                <circle
                  className="ring-track"
                  cx="42"
                  cy="42"
                  r={RING_RADIUS}
                />
                <circle
                  className="ring-value"
                  cx="42"
                  cy="42"
                  r={RING_RADIUS}
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={
                    ready ? RING_LENGTH * (1 - progress) : RING_LENGTH
                  }
                />
              </svg>
              <span className="ring-text">
                {percent}
                <small>%</small>
              </span>
            </div>
            <span className="glass-caption">del día transcurrido</span>
          </div>

          {/* Reloj */}
          <div className="glass glass--clock">
            <div className="glass-row">
              <span className="glass-label">Hora de Colombia</span>
              <span className="glass-live">
                <span className="live-dot" />
                En línea
              </span>
            </div>
            <span className="glass-time">{TIME.format(now)}</span>
            <span className="glass-date">{DATE.format(now)}</span>
            <div className="glass-bars">
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  key={hour}
                  className={
                    hour < Math.floor(progress * 24)
                      ? 'is-past'
                      : hour === Math.floor(progress * 24)
                        ? 'is-now'
                        : undefined
                  }
                />
              ))}
            </div>
          </div>

          {/* Módulos */}
          <div
            className="glass glass--modules"
            style={{ '--float-delay': '-3s' } as CSSProperties}
          >
            <span className="glass-label">En un solo lienzo</span>
            <ul>
              {NAV_ITEMS.filter((item) => item.to !== '/').map((item) => {
                const ItemIcon = item.icon;
                return (
                  <li key={item.to}>
                    <ItemIcon size={14} /> {item.label}
                    <span className="glass-dot" />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
