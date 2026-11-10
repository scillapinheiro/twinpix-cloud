import type { AuthStatus, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ProbableBatchButton } from '../components/ProbableBatchButton';
import { plural } from '../lib/plural';
import { ArrowIcon, TwinPhoto } from '../components/Brand';
import { ProgressBar } from '../components/ProgressBar';

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
        <p>O TwinPix ainda não está ligado a uma conta da Microsoft. Siga o passo “Usar com o seu OneDrive” do guia.</p>
      </section>
    );
  }

  if (!auth.connected) {
    return (
      <section className="hero hero-connect">
        <div className="hero-copy">
          <h1>Duas iguais? Fica uma.</h1>
          {loginError && <p className="alert">Não foi possível conectar: {loginError}</p>}
          <p className="hero-lead">O TwinPix Cloud lê só os dados dos seus arquivos na nuvem, mostra as cópias lado a lado e move para a lixeira o que você escolher.</p>
          <a className="button big on-dark" href="/api/auth/login">
            <span>Conectar ao OneDrive</span>
            <span className="button-seal"><ArrowIcon /></span>
          </a>
          <p className="hero-note">Nada é apagado de vez: tudo vai para a lixeira da sua nuvem e dá para desfazer. Sempre sobra uma cópia.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <TwinPhoto tone="lime" mark="check" className="art-one" />
          <TwinPhoto tone="pink" mark="cross" className="art-two" />
        </div>
      </section>
    );
  }

  const pending = latest ? latest.groupsPending + latest.groupsSkipped : 0;
  const probablePending = latest ? latest.probablePending + latest.probableSkipped : 0;
  const reviewed = latest ? Math.max(0, latest.groupsTotal - latest.groupsPending - latest.groupsSkipped) : 0;
  const greeting = `Olá${auth.accountName ? `, ${auth.accountName}` : ''}!`;

  return (
    <div className={`home-grid${latest ? '' : ' alone'}`}>
      <section className="hero hero-home">
        <div className="hero-copy">
          <p className="greeting">{greeting}</p>
          {latest && pending > 0 ? (
            <h1><span className="big">{plural(pending, 'grupo', 'grupos')}</span> esperando você.</h1>
          ) : (
            <h1>{latest ? 'Tudo revisado por aqui.' : 'Vamos achar as cópias?'}</h1>
          )}
          {auth.demo && <p className="notice">Modo demonstração: os arquivos são fictícios e nada acontece na sua nuvem.</p>}
          <div className="row">
            {latest && pending > 0 && <Link className="button primary big" to={`/revisao/${latest.id}`}>Continuar revisão</Link>}
            {latest && <Link className="button big" to={`/varredura/${latest.id}`}>Ver análise</Link>}
            {latest && probablePending > 0 && <Link className="button big" to={`/revisao/${latest.id}?tipo=provaveis`}>Revisar prováveis cópias</Link>}
            <ProbableBatchButton scan={latest} />
            <Link className={`button big${latest && pending > 0 ? '' : ' primary'}`} to="/pastas">Nova análise</Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <TwinPhoto tone="white" mark="check" className="art-one" />
          <TwinPhoto tone="navy" mark="cross" className="art-two" />
        </div>
      </section>
      {latest && (
        <div className="stat-column">
          <section className="stat stat-pink">
            <p className="stat-value">{latest.filesFound.toLocaleString('pt-BR')}</p>
            <p className="stat-label">
              {latest.filesFound === 1 ? 'foto ou vídeo encontrado' : 'fotos e vídeos encontrados'} em {plural(latest.roots.length, 'pasta', 'pastas')}
            </p>
            <ul className="stat-chips" aria-label="O que foi encontrado">
              <li>{plural(latest.groupsTotal, 'grupo de cópias idênticas', 'grupos de cópias idênticas')}</li>
              {latest.probableTotal > 0 && <li>{plural(latest.probableTotal, 'provável cópia', 'prováveis cópias')}</li>}
            </ul>
          </section>
          <section className="stat stat-navy">
            <p className="stat-value">
              {formatBytes(latest.bytesFreed).split(' ')[0]} <span className="stat-unit">{formatBytes(latest.bytesFreed).split(' ')[1]}</span>
            </p>
            <p className="stat-label">liberados até agora</p>
            {latest.groupsTotal > 0 && (
              <div className="stat-progress">
                <ProgressBar percent={Math.round((reviewed / latest.groupsTotal) * 100)} label="Grupos revisados" />
                <p>{reviewed} de {plural(latest.groupsTotal, 'grupo revisado', 'grupos revisados')}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
