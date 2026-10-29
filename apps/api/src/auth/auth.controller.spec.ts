import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { AuthController } from './auth.controller';
import { AuthService, LoginExpiredError } from './auth.service';

const config = loadConfig({ TWINPIX_DATA_DIR: '/tmp/twinpix-test', TWINPIX_CLIENT_ID: 'cid' }, []);
const back = `${config.uiOrigin}/#/`;

function setup(handleCallback: () => Promise<void> = async () => {}) {
  const auth = { handleCallback: vi.fn(handleCallback) } as unknown as AuthService;
  const res = { redirect: vi.fn() };
  const controller = new AuthController(auth, config);
  const erro = () => {
    const url = res.redirect.mock.calls[0][0] as string;
    const q = url.split('?')[1];
    return q ? new URLSearchParams(q).get('erro') : null;
  };
  return { controller, res, erro, auth };
}

afterEach(() => vi.restoreAllMocks());

describe('AuthController.callback', () => {
  it('sucesso volta para a tela inicial sem erro', async () => {
    const { controller, res, erro } = setup();
    await controller.callback('code', 'state', undefined, undefined, res as any);
    expect(res.redirect).toHaveBeenCalledWith(back);
    expect(erro()).toBeNull();
  });

  it('cancelado na Microsoft: mensagem fixa, sem repetir o texto da URL', async () => {
    const { controller, res, erro } = setup();
    await controller.callback(undefined, 'state', 'access_denied', 'AADSTS65004: <script>x</script>', res as any);
    expect(erro()).toBe('Você cancelou a conexão.');
  });

  it('sem código por outro motivo: mensagem fixa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller, res, erro } = setup();
    await controller.callback(undefined, undefined, 'server_error', 'Texto qualquer vindo da URL', res as any);
    expect(erro()).toBe('Não foi possível conectar. Tente de novo.');
  });

  it('pedido de login expirado', async () => {
    const { controller, res, erro } = setup(async () => { throw new LoginExpiredError(); });
    await controller.callback('code', 'state', undefined, undefined, res as any);
    expect(erro()).toBe('O pedido de login expirou. Tente conectar de novo.');
  });

  it('erro do MSAL não aparece na tela; vai só para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller, res, erro } = setup(async () => { throw new Error('AADSTS9002313: Invalid request. Detalhe interno'); });
    await controller.callback('code', 'state', undefined, undefined, res as any);
    expect(erro()).toBe('Não foi possível conectar. Tente de novo.');
    expect(log).toHaveBeenCalled();
  });
});
