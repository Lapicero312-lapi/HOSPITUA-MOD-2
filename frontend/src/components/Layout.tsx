import { NavLink, Outlet, useNavigate } from 'react-router';
import { currentUser, signOut } from '../services/session.ts';

/**
 * El marco de todas las pantallas de la Recepcionista: el encabezado, la navegación y la pantalla
 * actual. Cada caso de uso agrega su pantalla a la navegación.
 */
export function Layout() {
  const navigate = useNavigate();

  const leave = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="layout-header">
        <span className="layout-title">HOSPITUA · Recepción</span>
        <nav aria-label="Principal">
          <NavLink to="/" end>
            Inicio
          </NavLink>
        </nav>
        <span className="layout-user">
          Recepcionista: {currentUser()}
          <button type="button" onClick={leave}>
            Salir
          </button>
        </span>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}
