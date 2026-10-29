import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { loadConfig, loadDotEnv } from './config';
import { DomainErrorFilter } from './http/domain-error.filter';
import { hostGuard } from './security/host-guard';
import { openBrowser } from './security/open-browser';
import { sessionMiddleware } from './security/session.middleware';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  const allowedHosts = config.allowedOrigins.map((o) => new URL(o).host);
  app.use(hostGuard(allowedHosts));
  app.use(sessionMiddleware(config.sessionToken, config.allowedOrigins));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();
  if (existsSync(config.webDist)) app.useStaticAssets(config.webDist);

  await app.listen(config.port, '127.0.0.1');

  const url = `${config.uiOrigin}/#token=${config.sessionToken}`;
  console.log(`\nTwinPix Cloud ${config.demo ? '(modo demonstração) ' : ''}rodando.`);
  console.log(`Abra no navegador: ${url}\n`);
  if (config.openBrowser) openBrowser(url);
}

void bootstrap();
