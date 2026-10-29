import { describe, expect, it, vi } from 'vitest';
import { UnsafeDeletionError } from '../actions/deletion-plan';
import { ForbiddenError, InvalidLinkError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { DomainErrorFilter, toHttp } from './domain-error.filter';

describe('toHttp', () => {
  it.each([
    [new UnsafeDeletionError('x'), 400, undefined],
    [new InvalidLinkError('x'), 400, undefined],
    [new ReconnectRequiredError(), 409, 'needs-auth'],
    [new ForbiddenError(), 403, undefined],
    [new OfflineError(), 503, 'offline'],
  ])('%s', (error, status, code) => {
    expect(toHttp(error as Error)).toMatchObject({ status, body: { message: (error as Error).message, code } });
  });

  it('erro desconhecido vira 500 com mensagem genérica', () => {
    expect(toHttp(new Error('detalhe interno'))).toEqual({
      status: 500,
      body: { message: 'Algo deu errado. Tente de novo.' },
    });
  });

  it('o filtro escreve a resposta', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new DomainErrorFilter().catch(new OfflineError(), host as any);
    expect(status).toHaveBeenCalledWith(503);
  });
});
