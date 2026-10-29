import { describe, expect, it, vi } from 'vitest';
import { InteractionRequiredAuthError } from '@azure/msal-node';
import { OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { loadConfig } from '../config';
import { AuthService } from './auth.service';

function fakePca(accounts: Array<{ name?: string; username: string }>, silent?: () => Promise<unknown>) {
  return {
    getTokenCache: () => ({ getAllAccounts: async () => accounts, removeAccount: vi.fn(async () => {}) }),
    acquireTokenSilent: vi.fn(silent ?? (async () => ({ accessToken: 'tok' }))),
    getAuthCodeUrl: vi.fn(async (_req: unknown) => 'https://login.microsoftonline.com/authorize?x'),
    acquireTokenByCode: vi.fn(async () => ({ accessToken: 'tok' })),
  };
}

const config = loadConfig({ TWINPIX_DATA_DIR: '/tmp/twinpix-test', TWINPIX_CLIENT_ID: 'cid' }, []);

describe('AuthService', () => {
  it('sem Client ID aparece como não configurado', async () => {
    const s = new AuthService({ ...config, clientId: null }, () => fakePca([]) as any);
    expect(await s.status()).toEqual({ configured: false, connected: false, accountName: null, demo: false });
  });

  it('modo demonstração aparece sempre conectado', async () => {
    const s = new AuthService({ ...config, demo: true, provider: 'fake', clientId: null }, () => fakePca([]) as any);
    expect(await s.status()).toMatchObject({ connected: true, demo: true, accountName: 'Modo demonstração' });
  });

  it('com conta no cache: conectado e devolve token', async () => {
    const pca = fakePca([{ name: 'Priscilla', username: 'p@x' }]);
    const s = new AuthService(config, () => pca as any);
    expect(await s.status()).toMatchObject({ configured: true, connected: true, accountName: 'Priscilla' });
    expect(await s.getAccessToken(true)).toBe('tok');
    expect(pca.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it('sem conta ou renovação falhando pede reconexão', async () => {
    await expect(new AuthService(config, () => fakePca([]) as any).getAccessToken(false)).rejects.toBeInstanceOf(ReconnectRequiredError);
    const failing = fakePca([{ username: 'p@x' }], async () => { throw new Error('invalid_grant'); });
    await expect(new AuthService(config, () => failing as any).getAccessToken(false)).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('renovação que exige login de novo pede reconexão', async () => {
    for (const err of [
      new InteractionRequiredAuthError('invalid_grant', 'AADSTS70000'),
      Object.assign(new Error('x'), { errorCode: 'no_account_in_silent_request' }),
      Object.assign(new Error('x'), { errorCode: 'interaction_required' }),
    ]) {
      const pca = fakePca([{ username: 'p@x' }], async () => { throw err; });
      await expect(new AuthService(config, () => pca as any).getAccessToken(false)).rejects.toBeInstanceOf(ReconnectRequiredError);
    }
  });

  it('renovação que falha por falta de rede vira "sem conexão", não pedido de reconexão', async () => {
    for (const err of [
      Object.assign(new Error('Network request failed'), { errorCode: 'network_error' }),
      new TypeError('fetch failed'),
      Object.assign(new Error('getaddrinfo ENOTFOUND login.microsoftonline.com'), { code: 'ENOTFOUND' }),
    ]) {
      const pca = fakePca([{ username: 'p@x' }], async () => { throw err; });
      await expect(new AuthService(config, () => pca as any).getAccessToken(false)).rejects.toBeInstanceOf(OfflineError);
    }
  });

  it('callback com state desconhecido é recusado', async () => {
    const s = new AuthService(config, () => fakePca([]) as any);
    await expect(s.handleCallback('code', 'state-falso')).rejects.toThrow('expirou');
  });

  it('login gera URL e o callback troca o código usando o verificador PKCE', async () => {
    const pca = fakePca([]);
    const s = new AuthService(config, () => pca as any);
    await s.loginUrl();
    const req = pca.getAuthCodeUrl.mock.calls[0][0] as { state: string; codeChallengeMethod: string };
    expect(req.codeChallengeMethod).toBe('S256');
    await s.handleCallback('code-1', req.state);
    expect(pca.acquireTokenByCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'code-1', codeVerifier: expect.any(String) }));
  });
});
