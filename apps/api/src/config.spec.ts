import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('padrões: OneDrive, porta 4317, origens locais', () => {
    const c = loadConfig({ TWINPIX_DATA_DIR: '/tmp/x' }, ['node', 'main.js']);
    expect(c.provider).toBe('onedrive');
    expect(c.port).toBe(4317);
    expect(c.uiOrigin).toBe('http://127.0.0.1:4317');
    expect(c.allowedOrigins).toEqual(['http://127.0.0.1:4317', 'http://localhost:4317']);
    expect(c.dbFile).toBe('/tmp/x/twinpix.sqlite');
    expect(c.sessionToken).toMatch(/^[0-9a-f]{48}$/);
    expect(c.clientId).toBeNull();
  });

  it('--demo usa o provedor falso e banco próprio', () => {
    const c = loadConfig({ TWINPIX_DATA_DIR: '/tmp/x' }, ['node', 'main.js', '--demo']);
    expect(c.provider).toBe('fake');
    expect(c.demo).toBe(true);
    expect(c.dbFile).toBe('/tmp/x/demo.sqlite');
  });

  it('modo dev aceita a origem do Vite e não abre o navegador', () => {
    const c = loadConfig({ TWINPIX_DEV_ORIGIN: 'http://localhost:5173', TWINPIX_SESSION_TOKEN: 'dev-local' }, []);
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.uiOrigin).toBe('http://localhost:5173');
    expect(c.openBrowser).toBe(false);
    expect(c.sessionToken).toBe('dev-local');
  });

  it('pasta de teste: normalizada, só vale para o OneDrive real, e nunca a raiz', () => {
    expect(loadConfig({}, []).testFolder).toBeNull();
    expect(loadConfig({ TWINPIX_TEST_FOLDER: '' }, []).testFolder).toBeNull();
    expect(loadConfig({ TWINPIX_TEST_FOLDER: 'TwinPix Teste/' }, []).testFolder).toBe('/TwinPix Teste');
    expect(loadConfig({ TWINPIX_TEST_FOLDER: '/TwinPix Teste' }, []).testFolder).toBe('/TwinPix Teste');
    expect(loadConfig({ TWINPIX_TEST_FOLDER: '/TwinPix Teste' }, ['--demo']).testFolder).toBeNull();
    expect(() => loadConfig({ TWINPIX_TEST_FOLDER: '/' }, [])).toThrow('raiz');
  });
});
