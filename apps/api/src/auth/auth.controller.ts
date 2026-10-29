import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import type { AuthStatus } from '@twinpix/shared';
import type { Response } from 'express';
import type { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { AuthService, LoginExpiredError } from './auth.service';

// Mensagens fixas: nunca repetir na tela texto vindo da URL ou do MSAL.
const CALLBACK_MESSAGES = {
  cancelled: 'Você cancelou a conexão.',
  expired: 'O pedido de login expirou. Tente conectar de novo.',
  failed: 'Não foi possível conectar. Tente de novo.',
} as const;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('status')
  status(): Promise<AuthStatus> {
    return this.auth.status();
  }

  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    res.redirect(await this.auth.loginUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const back = `${this.config.uiOrigin}/#/`;
    const fail = (message: string) => res.redirect(`${back}?erro=${encodeURIComponent(message)}`);
    if (!code || !state) {
      if (error === 'access_denied') return fail(CALLBACK_MESSAGES.cancelled);
      console.error('Login: retorno sem código.', error ?? '', errorDescription ?? '');
      return fail(CALLBACK_MESSAGES.failed);
    }
    try {
      await this.auth.handleCallback(code, state);
      res.redirect(back);
    } catch (e) {
      if (e instanceof LoginExpiredError) return fail(CALLBACK_MESSAGES.expired);
      console.error('Login: falha ao trocar o código pelo token.', e);
      fail(CALLBACK_MESSAGES.failed);
    }
  }

  @Post('logout')
  @HttpCode(204)
  logout(): Promise<void> {
    return this.auth.logout();
  }
}
