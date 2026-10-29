import type { GroupView, ScanSummary } from '@twinpix/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FileCard } from '../components/FileCard';
import { ApiError, apiFetch } from '../lib/api';
import { FIELD_LABELS, differingFields, fieldValue, type FieldKey } from '../lib/differing-fields';
import { formatBytes } from '../lib/format';
import { ignoreShortcut, isNativeActivator } from '../lib/shortcuts';

export function Review() {
  const { scanId, groupId } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const urlProbable = search.get('tipo') === 'provaveis';
  const [group, setGroup] = useState<GroupView | null | undefined>(undefined);
  // o tipo do grupo exibido manda; a URL só decide enquanto não há grupo (carregando ou fim da revisão)
  const probable = group ? group.kind === 'probable' : urlProbable;
  const tipoQs = probable ? '?tipo=provaveis' : '';
  const kindQs = probable ? '?kind=probable' : '';
  const urlKindQs = urlProbable ? '?kind=probable' : '';
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadStale, setReloadStale] = useState<boolean | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const focusHeader = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const shownId = useRef<number | null>(null);
  const inFlight = useRef(false);
  async function guarded(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  const shortcuts = useRef<{ open: () => void; skip: () => void; back: () => void; markOthers: () => void } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = shortcuts.current;
      if (!keys || ignoreShortcut(e)) return;
      if (e.key === 'Enter') {
        if (isNativeActivator(e)) return;
        e.preventDefault();
        keys.open();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        keys.skip();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        keys.back();
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        keys.markOthers();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function show(g: GroupView | null) {
    shownId.current = g?.id ?? null;
    setGroup(g);
    setMarked(new Set(g?.preMarkedIds ?? []));
  }

  useEffect(() => {
    if (groupId && shownId.current === Number(groupId)) return;
    const path = groupId ? `/api/groups/${groupId}` : `/api/scans/${scanId}/groups/current${urlKindQs}`;
    apiFetch<GroupView | null>(path).then(show).catch((e: ApiError) => setError(e.message));
  }, [scanId, groupId, urlKindQs]);

  // fim da revisão: o resumo diz se há grupos pendentes do outro tipo
  useEffect(() => {
    if (group !== null) return;
    setSummary(null);
    apiFetch<ScanSummary>(`/api/scans/${scanId}`).then(setSummary).catch(() => setSummary(null));
  }, [group, scanId]);

  useEffect(() => {
    if (focusHeader.current && group) {
      focusHeader.current = false;
      headerRef.current?.focus();
    }
  }, [group]);

  const diffs = useMemo(() => differingFields(group?.files ?? []), [group]);
  const allFields = useMemo<FieldKey[]>(() => {
    const keys = Object.keys(FIELD_LABELS) as FieldKey[];
    return keys.filter((k) => k !== 'duration' || group?.files.some((f) => f.kind === 'video'));
  }, [group]);
  const many = (group?.files.length ?? 0) >= 3;
  const cardFields = many ? allFields.filter((k) => diffs.has(k)) : allFields;
  const commonFields = many ? allFields.filter((k) => !diffs.has(k)) : [];

  shortcuts.current = null;
  if (error) return <p className="alert">{error}</p>;
  if (group === undefined) return <p>Carregando…</p>;
  if (group === null) {
    return (
      <section className="card">
        <h1>Revisão concluída</h1>
        <p>{probable ? 'Não há mais prováveis cópias pendentes nesta análise.' : 'Não há mais cópias idênticas pendentes nesta análise.'}</p>
        <div className="row">
          <button type="button" className="button" onClick={async () => {
            await apiFetch(`/api/scans/${scanId}/unskip${kindQs}`, { method: 'POST' });
            show(await apiFetch<GroupView | null>(`/api/scans/${scanId}/groups/current${kindQs}`));
          }}>Rever grupos pulados</button>
          {probable && summary && summary.groupsPending > 0 && (
            <Link className="button primary" to={`/revisao/${scanId}`}>Revisar cópias idênticas</Link>
          )}
          {!probable && summary && summary.probablePending > 0 && (
            <Link className="button primary" to={`/revisao/${scanId}?tipo=provaveis`}>Revisar prováveis cópias</Link>
          )}
          <Link className="button" to={`/varredura/${scanId}`}>Ver resumo da análise</Link>
        </div>
      </section>
    );
  }

  const toggle = (id: string) =>
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unmarkedCount = group.files.length - marked.size;

  // Mantém a URL no grupo exibido, para que recarregar a página não mude de grupo.
  function goTo(g: GroupView | null) {
    show(g);
    navigate(g ? `/revisao/${scanId}/grupo/${g.id}${tipoQs}` : `/revisao/${scanId}${tipoQs}`, { replace: true });
  }
  function skip() {
    return guarded(async () => {
      try {
        goTo(await apiFetch<GroupView | null>(`/api/groups/${group!.id}/skip`, { method: 'POST' }));
      } catch (e) {
        setError((e as ApiError).message);
      }
    });
  }
  function afterApply(stale: boolean) {
    setReloadStale(null);
    return guarded(async () => {
      try {
        focusHeader.current = true;
        goTo(await apiFetch<GroupView | null>(stale ? `/api/groups/${group!.id}` : `/api/scans/${scanId}/groups/current${kindQs}`));
      } catch (e) {
        focusHeader.current = false;
        setError(null);
        setReloadStale(stale);
        setLoadError((e as ApiError).message);
      }
    });
  }
  function back() {
    return guarded(async () => {
      try {
        const prev = await apiFetch<GroupView | null>(`/api/groups/${group!.id}/previous`);
        if (prev) goTo(prev);
      } catch (e) {
        setError((e as ApiError).message);
      }
    });
  }
  const canDelete = marked.size > 0 && group.status !== 'resolved' && !loading;
  // Com o modal aberto, as teclas pertencem a ele.
  shortcuts.current = confirmingId !== null || loading ? null : {
    open: () => { if (canDelete) setConfirmingId(group.id); },
    skip: () => void skip(),
    back: () => { if (group.position > 1) void back(); },
    markOthers: () => {
      const others = group.files.filter((f) => f.id !== group.suggestion.keepId).map((f) => f.id);
      if (others.length === 0 || others.length === group.files.length || group.status === 'resolved') return;
      setMarked(new Set(others));
      setConfirmingId(group.id);
    },
  };

  return (
    <>
    <section className="review" inert={confirmingId === group.id}>
      <div className="group-header card" tabIndex={-1} ref={headerRef}>
        <strong>
          Grupo {group.position} de {group.total} · {probable ? 'Prováveis cópias' : 'Cópias idênticas'} · {formatBytes(group.bytesFreedSoFar)} liberados até agora
        </strong>
        {!probable && <>{' '}<Link className="batch-link" to={`/lote/${scanId}`}>Revisar em lote</Link></>}
        {probable && (
          <p className="notice probable-warning" role="note">
            <span aria-hidden="true">⚠ </span>Podem ser a original e uma versão editada. Confira antes de excluir.
          </p>
        )}
        {group.status === 'stale' && (
          <p className="notice">
            Este grupo mudou no OneDrive desde a análise. Ele foi atualizado com a situação atual — confira as cópias antes de excluir.
          </p>
        )}
        {group.status === 'resolved' && <p className="muted">Este grupo já foi resolvido.</p>}
        {group.status === 'skipped' && <p className="muted">Você pulou este grupo.</p>}
      </div>

      <p className="legend">
        <span className="legend-keep">★ Sugerida para manter</span> — escolhida pela regra: {group.suggestion.reason.replace(/^regra:\s*/, '')}
        <span className="legend-sep" aria-hidden="true"> · </span>
        Campos em <span className="diff">laranja</span> são diferentes entre as cópias.
      </p>

      {reloadStale !== null && loadError && (
        <div className="alert" role="alert">
          {loadError}{' '}
          <button type="button" className="button primary" onClick={() => void afterApply(reloadStale)}>Tentar de novo</button>
        </div>
      )}

      <div className="cards" data-count={group.files.length >= 4 ? 'many' : group.files.length}>
        {group.files.map((f) => (
          <FileCard
            key={f.id}
            file={f}
            isSuggested={f.id === group.suggestion.keepId}
            marked={marked.has(f.id)}
            lockDelete={unmarkedCount <= 1}
            onToggle={() => toggle(f.id)}
            diffs={diffs}
            fields={cardFields}
          />
        ))}
      </div>

      {many && commonFields.length > 0 && (
        <div className="card summary-common">
          <h2>Igual em todas as cópias</h2>
          <dl>
            {commonFields.map((k) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{FIELD_LABELS[k]}</dt>
                <dd>{fieldValue(group.files[0], k)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="action-bar">
        <button type="button" className="button" onClick={back} disabled={loading || group.position <= 1} aria-keyshortcuts="ArrowLeft">← Voltar</button>
        <button type="button" className="button" onClick={skip} disabled={loading} aria-keyshortcuts="P">
          Pular <kbd className="key-hint" aria-hidden="true">P</kbd>
        </button>
        <button
          type="button"
          ref={deleteButton}
          className="button danger"
          disabled={!canDelete}
          aria-keyshortcuts="Enter"
          onClick={() => { if (canDelete) setConfirmingId(group.id); }}
        >
          Excluir marcadas ({marked.size}) <kbd className="key-hint" aria-hidden="true">Enter</kbd>
        </button>
        <span className="shortcut-legend muted">Atalhos: Enter confirma · P pula · ← volta · X marca as outras</span>
      </div>
    </section>

      {confirmingId === group.id && (
        <ConfirmDialog
          key={group.id}
          groupId={group.id}
          deleteIds={[...marked]}
          onCancel={() => { setConfirmingId(null); deleteButton.current?.focus(); }}
          onDone={(stale) => {
            setConfirmingId(null);
            if (!stale) setGroup((g) => (g ? { ...g, status: 'resolved' } : g));
            void afterApply(stale);
          }}
        />
      )}
    </>
  );
}
