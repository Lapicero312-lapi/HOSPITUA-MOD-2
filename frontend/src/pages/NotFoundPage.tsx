import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="ui-page">
      <div className="ui-panel ui-empty">
        <span className="ui-empty-code">404</span>
        <h1 className="ui-page-title">La página no existe.</h1>
        <Link className="ui-link-button" to="/">
          Volver al inicio
        </Link>
      </div>
    </section>
  );
}
