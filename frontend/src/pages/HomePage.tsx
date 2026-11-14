import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon } from '../components/icons.tsx';
import { NAV_ITEMS } from '../components/navigation.tsx';
import { currentUser } from '../services/session.ts';
import './HomePage.css';

const TODAY = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Pantalla de inicio. Cada caso de uso agrega aquí el acceso a su pantalla. */
export function HomePage() {
  const user = currentUser();
  const [today] = useState(() => TODAY.format(new Date()));
  const screens = NAV_ITEMS.filter((item) => item.to !== '/');

  return (
    <section className="ui-page home">
      <header className="home-hero">
        <span className="ui-eyebrow home-date">{today}</span>
        <h1 className="ui-page-title home-title">Recepción</h1>
        <p className="ui-page-subtitle">
          Operación de reservas y cumplimiento legal del hotel.
          {user ? ` Turno de ${user}.` : ''}
        </p>
      </header>
      <ul className="home-links">
        {screens.map((item, index) => {
          const ItemIcon = item.icon;
          const descriptionId = `home-link-${index}`;
          return (
            <li key={item.to}>
              <Link
                className="home-link"
                to={item.to}
                aria-label={item.label}
                aria-describedby={descriptionId}
              >
                <span className="home-link-icon">
                  <ItemIcon size={18} />
                </span>
                <span className="home-link-text">
                  <span className="home-link-label">{item.label}</span>
                  <span className="home-link-description" id={descriptionId}>
                    {item.description}
                  </span>
                </span>
                <ArrowRightIcon size={16} className="home-link-arrow" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
