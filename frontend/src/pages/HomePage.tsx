import { Link } from 'react-router';

/** Pantalla de inicio. Cada caso de uso agrega aquí el acceso a su pantalla. */
export function HomePage() {
  return (
    <section>
      <h1>Recepción</h1>
      <p>Operación de reservas y cumplimiento legal del hotel.</p>
      <ul>
        <li>
          <Link to="/habitaciones">Habitaciones</Link>
        </li>
      </ul>
    </section>
  );
}
