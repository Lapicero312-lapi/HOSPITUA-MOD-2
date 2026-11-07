import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import Avatar from './Avatar';

// Menú plano, igual que el wireframe.
const NAV: [string, string][] = [
  ['/reservas', 'Reservas'], ['/huespedes', 'Huéspedes alojados'], ['/sire', 'Exportar SIRE'],
  ['/habitaciones', 'Habitaciones'], ['/tarifas', 'Tarifas'], ['/agencias', 'Agencias OTA'],
];
const TITLES: [RegExp, string][] = [
  [/^\/reservas\/nueva/, 'Nueva reserva directa'], [/^\/reservas\/[^/]+\/modificar/, 'Modificar reserva'],
  [/^\/reservas\/[^/]+\/cancelar/, 'Cancelar reserva'], [/^\/reservas\/[^/]+\/habitacion/, 'Asignar habitación'],
  [/^\/reservas\/[^/]+/, 'Detalle de reserva'], [/^\/huespedes/, 'Huéspedes alojados'], [/^\/sire/, 'Exportar SIRE'],
  [/^\/habitaciones/, 'Habitaciones'], [/^\/tarifas/, 'Tarifas'], [/^\/agencias/, 'Agencias OTA'],
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false); // menú lateral en pantallas angostas
  useEffect(() => setOpen(false), [pathname]);
  if (!user) return <Navigate to="/login" replace />;
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Reservas';
  return (
    <div className="shell">
      <nav className={`side${open ? ' open' : ''}`} id="side" aria-label="Principal">
        <div className="brand"><div className="mark">H</div><div className="txt">HOSPITUA<small>Módulo 2 · Recepción</small></div></div>
        {NAV.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}><span>{label}</span></NavLink>)}
      </nav>
      {open && <div className="side-backdrop" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <div>
            <button className="side-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>☰ Menú</button>
            <div className="crumbs">HOSPITUA · Módulo 2</div><h1>{title}</h1>
          </div>
          <div className="who"><Avatar name={user} />{user} · Recepcionista<button className="linkbtn" onClick={logout}>Salir</button></div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
