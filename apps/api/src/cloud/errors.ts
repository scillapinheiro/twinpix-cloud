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
/** Trava da pasta de teste: é um ForbiddenError para o app registrar como falha, sem tentar conferir. */
export class TestFolderLockError extends ForbiddenError {
  constructor(testFolder: string, what = 'mexer em arquivos') {
    super(`Modo de teste: só dá para ${what} dentro de ${testFolder}.`);
  }
}
