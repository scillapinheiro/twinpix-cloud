const KEY = 'twinpix-token';

export function captureTokenFromHash(): void {
  const match = window.location.hash.match(/^#token=([^&]+)$/);
  if (!match) return;
  try {
    sessionStorage.setItem(KEY, decodeURIComponent(match[1]));
  } catch {
    // sessionStorage indisponível: a API responderá com sessão inválida.
  }
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
