import { NavLink, Outlet } from 'react-router';

/**
 * El marco de todas las pantallas de la Recepcionista: el encabezado, la navegación y la pantalla
 * actual. Cada caso de uso agrega su pantalla a la navegación.
 */
export function Layout() {
  return (
    <div className="layout">
      <header className="layout-header">
        <span className="layout-title">HOSPITUA · Recepción</span>
        <nav aria-label="Principal">
          <NavLink to="/" end>
            Inicio
          </NavLink>
        </nav>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}
