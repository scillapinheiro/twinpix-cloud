import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sessionMiddleware } from './session.middleware';

function app() {
  const a = express();
  a.use(sessionMiddleware('segredo', ['http://127.0.0.1:4317']));
  a.get('/api/coisa', (_req, res) => { res.json({ ok: true }); });
  a.get('/api/auth/login', (_req, res) => { res.json({ login: true }); });
  a.get('/index.html', (_req, res) => { res.send('ok'); });
  return a;
}

describe('sessionMiddleware', () => {
  it('recusa API sem token', async () => {
    await request(app()).get('/api/coisa').expect(401);
  });

  it('recusa token errado', async () => {
    await request(app()).get('/api/coisa').set('X-TwinPix-Token', 'outro').expect(401);
  });

  it('aceita token certo', async () => {
    await request(app()).get('/api/coisa').set('X-TwinPix-Token', 'segredo').expect(200);
  });

  it('recusa origem de outro site mesmo com token', async () => {
    await request(app())
      .get('/api/coisa')
      .set('X-TwinPix-Token', 'segredo')
      .set('Origin', 'https://site-malicioso.example')
      .expect(403);
  });

  it('deixa passar login e arquivos estáticos', async () => {
    await request(app()).get('/api/auth/login').expect(200);
    await request(app()).get('/index.html').expect(200);
  });
});
