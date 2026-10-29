import { vi } from 'vitest';
import { ApiError, apiFetch } from './api';

function stub(body: string, status = 200) {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => sessionStorage.clear());

it('envia o token quando guardado', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  const fn = stub('{"a":1}');
  expect(await apiFetch('/api/x')).toEqual({ a: 1 });
  const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect((init.headers as Record<string, string>)['X-TwinPix-Token']).toBe('tok');
});

it('corpo vazio vira null', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  stub('');
  expect(await apiFetch('/api/x')).toBeNull();
});

it('erro JSON usa mensagem e código do servidor', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  stub('{"message":"Falhou","code":"x"}', 400);
  await expect(apiFetch('/api/x')).rejects.toMatchObject({ message: 'Falhou', code: 'x', status: 400 });
});

it('erro com HTML vira "Erro 502"', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  stub('<html>Bad gateway</html>', 502);
  const err = (await apiFetch("/api/x").catch((e: unknown) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toBe('Erro 502');
});

it('resposta OK que não é JSON vira mensagem clara', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  stub('<html></html>', 200);
  await expect(apiFetch('/api/x')).rejects.toThrow('Resposta inesperada do TwinPix Cloud.');
});

it('401 de sessão mostra mensagem amigável', async () => {
  sessionStorage.setItem('twinpix-token', 'tok');
  stub('{"message":"Sessão inválida","code":"session"}', 401);
  await expect(apiFetch('/api/x')).rejects.toThrow(/Sessão expirada ou ausente/);
});
