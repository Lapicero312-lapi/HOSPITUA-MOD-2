import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { currentUser, signOut } from '../services/session.ts';
import { useTheme } from '../services/theme.ts';
import { CommandPalette } from './CommandPalette.tsx';
import {
  BrandGlyph,
  CloseIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SidebarIcon,
  SunIcon,
} from './icons.tsx';
import { LiveClock } from './LiveClock.tsx';
import { crumbsFor, NAV_ITEMS } from './navigation.tsx';
import './Layout.css';

const RAIL_KEY = 'hospitua.rail';

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/**
 * El marco de todas las pantallas de la Recepcionista (Framed Workspace): el rail de navegación sobre el
 * lienzo base, y la pantalla actual dentro de un lienzo enmarcado con una única cabecera contextual.
 */
export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  // En móvil, el drawer queda abierto solo en la pantalla donde se abrió: al navegar se cierra.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === location.pathname;
  const setDrawerOpen = (open: boolean) =>
    setDrawerPath(open ? location.pathname : null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const user = currentUser();
  // En tablet horizontal (md a lg) el rail queda siempre en su versión de iconos.
  const tablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const railCollapsed = collapsed || tablet;

  const leave = () => {
    signOut();
    navigate('/login');
  };

  const toggleRail = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(RAIL_KEY, value ? 'expanded' : 'collapsed');
      } catch {
        // Sin almacenamiento, la preferencia dura hasta recargar.
      }
      return !value;
    });
  };

  // ⌘K / Ctrl K abre la paleta de comandos.
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setDrawerPath(null);
      }
    };
    document.addEventListener('keydown', open);
    return () => document.removeEventListener('keydown', open);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const crumbs = crumbsFor(location.pathname);

  return (
    <div
      className="shell"
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
      data-drawer={drawerOpen ? 'open' : 'closed'}
    >
      <aside className="rail" id="app-rail">
        <div className="rail-top">
          <span className="rail-brand">
            <span className="brand-mark" aria-hidden="true">
              <BrandGlyph />
            </span>
            <span className="rail-brand-name">HOSPITUA · Recepción</span>
          </span>
          <button
            type="button"
            className="icon-button rail-close"
            aria-label="Cerrar el menú"
            onClick={() => setDrawerOpen(false)}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <span className="rail-section">Operación</span>
        <nav aria-label="Principal" className="rail-nav">
          {NAV_ITEMS.map((item) => {
            const ItemIcon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="rail-link"
                data-tooltip={item.label}
              >
                <ItemIcon size={17} className="rail-link-icon" />
                <span className="rail-link-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="rail-bottom">
          <button
            type="button"
            className="rail-action"
            data-tooltip={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            aria-label={
              theme === 'dark'
                ? 'Cambiar a tema claro'
                : 'Cambiar a tema oscuro'
            }
            onClick={toggle}
          >
            {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
            <span className="rail-link-label">
              {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            </span>
          </button>
          <div className="rail-user">
            <span className="rail-avatar" aria-hidden="true">
              {initials(user)}
            </span>
            <span className="rail-user-text">Recepcionista: {user}</span>
            <button
              type="button"
              className="icon-button rail-signout"
              data-tooltip="Salir"
              onClick={leave}
            >
              <LogOutIcon size={16} />
              <span className="visually-hidden">Salir</span>
            </button>
          </div>
        </div>
      </aside>

      <div
        className="rail-veil"
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
      />

      <div className="canvas">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button topbar-menu"
              aria-label="Abrir el menú"
              aria-controls="app-rail"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon size={18} />
            </button>
            <button
              type="button"
              className="icon-button rail-collapse"
              aria-label={collapsed ? 'Expandir el menú' : 'Contraer el menú'}
              aria-expanded={!collapsed}
              onClick={toggleRail}
            >
              <SidebarIcon size={16} />
            </button>
            <ol className="crumbs" aria-label="Ubicación">
              {crumbs.map((crumb, index) => (
                <li
                  key={`${crumb}-${index}`}
                  aria-current={
                    index === crumbs.length - 1 ? 'page' : undefined
                  }
                >
                  {crumb}
                </li>
              ))}
            </ol>
          </div>
          <button
            type="button"
            className="palette-trigger"
            aria-label="Abrir la paleta de comandos"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={15} />
            <span className="palette-trigger-text">Ir a…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="topbar-right">
            <LiveClock />
          </div>
        </header>
        <main className="canvas-main">
          <Outlet />
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

function initials(name: string | null): string {
  if (!name) {
    return '';
  }
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
