import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  if (user) return <Navigate to="/reservas" replace />;
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) { login(name.trim()); nav('/reservas'); } };
  return (
    <form className="panel login" onSubmit={submit}>
      <h2>HOSPITUA · Recepción</h2>
      <p>Ingrese su nombre para registrar las acciones del turno.</p>
      <div className="field"><label htmlFor="n">Nombre de la recepcionista</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <button className="btn primary" disabled={!name.trim()}>Entrar</button>
    </form>
  );
}
