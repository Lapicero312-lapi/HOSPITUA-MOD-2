import type { ReactNode, SVGProps } from 'react';

/**
 * Iconos de línea fina (trazo 1.75) que heredan `currentColor`. Son decorativos: el texto o el
 * `aria-label` del control que los contiene les da el nombre.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({
  size = 16,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </Icon>
);

export const FileTextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
    <path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5" />
  </Icon>
);

export const BedIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 19V5.5M2.5 15h19M21.5 19v-6a3 3 0 0 0-3-3h-8v5" />
    <circle cx="6.5" cy="11.5" r="2" />
  </Icon>
);

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.25" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19z" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20.5 20.5-4.5-4.5" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
  </Icon>
);

export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
    <path d="M9 3.5v17" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);

export const CornerDownLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 4v7a4 4 0 0 1-4 4H4M9 10l-5 5 5 5" />
  </Icon>
);

/** El isotipo: una H de trazo fino. */
export function BrandGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <path d="M7 4v16M17 4v16M7 12h10" />
    </svg>
  );
}
