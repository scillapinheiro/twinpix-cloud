import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { UnsafeDeletionError } from '../actions/deletion-plan';
import { ForbiddenError, GraphError, InvalidLinkError, OfflineError, ReconnectRequiredError } from '../cloud/errors';

export function toHttp(e: Error): { status: number; body: { message: string; code?: string } } {
  if (e instanceof HttpException) return { status: e.getStatus(), body: { message: e.message } };
  if (e instanceof UnsafeDeletionError || e instanceof InvalidLinkError) return { status: 400, body: { message: e.message, code: undefined } };
  if (e instanceof ReconnectRequiredError) return { status: 409, body: { message: e.message, code: 'needs-auth' } };
  if (e instanceof ForbiddenError) return { status: 403, body: { message: e.message, code: undefined } };
  if (e instanceof OfflineError) return { status: 503, body: { message: e.message, code: 'offline' } };
  if (e instanceof GraphError) return { status: 502, body: { message: e.message, code: undefined } };
  return { status: 500, body: { message: 'Algo deu errado. Tente de novo.' } };
}

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const error = exception instanceof Error ? exception : new Error(String(exception));
    const { status, body } = toHttp(error);
    if (status === 500) console.error(error);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
