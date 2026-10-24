import { Link, useRouteError } from 'react-router';
import { ErrorMessage } from '../components/ErrorMessage.tsx';

/** Se muestra si una pantalla falla al cargarse o al mostrarse, en vez de dejar la página en blanco. */
export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <section className="layout-main">
      <h1>No se pudo mostrar la pantalla.</h1>
      <ErrorMessage error={error} />
      <Link to="/">Volver al inicio</Link>
    </section>
  );
}
