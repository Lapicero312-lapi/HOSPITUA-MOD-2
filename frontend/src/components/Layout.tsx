import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { currentUser, signOut } from '../services/session.ts';
import Avatar from './Avatar.tsx';

/**
 * El marco de todas las pantallas de la Recepcionista: el encabezado, la navegación y la pantalla
 * actual. Cada caso de uso agrega su pantalla a la navegación.
 */
export function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const leave = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="shell">
      <nav
        className={`side${menuOpen ? ' open' : ''}`}
        id="side"
        aria-label="Principal"
      >
        <div className="brand">
          <div className="mark">H</div>
          <div className="txt">
            HOSPITUA<small>Módulo 2 · Recepción</small>
          </div>
        </div>
        <NavLink
          className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
          to="/"
          end
          onClick={() => setMenuOpen(false)}
        >
          Inicio
        </NavLink>
        <NavLink
          className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
          to="/otas"
          onClick={() => setMenuOpen(false)}
        >
          Agencias OTA
        </NavLink>
        <NavLink
          className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
          to="/guest-stays"
          onClick={() => setMenuOpen(false)}
        >
          Huéspedes alojados
        </NavLink>
      </nav>
      {menuOpen && (
        <div className="side-backdrop" onClick={() => setMenuOpen(false)} />
      )}
      <div className="main">
        <header className="topbar">
          <div>
            <button
              className="side-toggle"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
            >
              ☰ Menú
            </button>
            <div className="crumbs">HOSPITUA · Recepción</div>
            <h1>
              {pathname === '/otas'
                ? 'Agencias OTA'
                : pathname === '/guest-stays'
                  ? 'Huéspedes alojados'
                  : 'Recepción'}
            </h1>
          </div>
          <div className="who">
            <Avatar name={currentUser() ?? ''} />
            Recepcionista: {currentUser()}
            <button className="linkbtn" type="button" onClick={leave}>
              Salir
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
