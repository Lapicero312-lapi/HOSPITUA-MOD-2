import { Link, useRouteError } from 'react-router';
import { ErrorMessage } from '../components/ErrorMessage.tsx';

/** Se muestra si una pantalla falla al cargarse o al mostrarse, en vez de dejar la página en blanco. */
export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <section className="route-error">
      <div className="ui-panel ui-empty">
        <h1 className="ui-page-title">No se pudo mostrar la pantalla.</h1>
        <ErrorMessage error={error} />
        <Link className="ui-link-button" to="/">
          Volver al inicio
        </Link>
      </div>
    </section>
  );
}
