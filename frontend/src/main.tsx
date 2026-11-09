import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles.css';
import App from './App.tsx';

async function start() {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
start();
