import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { hostGuard } from './host-guard';

function app() {
  const a = express();
  a.use(hostGuard(['127.0.0.1:4317', 'localhost:4317']));
  a.get('/', (_req, res) => { res.send('ok'); });
  return a;
}

describe('hostGuard', () => {
  it('aceita host permitido', async () => {
    await request(app()).get('/').set('Host', '127.0.0.1:4317').expect(200);
  });

  it('recusa host de outro site', async () => {
    await request(app()).get('/').set('Host', 'evil.example:4317').expect(403);
  });

  it('ignora maiúsculas', async () => {
    await request(app()).get('/').set('Host', 'LOCALHOST:4317').expect(200);
  });
});
