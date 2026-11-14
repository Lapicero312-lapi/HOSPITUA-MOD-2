/**
 * La marca hospitua v2 (01_BRAND_IDENTITY_SVGS y HospituaAnimatedLogo del paquete visual): la "H"
 * geométrica cuyo vano inferior es una puerta entreabierta con su manija. Son decorativos: el texto de
 * la pantalla da el nombre.
 */

export type DoorState = 'closed' | 'peek' | 'open';

/** El isotipo en su squircle de Dark Petroleum, con la puerta dorada (rail, favicon). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
    >
      <rect
        width="120"
        height="120"
        rx="26"
        fill="#123B46"
        stroke="#B89B5E"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <rect x="29" y="22" width="20" height="74" fill="#F7F5F0" />
      <rect x="71" y="22" width="20" height="74" fill="#F7F5F0" />
      <rect x="49" y="48" width="22" height="15" fill="#F7F5F0" />
      <polygon points="49,63 71,67 71,101 49,96" fill="#B89B5E" />
      <circle cx="66.5" cy="83" r="1.9" fill="#123B46" />
    </svg>
  );
}

/**
 * El logo con la puerta que se mueve: `closed`, `peek` (entreabierta, 24°) u `open` (58°), con la luz
 * dorada que se escapa por el vano. `light` va sobre Ivory; `dark`, sobre Dark Petroleum.
 */
export function AnimatedLogo({
  door = 'peek',
  variant = 'light',
  size = 40,
  wordmark = true,
}: {
  door?: DoorState;
  variant?: 'light' | 'dark';
  size?: number;
  wordmark?: boolean;
}) {
  return (
    <span
      className={`hl-logo hl-logo--${variant}`}
      data-door={door}
      aria-hidden="true"
      style={{ '--hl-size': `${size}px` } as React.CSSProperties}
    >
      <span className="hl-logo-mark">
        <span className="hl-logo-glow" />
        <svg viewBox="0 0 100 100" fill="none" focusable="false">
          <rect className="hl-pillar" x="14" y="10" width="23" height="80" />
          <rect className="hl-pillar" x="63" y="10" width="23" height="80" />
          <rect className="hl-pillar" x="37" y="38" width="26" height="17" />
          <rect className="hl-light" x="37" y="55" width="26" height="35" />
          <g className="hl-door">
            <polygon
              className="hl-door-leaf"
              points="37,55 63,58 63,94 37,90"
            />
            <circle className="hl-door-handle" cx="58" cy="75" r="2.1" />
          </g>
        </svg>
      </span>
      {wordmark && <span className="hl-wordmark">hospitua</span>}
    </span>
  );
}
