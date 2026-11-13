import { useState } from 'react';
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router';
import { currentUser, signOut } from '../services/session.ts';
import Avatar from './Avatar.tsx';

// Menú plano, igual que el wireframe.
const NAV: [string, string][] = [
  ['/reservas', 'Reservas'],
  ['/huespedes', 'Huéspedes alojados'],
  ['/sire', 'Exportar SIRE'],
  ['/habitaciones', 'Habitaciones'],
  ['/tarifas', 'Tarifas'],
  ['/agencias', 'Agencias OTA'],
];
export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = currentUser();

  // El menú lateral en pantallas angostas se abre para la ruta actual.
  // Si cambia la ruta (pathname), el menú queda cerrado automáticamente al comparar openPath === pathname,
  // sin necesidad de useEffect ni llamadas a setState en efectos.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  if (!user) return <Navigate to="/login" replace />;

  const logout = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="shell">
      <nav
        className={`side${open ? ' open' : ''}`}
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
          to="/"
          end
          className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
        >
          <span>Inicio</span>
        </NavLink>
        {NAV.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
          >
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {open && (
        <div className="side-backdrop" onClick={() => setOpenPath(null)} />
      )}
      <div className="main">
        <header className="topbar">
          <div>
            <button
              className="side-toggle"
              onClick={() => setOpenPath(open ? null : pathname)}
              aria-expanded={open}
            >
              ☰ Menú
            </button>
            <div className="crumbs">HOSPITUA · Recepción</div>
          </div>
          <div className="who">
            <Avatar name={user} />
            Recepcionista: {user}
            <button className="linkbtn" onClick={logout}>
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
