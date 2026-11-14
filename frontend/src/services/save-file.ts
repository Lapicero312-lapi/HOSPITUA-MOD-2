/**
 * Guarda un archivo en el computador de la Recepcionista, como una descarga del navegador, con el nombre
 * `fileName`.
 */
export function saveFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera después de que el navegador tomó la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
