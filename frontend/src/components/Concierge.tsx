import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './Concierge.css';

/**
 * "Túa", el conserje de hospitua (paquete HOSPITUA Login 3D Final, variante SVG sin dependencias):
 * chasis Dark Petroleum con biseles de latón, visor OLED con ojos que siguen al cursor, gorra de
 * conserje y la placa pectoral con la "H" cuya puerta se abre. Es decorativo (`aria-hidden`).
 *
 * Estados: `greeting` (saluda), `attentive` (mira el formulario mientras la Recepcionista escribe),
 * `error` (se sacude con los ojos ámbar) y `success` (se eleva y abre la puerta).
 */
export type ConciergeMood = 'greeting' | 'attentive' | 'error' | 'success';

const BUBBLE: Record<ConciergeMood, string> = {
  greeting: 'Bienvenido a hospitua',
  attentive: 'Bienvenido a hospitua',
  error: 'Revise el nombre',
  success: 'Abriendo recepción',
};

export function Concierge({
  mood = 'greeting',
  size = 220,
  className = '',
}: {
  mood?: ConciergeMood;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Ids propios: puede haber dos conserjes en la página (móvil y escritorio).
  const uid = `tua${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [eyes, setEyes] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);

  // Parpadea cada 3,6 s.
  useEffect(() => {
    let reopen = 0;
    const timer = window.setInterval(() => {
      setBlinking(true);
      reopen = window.setTimeout(() => setBlinking(false), 140);
    }, 3600);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(reopen);
    };
  }, []);

  // Los ojos siguen al cursor; mientras la Recepcionista escribe, miran hacia el formulario.
  useEffect(() => {
    if (mood === 'attentive') {
      return;
    }
    let frame = 0;
    const follow = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) {
          return;
        }
        const dx = (event.clientX - (box.left + box.width / 2)) / 260;
        const dy = (event.clientY - (box.top + box.height / 2)) / 260;
        setEyes({
          x: Math.max(-1, Math.min(1, dx)) * 5.2,
          y: Math.max(-1, Math.min(1, dy)) * 3.8,
        });
      });
    };
    window.addEventListener('mousemove', follow);
    return () => {
      window.removeEventListener('mousemove', follow);
      cancelAnimationFrame(frame);
    };
  }, [mood]);

  // Mientras se escribe, mira hacia el formulario (a su izquierda).
  const gaze = mood === 'attentive' ? { x: -4.5, y: 3.5 } : eyes;
  const happy = mood === 'greeting' || mood === 'success';
  const error = mood === 'error';
  const success = mood === 'success';

  const eye = (cx: number) =>
    happy ? (
      <path
        d={`M${cx - 6.5} 86C${cx - 3.5} 80.5 ${cx + 3.5} 80.5 ${cx + 6.5} 86`}
        stroke="#F5E4B8"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    ) : blinking ? (
      <line
        x1={cx - 7.5}
        y1="86"
        x2={cx + 7.5}
        y2="86"
        stroke="#F7F5F0"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    ) : (
      <g>
        <circle cx={cx} cy="86" r="7.5" fill="#F7F5F0" />
        <circle
          cx={cx + 1}
          cy="86"
          r="3.6"
          fill={error ? '#D97706' : '#123B46'}
        />
        <circle cx={cx + 2.7} cy="84" r="1.4" fill="#B89B5E" />
      </g>
    );

  return (
    <div
      ref={ref}
      className={`concierge concierge--${mood} ${className}`}
      aria-hidden="true"
      style={{ '--concierge-size': `${size}px` } as CSSProperties}
    >
      <div key={mood} className="concierge-bubble">
        <span className="concierge-bubble-dot" />
        {BUBBLE[mood]}
      </div>

      <div className="concierge-figure">
        <svg viewBox="0 0 220 226" fill="none" focusable="false">
          <defs>
            <linearGradient
              id={`${uid}-tuaShell`}
              x1="48"
              y1="44"
              x2="176"
              y2="178"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#265B69" />
              <stop offset="28%" stopColor="#123B46" />
              <stop offset="78%" stopColor="#0C2A33" />
              <stop offset="100%" stopColor="#1D4E5B" />
            </linearGradient>
            <linearGradient
              id={`${uid}-tuaGold`}
              x1="45"
              y1="42"
              x2="178"
              y2="180"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#EAD6A6" />
              <stop offset="35%" stopColor="#B89B5E" />
              <stop offset="70%" stopColor="#7C6330" />
              <stop offset="100%" stopColor="#DFC68E" />
            </linearGradient>
            <linearGradient id={`${uid}-tuaLimb`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#468D97" />
              <stop offset="50%" stopColor="#2E6870" />
              <stop offset="100%" stopColor="#183D43" />
            </linearGradient>
            <linearGradient
              id={`${uid}-tuaVisor`}
              x1="65"
              y1="62"
              x2="155"
              y2="112"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#2C3539" />
              <stop offset="45%" stopColor="#161B1D" />
              <stop offset="100%" stopColor="#0E1214" />
            </linearGradient>
            <linearGradient
              id={`${uid}-tuaSheen`}
              x1="68"
              y1="64"
              x2="128"
              y2="108"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id={`${uid}-tuaCap`}
              x1="76"
              y1="24"
              x2="144"
              y2="48"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#384348" />
              <stop offset="55%" stopColor="#20272A" />
              <stop offset="100%" stopColor="#111517" />
            </linearGradient>
            <radialGradient id={`${uid}-tuaPlinth`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#123B46" stopOpacity="0.45" />
              <stop offset="70%" stopColor="#123B46" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#123B46" stopOpacity="0" />
            </radialGradient>
            <filter
              id={`${uid}-tuaGlow`}
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter
              id={`${uid}-tuaShadow`}
              x="-20%"
              y="-20%"
              width="140%"
              height="145%"
            >
              <feDropShadow
                dx="0"
                dy="10"
                stdDeviation="8"
                floodColor="#091C22"
                floodOpacity="0.38"
              />
            </filter>
          </defs>

          {/* Pedestal */}
          <ellipse
            className="concierge-plinth"
            cx="110"
            cy="208"
            rx="64"
            ry="11"
            fill={`url(#${uid}-tuaPlinth)`}
          />
          <ellipse
            cx="110"
            cy="206"
            rx="46"
            ry="6.5"
            stroke={`url(#${uid}-tuaGold)`}
            strokeWidth="1.2"
            strokeOpacity="0.65"
          />

          <g className="concierge-float" filter={`url(#${uid}-tuaShadow)`}>
            <g className="concierge-body">
              {/* Antena */}
              <rect
                x="108"
                y="18"
                width="4"
                height="14"
                rx="2"
                fill={`url(#${uid}-tuaGold)`}
              />
              <circle
                cx="110"
                cy="15"
                r="5"
                fill={
                  success
                    ? '#10B981'
                    : error
                      ? '#D97706'
                      : `url(#${uid}-tuaGold)`
                }
                filter={`url(#${uid}-tuaGlow)`}
              />
              <circle
                cx="108.5"
                cy="13.5"
                r="1.5"
                fill="#FFFDF7"
                fillOpacity="0.85"
              />

              {/* Gorra de conserje */}
              <path
                d="M78 39C78 31.5 84.5 26 92 26H128C135.5 26 142 31.5 142 39V44H78V39Z"
                fill={`url(#${uid}-tuaCap)`}
              />
              <rect
                x="78"
                y="39"
                width="64"
                height="4.5"
                fill={`url(#${uid}-tuaGold)`}
              />
              <circle cx="110" cy="33" r="2.6" fill={`url(#${uid}-tuaGold)`} />
              <path
                d="M70 44H150C152 44 153 45.8 151.8 47.4C148.5 50.6 132 52 110 52C88 52 71.5 50.6 68.2 47.4C67 45.8 68 44 70 44Z"
                fill="#0D2830"
                stroke={`url(#${uid}-tuaGold)`}
                strokeWidth="0.9"
              />

              {/* Chasis */}
              <rect
                x="56"
                y="49"
                width="108"
                height="126"
                rx="28"
                fill={`url(#${uid}-tuaShell)`}
                stroke={`url(#${uid}-tuaGold)`}
                strokeWidth="2.2"
              />
              <path
                d="M84 51.5H136"
                stroke="#86C5D1"
                strokeOpacity="0.55"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M60 116H160" stroke="#081C22" strokeWidth="1.6" />
              <path
                d="M60 117.5H160"
                stroke="#3C7E8B"
                strokeOpacity="0.35"
                strokeWidth="0.9"
              />

              {/* Auriculares */}
              <rect
                x="50"
                y="76"
                width="6"
                height="22"
                rx="3"
                fill={`url(#${uid}-tuaGold)`}
              />
              <rect
                x="164"
                y="76"
                width="6"
                height="22"
                rx="3"
                fill={`url(#${uid}-tuaGold)`}
              />

              {/* Visor OLED */}
              <rect
                x="67"
                y="63"
                width="86"
                height="46"
                rx="15"
                fill={`url(#${uid}-tuaVisor)`}
                stroke={error ? '#D97706' : `url(#${uid}-tuaGold)`}
                strokeWidth="1.5"
              />

              {/* Ojos */}
              <g
                filter={`url(#${uid}-tuaGlow)`}
                className="concierge-eyes"
                style={{ transform: `translate(${gaze.x}px, ${gaze.y}px)` }}
              >
                {eye(91.5)}
                {eye(128.5)}
              </g>

              {/* Boca */}
              {happy ? (
                <path
                  d="M103 98C106.5 101.5 113.5 101.5 117 98"
                  stroke="#B89B5E"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              ) : error ? (
                <path
                  d="M104 100C107.5 97 112.5 97 116 100"
                  stroke="#D97706"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              ) : (
                <line
                  x1="105"
                  y1="99"
                  x2="115"
                  y2="99"
                  stroke="#2E6870"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              )}

              {/* Reflejo del vidrio */}
              <path
                d="M74 65H124L104 107H74C70 107 69 103 69 99V71C69 67 71 65 74 65Z"
                fill={`url(#${uid}-tuaSheen)`}
                pointerEvents="none"
              />

              {/* Placa pectoral con la H y su puerta */}
              <g transform="translate(89, 125)">
                <rect
                  x="-4"
                  y="-3"
                  width="50"
                  height="40"
                  rx="8"
                  fill="#0B2229"
                  stroke="#2E6870"
                  strokeOpacity="0.45"
                />
                <rect
                  x="3"
                  y="2"
                  width="9"
                  height="30"
                  rx="1.5"
                  fill="#F7F5F0"
                />
                <rect
                  x="30"
                  y="2"
                  width="9"
                  height="30"
                  rx="1.5"
                  fill="#F7F5F0"
                />
                <rect x="12" y="12" width="18" height="6" fill="#F7F5F0" />
                <rect
                  className="concierge-door-light"
                  x="12"
                  y="18"
                  width="18"
                  height="14"
                  fill="#F5E1A4"
                />
                <g className="concierge-door">
                  <polygon
                    points="12,18 30,19.5 30,33.5 12,32"
                    fill={`url(#${uid}-tuaGold)`}
                  />
                  <circle cx="27" cy="26" r="1.2" fill="#123B46" />
                </g>
              </g>
            </g>

            {/* Brazo izquierdo: saluda */}
            <g className="concierge-arm concierge-arm--left">
              <circle cx="48" cy="118" r="6" fill={`url(#${uid}-tuaGold)`} />
              <rect
                x="26"
                y="112"
                width="24"
                height="34"
                rx="12"
                fill={`url(#${uid}-tuaLimb)`}
                stroke={`url(#${uid}-tuaGold)`}
                strokeWidth="1.6"
              />
              <line
                x1="34"
                y1="122"
                x2="34"
                y2="136"
                stroke="#F7F5F0"
                strokeOpacity="0.45"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="41"
                y1="122"
                x2="41"
                y2="136"
                stroke="#F7F5F0"
                strokeOpacity="0.45"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>

            {/* Brazo derecho */}
            <g className="concierge-arm concierge-arm--right">
              <circle cx="172" cy="118" r="6" fill={`url(#${uid}-tuaGold)`} />
              <rect
                x="170"
                y="112"
                width="24"
                height="34"
                rx="12"
                fill={`url(#${uid}-tuaLimb)`}
                stroke={`url(#${uid}-tuaGold)`}
                strokeWidth="1.6"
              />
              <line
                x1="179"
                y1="122"
                x2="179"
                y2="136"
                stroke="#F7F5F0"
                strokeOpacity="0.45"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="186"
                y1="122"
                x2="186"
                y2="136"
                stroke="#F7F5F0"
                strokeOpacity="0.45"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
