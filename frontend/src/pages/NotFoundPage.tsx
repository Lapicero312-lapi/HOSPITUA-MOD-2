import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section>
      <h1>La página no existe.</h1>
      <Link to="/">Volver al inicio</Link>
    </section>
  );
}
