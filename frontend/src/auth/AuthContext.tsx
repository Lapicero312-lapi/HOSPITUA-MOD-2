import { createContext, useContext, useState, type ReactNode } from 'react';
import { setApiUser } from '../services/apiClient';
import { currentUser, signIn, signOut } from '../services/session';

// Login SIMULADO (plan base, regla 10): solo guarda el nombre de la Recepcionista para enviarlo en X-User.
interface Auth {
  user: string | null;
  login: (name: string) => void;
  logout: () => void;
}
const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(() => {
    const saved = currentUser();
    if (saved) setApiUser(saved);
    return saved;
  });
  const login = (name: string) => {
    signIn(name);
    setApiUser(name);
    setUser(name);
  };
  const logout = () => {
    signOut();
    setApiUser('');
    setUser(null);
  };
  return (
    <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>
  );
}
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return c;
}
