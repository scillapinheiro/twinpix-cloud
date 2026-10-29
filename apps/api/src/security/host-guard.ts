import type { RequestHandler } from 'express';

/** Barra requisições cujo cabeçalho Host não é o do app local (DNS rebinding). */
export function hostGuard(allowedHosts: string[]): RequestHandler {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return (req, res, next) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowed.has(host)) {
      res.status(403).json({ message: 'Endereço não permitido.' });
      return;
    }
    next();
  };
}
