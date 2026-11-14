import type { ComponentType, SVGProps } from 'react';
import {
  BedIcon,
  CalendarIcon,
  UsersIcon,
  FileTextIcon,
  GlobeIcon,
  HomeIcon,
  TagIcon,
} from './icons.tsx';

/** Las pantallas de la Recepcionista: las usan el rail, la paleta de comandos y la cabecera. */
export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
};

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Inicio',
    end: true,
    icon: HomeIcon,
  },
  {
    to: '/reservas',
    label: 'Reservas',
    end: true,
    icon: CalendarIcon,
  },
  {
    to: '/huespedes',
    label: 'Huéspedes alojados',
    icon: UsersIcon,
  },
  {
    to: '/sire',
    label: 'Exportar SIRE',
    icon: FileTextIcon,
  },
  {
    to: '/habitaciones',
    label: 'Habitaciones',
    icon: BedIcon,
  },
  {
    to: '/tarifas',
    label: 'Tarifas',
    icon: TagIcon,
  },
  {
    to: '/agencias',
    label: 'Agencias OTA',
    icon: GlobeIcon,
  },
];

/** La ruta de migas de la pantalla actual, para la cabecera. */
export function crumbsFor(pathname: string): string[] {
  if (pathname === '/') {
    return ['Inicio'];
  }
  if (pathname.startsWith('/reservas/nueva')) {
    return ['Reservas', 'Nueva reserva directa'];
  }
  const reservation = pathname.match(/^\/reservas\/([^/]+)(\/cancelar)?\/?$/);
  if (reservation) {
    const ref = decodeURIComponent(reservation[1]);
    return reservation[2] ? ['Reservas', ref, 'Cancelar'] : ['Reservas', ref];
  }
  const modify = pathname.match(/^\/reservas\/([^/]+)\/modificar\/?$/);
  if (modify) {
    return ['Reservas', decodeURIComponent(modify[1]), 'Modificar'];
  }
  const item = NAV_ITEMS.find(
    (nav) => nav.to !== '/' && pathname.startsWith(nav.to),
  );
  return [item?.label ?? 'Página no encontrada'];
}
