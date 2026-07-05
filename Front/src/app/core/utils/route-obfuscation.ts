// Ofuscación superficial del module code / form slug en la URL — NO es
// cifrado (btoa/atob son triviales de revertir desde la consola), solo
// evita que se vea a simple vista. Un único lugar para el formato de
// codificación, así encode/decode nunca divergen.
const SEPARATOR = '::';

export function encodeFormRoute(moduleCode: string, formSlug: string): string {
  return btoa(`${moduleCode}${SEPARATOR}${formSlug}`);
}

export function decodeFormRoute(data: string | null): { moduleCode: string; formSlug: string } | null {
  if (!data) return null;
  try {
    const [moduleCode, formSlug] = atob(data).split(SEPARATOR);
    return moduleCode && formSlug ? { moduleCode, formSlug } : null;
  } catch {
    return null;
  }
}
