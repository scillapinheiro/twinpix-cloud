import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';

export const SESSION_HEADER = 'x-twinpix-token';
const EXEMPT = new Set(['/api/auth/login', '/api/auth/callback']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionMiddleware(token: string, allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    const path = req.path.toLowerCase();
    if (!(path === '/api' || path.startsWith('/api/')) || EXEMPT.has(path)) return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ message: 'Origem não permitida.' });
      return;
    }
    const given = req.headers[SESSION_HEADER];
    if (typeof given !== 'string' || !safeEqual(given, token)) {
      res.status(401).json({
        message: 'Sessão inválida. Abra o TwinPix Cloud pelo endereço mostrado no terminal.',
        code: 'session',
      });
      return;
    }
    next();
  };
}
