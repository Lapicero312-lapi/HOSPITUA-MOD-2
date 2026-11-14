import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRightIcon, CornerDownLeftIcon, SearchIcon } from './icons.tsx';
import { NAV_ITEMS } from './navigation.tsx';

/**
 * Paleta de comandos (⌘K / Ctrl K): lleva a cualquier pantalla escribiendo su nombre. Solo navega; no
 * busca datos.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const term = normalize(query.trim());
    if (term === '') {
      return NAV_ITEMS;
    }
    return NAV_ITEMS.filter((item) =>
      normalize(`${item.label} ${item.description}`).includes(term),
    );
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active].to);
    }
  };

  return (
    <div className="palette-veil" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Ir a una pantalla…"
            aria-label="Ir a una pantalla"
            aria-controls={listId}
            aria-activedescendant={
              results[active] ? `${listId}-${active}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>ESC</kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox">
          {results.length === 0 && (
            <li className="palette-empty">Ninguna pantalla coincide.</li>
          )}
          {results.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <li
                key={item.to}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className="palette-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.to)}
              >
                <span className="palette-item-icon">
                  <ItemIcon size={16} />
                </span>
                <span className="palette-item-text">
                  <span className="palette-item-label">{item.label}</span>
                  <span className="palette-item-description">
                    {item.description}
                  </span>
                </span>
                {index === active ? (
                  <kbd>
                    <CornerDownLeftIcon size={11} />
                  </kbd>
                ) : (
                  <ArrowRightIcon size={14} className="palette-item-arrow" />
                )}
              </li>
            );
          })}
        </ul>
        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>↵</kbd> abrir
          </span>
        </footer>
      </div>
    </div>
  );
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
