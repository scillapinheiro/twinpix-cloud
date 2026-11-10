import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizeTestFolder } from './cloud/test-folder';

export interface AppConfig {
  port: number;
  provider: 'onedrive' | 'fake';
  demo: boolean;
  /** Modo demonstração com cenários extras (pasta sem permissão, arquivo que não vai para a lixeira, análise lenta). */
  demoScenarios: boolean;
  /** Espera por pasta na análise dos cenários da demonstração. */
  demoDelayMs: number;
  clientId: string | null;
  authority: string;
  dataDir: string;
  dbFile: string;
  sessionToken: string;
  uiOrigin: string;
  allowedOrigins: string[];
  openBrowser: boolean;
  webDist: string;
  /** Trava da pasta de teste (só OneDrive real): fora dela nada é analisado, movido ou restaurado. */
  testFolder: string | null;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): AppConfig {
  const demo = argv.includes('--demo');
  const port = Number(env.PORT ?? 4317);
  const devOrigin = env.TWINPIX_DEV_ORIGIN || null;
  const dataDir = env.TWINPIX_DATA_DIR ?? join(homedir(), '.twinpix-cloud');
  const provider = demo || env.TWINPIX_PROVIDER === 'fake' ? 'fake' : 'onedrive';
  return {
    port,
    demo,
    demoScenarios: demo && env.TWINPIX_DEMO_SCENARIOS !== '0',
    demoDelayMs: Number(env.TWINPIX_DEMO_DELAY_MS ?? 700),
    provider,
    clientId: env.TWINPIX_CLIENT_ID || null,
    authority: env.TWINPIX_AUTHORITY ?? 'https://login.microsoftonline.com/consumers',
    dataDir,
    dbFile: join(dataDir, demo ? 'demo.sqlite' : 'twinpix.sqlite'),
    sessionToken: env.TWINPIX_SESSION_TOKEN ?? randomBytes(24).toString('hex'),
    uiOrigin: devOrigin ?? `http://127.0.0.1:${port}`,
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(devOrigin ? [devOrigin] : [])],
    openBrowser: env.TWINPIX_NO_BROWSER !== '1' && !devOrigin,
    webDist: resolve(__dirname, '../../web/dist'),
    testFolder: provider === 'onedrive' ? normalizeTestFolder(env.TWINPIX_TEST_FOLDER) : null,
  };
}

/** Carrega o .env da raiz do repositório, se existir. */
export function loadDotEnv(file = resolve(__dirname, '../../../.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
