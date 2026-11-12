import { Link } from 'react-router';
import './HomePage.css';

/** Pantalla de inicio. Cada caso de uso agrega aquí el acceso a su pantalla. */
export function HomePage() {
  return (
    <section>
      <h1>Recepción</h1>
      <p>Operación de reservas y cumplimiento legal del hotel.</p>
      <ul className="home-links">
        <li>
          <Link className="home-link" to="/reservas">
            Reservas
          </Link>
        </li>
        <li>
          <Link className="home-link" to="/sire">
            Exportar SIRE
          </Link>
        </li>
        <li>
          <Link className="home-link" to="/habitaciones">
            Habitaciones
          </Link>
        </li>
        <li>
          <Link className="home-link" to="/tarifas">
            Tarifas
          </Link>
        </li>
        <li>
          <Link className="home-link" to="/agencias">
            Agencias OTA
          </Link>
        </li>
      </ul>
    </section>
  );
}
