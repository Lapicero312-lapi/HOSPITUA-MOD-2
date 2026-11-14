import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatedLogo, type DoorState } from '../components/brand.tsx';
import {
  CalendarIcon,
  DoorCheckInIcon,
  KeycardIcon,
} from '../components/icons.tsx';
import backdrop from '../assets/login-backdrop-petroleum-grid.png';

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

/** Qué parte del día de Colombia ya pasó, de 0 a 100. */
function dayPercent(now: Date): number {
  const [hours, minutes] = PARTS.format(now).split(':').map(Number);
  return Math.round(((hours * 60 + minutes) / (24 * 60)) * 100);
}

/**
 * El panel derecho del login (The Threshold Experience del paquete visual): Dark Petroleum con la
 * retícula arquitectónica, un foco que sigue al cursor, la tarjeta llave digital con inclinación 3D y
 * brillo dorado, y tres píldoras que flotan. Es decorativo (`aria-hidden`) y solo muestra datos reales:
 * la hora y el día de Colombia y el avance de la jornada.
 */
export function LoginVisual({ door }: { door: DoorState }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearInterval(timer);
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
      panel.style.setProperty('--mx', `${x}px`);
      panel.style.setProperty('--my', `${y}px`);
      panel.style.setProperty(
        '--ry',
        `${((x / box.width - 0.5) * 14).toFixed(2)}deg`,
      );
      panel.style.setProperty(
        '--rx',
        `${((y / box.height - 0.5) * -14).toFixed(2)}deg`,
      );
    });
  };

  const reset = () => {
    cancelAnimationFrame(frame.current);
    panelRef.current?.style.setProperty('--rx', '0deg');
    panelRef.current?.style.setProperty('--ry', '0deg');
  };

  const date = DATE.format(now);

  return (
    <div
      ref={panelRef}
      className="threshold"
      aria-hidden="true"
      onPointerMove={track}
      onPointerLeave={reset}
      style={{ '--backdrop': `url(${backdrop})` } as CSSProperties}
    >
      <div className="threshold-backdrop" />
      <div className="threshold-grid" />
      <div className="threshold-spotlight" />

      <div className="threshold-stage">
        <div className="pill pill--top">
          <span className="pill-icon">
            <DoorCheckInIcon size={16} />
          </span>
          <span>
            <span className="pill-label">Día operativo</span>
            <span className="pill-value pill-value--date">{date}</span>
          </span>
        </div>

        <div className="keycard">
          <span className="keycard-shimmer" />
          <div className="keycard-row">
            <AnimatedLogo door={door} variant="dark" size={26} />
            <span className="keycard-tag">Front desk</span>
          </div>
          <div className="keycard-row keycard-row--chip">
            <span className="keycard-chip">
              <span />
              <span />
            </span>
            <KeycardIcon size={26} className="keycard-wave" />
          </div>
          <div className="keycard-foot">
            <span className="keycard-terminal">
              Terminal recepción · Módulo 2
            </span>
            <span className="keycard-row">
              <span className="keycard-time">{TIME.format(now)}</span>
              <span className="keycard-live">
                <span className="keycard-live-dot" />
                En línea
              </span>
            </span>
          </div>
        </div>

        <div className="pill pill--bottom">
          <span className="pill-icon">
            <CalendarIcon size={16} />
          </span>
          <span>
            <span className="pill-label">Jornada</span>
            <span className="pill-value">
              {dayPercent(now)} % del día transcurrido
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
