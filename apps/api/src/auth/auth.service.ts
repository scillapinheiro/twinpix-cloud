import { CryptoProvider, InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-node';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthStatus } from '@twinpix/shared';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OfflineError, ReconnectRequiredError } from '../cloud/errors';
import type { TokenSource } from '../cloud/onedrive/graph-client';
import type { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { createTokenCachePlugin } from './token-cache';

const SCOPES = ['Files.ReadWrite', 'offline_access'];

/** Códigos do MSAL que significam "só entrando de novo resolve". */
const RECONNECT_CODES = [
  'invalid_grant', 'interaction_required', 'consent_required', 'login_required',
  'no_account_in_silent_request', 'no_account_found', 'no_tokens_found',
  'invalid_client', 'unauthorized_client',
];

/**
 * Só pede reconexão quando o MSAL diz que é preciso entrar de novo; qualquer outra falha na
 * renovação (rede caiu, DNS, erro de rede do MSAL) é tratada como falta de conexão.
 */
function needsReconnect(e: unknown): boolean {
  if (e instanceof InteractionRequiredAuthError) return true;
  const { errorCode, message } = (e ?? {}) as { errorCode?: unknown; message?: unknown };
  const text = `${typeof errorCode === 'string' ? errorCode : ''} ${typeof message === 'string' ? message : ''}`;
  return RECONNECT_CODES.some((code) => text.includes(code));
}

type Pca = Pick<PublicClientApplication, 'getTokenCache' | 'acquireTokenSilent' | 'getAuthCodeUrl' | 'acquireTokenByCode'>;
export type PcaFactory = (config: AppConfig) => Pca;

const defaultFactory: PcaFactory = (config) => {
  mkdirSync(config.dataDir, { recursive: true });
  return new PublicClientApplication({
    auth: { clientId: config.clientId!, authority: config.authority },
    cache: { cachePlugin: createTokenCachePlugin(join(config.dataDir, 'msal-cache.json')) },
  });
};

export const PCA_FACTORY = 'PCA_FACTORY';

export class LoginExpiredError extends Error {
  constructor() { super('O pedido de login expirou. Tente conectar de novo.'); this.name = 'LoginExpiredError'; }
}

@Injectable()
export class AuthService implements TokenSource {
  private pca: Pca | null = null;
  private readonly pending = new Map<string, { verifier: string; createdAt: number }>();
  private readonly crypto = new CryptoProvider();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PCA_FACTORY) private readonly factory: PcaFactory = defaultFactory,
  ) {}

  get redirectUri(): string {
    return `http://localhost:${this.config.port}/api/auth/callback`;
  }

  async status(): Promise<AuthStatus> {
    if (this.config.demo || this.config.provider === 'fake') {
      return { configured: true, connected: true, accountName: 'Modo demonstração', demo: true };
    }
    if (!this.config.clientId) return { configured: false, connected: false, accountName: null, demo: false };
    const account = await this.firstAccount();
    return { configured: true, connected: !!account, accountName: account ? account.name ?? account.username : null, demo: false };
  }

  async loginUrl(): Promise<string> {
    const { verifier, challenge } = await this.crypto.generatePkceCodes();
    const state = this.crypto.createNewGuid();
    this.pending.set(state, { verifier, createdAt: Date.now() });
    return this.client().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account',
    });
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    if (!entry || Date.now() - entry.createdAt > 10 * 60_000) {
      throw new LoginExpiredError();
    }
    await this.client().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.redirectUri,
      codeVerifier: entry.verifier,
    });
  }

  async logout(): Promise<void> {
    const cache = this.client().getTokenCache();
    for (const account of await cache.getAllAccounts()) await cache.removeAccount(account);
  }

  async getAccessToken(forceRefresh: boolean): Promise<string> {
    const account = await this.firstAccount();
    if (!account) throw new ReconnectRequiredError('Conecte o seu OneDrive para continuar.');
    let result: Awaited<ReturnType<Pca['acquireTokenSilent']>> | null;
    try {
      result = await this.client().acquireTokenSilent({ account, scopes: SCOPES, forceRefresh });
    } catch (e) {
      if (needsReconnect(e)) throw new ReconnectRequiredError();
      throw new OfflineError();
    }
    if (!result?.accessToken) throw new ReconnectRequiredError();
    return result.accessToken;
  }

  private async firstAccount() {
    if (!this.config.clientId) return null;
    const accounts = await this.client().getTokenCache().getAllAccounts();
    return accounts[0] ?? null;
  }

  private client(): Pca {
    if (!this.pca) this.pca = this.factory(this.config);
    return this.pca;
  }
}
