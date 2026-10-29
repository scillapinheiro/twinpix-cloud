import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../errors';
import { GraphClient } from './graph-client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

function setup(responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('sem resposta configurada');
    if (next instanceof Error) throw next;
    return next;
  });
  const tokens = { getAccessToken: vi.fn(async (force: boolean) => (force ? 'novo' : 'velho')) };
  const sleep = vi.fn(async (_ms: number) => {});
  const client = new GraphClient(tokens, { fetch: fetchMock as unknown as typeof fetch, sleep, maxRetries: 3 });
  return { client, fetchMock, tokens, sleep };
}

describe('GraphClient', () => {
  it('respeita Retry-After no 429 e tenta de novo', async () => {
    const { client, sleep } = setup([json(429, {}, { 'Retry-After': '7' }), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/me/drive/root')).resolves.toEqual({ status: 200, data: { ok: 1 } });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('503 sem Retry-After usa backoff exponencial', async () => {
    const { client, sleep } = setup([json(503, {}), json(503, {}), json(200, {})]);
    await client.request('GET', '/x');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('401 renova o token uma vez', async () => {
    const { client, tokens } = setup([json(401, {}), json(200, {})]);
    await client.request('GET', '/x');
    expect(tokens.getAccessToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });

  it('401 de novo depois de renovar pede reconexão', async () => {
    const { client } = setup([json(401, {}), json(401, {})]);
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('falha de rede vira OfflineError', async () => {
    const { client } = setup([new TypeError('fetch failed')]);
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(OfflineError);
  });

  it('403 vira ForbiddenError; 404 e 409 voltam como status', async () => {
    const a = setup([json(403, {})]);
    await expect(a.client.request('GET', '/x')).rejects.toBeInstanceOf(ForbiddenError);
    const b = setup([json(404, {}), json(409, {})]);
    await expect(b.client.request('GET', '/x')).resolves.toEqual({ status: 404, data: null });
    await expect(b.client.request('POST', '/x', {})).resolves.toEqual({ status: 409, data: null });
  });

  it('usa a URL completa quando recebe um nextLink', async () => {
    const { client, fetchMock } = setup([json(200, {})]);
    await client.request('GET', 'https://graph.microsoft.com/v1.0/me/drive/items/1/children?$skiptoken=abc');
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/1/children?$skiptoken=abc');
  });

  it('recusa URL absoluta fora do Graph sem chamar fetch', async () => {
    const { client, fetchMock } = setup([json(200, {})]);
    await expect(client.request('GET', 'https://evil.example.com/x')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
