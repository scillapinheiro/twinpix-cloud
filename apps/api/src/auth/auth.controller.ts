import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import type { AuthStatus } from '@twinpix/shared';
import type { Response } from 'express';
import type { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { AuthService } from './auth.service';

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
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const back = `${this.config.uiOrigin}/#/`;
    if (!code || !state) {
      res.redirect(`${back}?erro=${encodeURIComponent(errorDescription ?? 'Login cancelado.')}`);
      return;
    }
    try {
      await this.auth.handleCallback(code, state);
      res.redirect(back);
    } catch (e) {
      res.redirect(`${back}?erro=${encodeURIComponent((e as Error).message)}`);
    }
  }

  @Post('logout')
  @HttpCode(204)
  logout(): Promise<void> {
    return this.auth.logout();
  }
}
