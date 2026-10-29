import type { AuthStatus, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

export function Home() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [latest, setLatest] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const loginError = params.get('erro');

  useEffect(() => {
    apiFetch<AuthStatus>('/api/auth/status')
      .then(async (s) => {
        setAuth(s);
        if (s.connected) setLatest(await apiFetch<ScanSummary | null>('/api/scans/latest'));
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <p className="alert">{error}</p>;
  if (!auth) return <p>Carregando…</p>;

  if (!auth.configured) {
    return (
      <section className="card">
        <h1>Falta configurar</h1>
        <p>
          Para conectar ao OneDrive, registre o app no Microsoft Entra e coloque o Client ID no arquivo
          <code> .env </code> da pasta do projeto, na linha <code>TWINPIX_CLIENT_ID=</code>. O passo a passo está no README.
        </p>
        <p>Enquanto isso, você pode experimentar com <code>npm run demo</code>.</p>
      </section>
    );
  }

  if (!auth.connected) {
    return (
      <section className="card">
        <h1>Encontre fotos e vídeos repetidos no seu OneDrive</h1>
        {loginError && <p className="alert">Não foi possível conectar: {loginError}</p>}
        <p>O TwinPix Cloud só lê informações dos arquivos. Nada é apagado sem você confirmar, e tudo vai para a lixeira do OneDrive.</p>
        <a className="button primary" href="/api/auth/login">Conectar ao OneDrive</a>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Olá{auth.accountName ? `, ${auth.accountName}` : ''}!</h1>
      {auth.demo && <p className="notice">Modo demonstração: os arquivos são fictícios e nada acontece no seu OneDrive.</p>}
      {latest && (
        <p>
          Última análise: {latest.filesFound} arquivos, {latest.groupsPending} grupos para revisar,
          {' '}{formatBytes(latest.bytesFreed)} liberados.
        </p>
      )}
      <div className="row">
        {latest && <Link className="button" to={`/varredura/${latest.id}`}>Ver análise</Link>}
        {latest && latest.groupsPending > 0 && <Link className="button primary" to={`/revisao/${latest.id}`}>Continuar revisão</Link>}
        <Link className="button" to="/pastas">Nova análise</Link>
      </div>
    </section>
  );
}
