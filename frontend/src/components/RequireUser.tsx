import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { currentUser } from '../services/session.ts';

/** Sin el nombre de la Recepcionista, lleva al login y después vuelve a la pantalla pedida. */
export function RequireUser({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!currentUser()) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return children;
}
