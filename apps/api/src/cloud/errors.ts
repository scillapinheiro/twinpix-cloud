export class OfflineError extends Error {
  constructor(message = 'Sem conexão com a internet.') { super(message); }
}
export class ReconnectRequiredError extends Error {
  constructor(message = 'A conexão com o OneDrive expirou. Conecte de novo.') { super(message); }
}
export class ForbiddenError extends Error {
  constructor(message = 'Sem permissão para este item do OneDrive.') { super(message); }
}
export class InvalidLinkError extends Error {}
export class GraphError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`O OneDrive respondeu com erro ${status}.`);
  }
}
