import { getToken } from './session';

const SESSION_MESSAGE = 'Sessão expirada ou ausente. Abra o TwinPix Cloud pelo endereço mostrado no terminal.';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['X-TwinPix-Token'] = token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('Não consegui falar com o TwinPix Cloud. Ele ainda está rodando no terminal?', 0);
  }
  const text = await res.text();
  let data: { message?: string; code?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(`Erro ${res.status}`, res.status);
      throw new ApiError('Resposta inesperada do TwinPix Cloud.', res.status);
    }
  }
  if (!res.ok) {
    if (res.status === 401 && (data?.code === 'session' || !token)) {
      throw new ApiError(SESSION_MESSAGE, 401, data?.code);
    }
    throw new ApiError(data?.message ?? `Erro ${res.status}`, res.status, data?.code);
  }
  return data as T;
}
