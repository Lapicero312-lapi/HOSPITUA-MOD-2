import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentUser, nameError, signIn, signOut } from './session.ts';

describe('Login simulado', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin nombre guardado no hay Recepcionista', () => {
    expect(currentUser()).toBeNull();
  });

  it('guarda el nombre sin los espacios de los extremos y lo olvida al salir', () => {
    signIn('  Ana Pérez  ');
    expect(currentUser()).toBe('Ana Pérez');

    signOut();
    expect(currentUser()).toBeNull();
  });

  it('si el navegador no deja leer la sesión, no hay Recepcionista', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError');
    });

    expect(currentUser()).toBeNull();
  });

  it('el nombre vacío o de solo espacios pide escribirlo', () => {
    expect(nameError('')).toBe('Escriba su nombre.');
    expect(nameError('   ')).toBe('Escriba su nombre.');
  });

  it('el nombre admite hasta 100 caracteres', () => {
    expect(nameError('a'.repeat(100))).toBeNull();
    expect(nameError('a'.repeat(101))).toBe(
      'El nombre no puede superar 100 caracteres.',
    );
  });
});
