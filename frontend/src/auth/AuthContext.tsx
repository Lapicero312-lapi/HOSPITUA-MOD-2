import { createContext, useContext, useState, type ReactNode } from 'react';
import { setApiUser } from '../services/apiClient';

// Login SIMULADO (plan base, regla 10): solo guarda el nombre de la Recepcionista para enviarlo en X-User.
interface Auth { user: string | null; login: (name: string) => void; logout: () => void }
const Ctx = createContext<Auth | null>(null);
const KEY = 'hospitua.user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(() => {
    const saved = sessionStorage.getItem(KEY);
    if (saved) setApiUser(saved);
    return saved;
  });
  const login = (name: string) => { sessionStorage.setItem(KEY, name); setApiUser(name); setUser(name); };
  const logout = () => { sessionStorage.removeItem(KEY); setApiUser(''); setUser(null); };
  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return c;
}
