import type { ComponentType, SVGProps } from 'react';
import {
  BedIcon,
  CalendarIcon,
  FileTextIcon,
  GlobeIcon,
  HomeIcon,
  TagIcon,
} from './icons.tsx';

/** Las pantallas de la Recepcionista: las usan el rail, la paleta de comandos y la cabecera. */
export type NavItem = {
  to: string;
  label: string;
  description: string;
  end?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
};

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Inicio',
    description: 'Accesos de la recepción',
    end: true,
    icon: HomeIcon,
  },
  {
    to: '/reservas',
    label: 'Reservas',
    description: 'Consultar, filtrar y abrir reservas',
    end: true,
    icon: CalendarIcon,
  },
  {
    to: '/sire',
    label: 'Exportar SIRE',
    description: 'Movimientos migratorios y archivo .TXT',
    icon: FileTextIcon,
  },
  {
    to: '/habitaciones',
    label: 'Habitaciones',
    description: 'Inventario, capacidad y mantenimiento',
    icon: BedIcon,
  },
  {
    to: '/tarifas',
    label: 'Tarifas',
    description: 'Tarifas de referencia por categoría',
    icon: TagIcon,
  },
  {
    to: '/agencias',
    label: 'Agencias OTA',
    description: 'Comisiones y conexión con Channex',
    icon: GlobeIcon,
  },
];

/** La ruta de migas de la pantalla actual, para la cabecera. */
export function crumbsFor(pathname: string): string[] {
  if (pathname === '/') {
    return ['Inicio'];
  }
  const reservation = pathname.match(/^\/reservas\/([^/]+)(\/cancelar)?\/?$/);
  if (reservation) {
    const ref = decodeURIComponent(reservation[1]);
    return reservation[2] ? ['Reservas', ref, 'Cancelar'] : ['Reservas', ref];
  }
  const item = NAV_ITEMS.find(
    (nav) => nav.to !== '/' && pathname.startsWith(nav.to),
  );
  return [item?.label ?? 'Página no encontrada'];
}
