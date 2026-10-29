import type { GroupView } from '@twinpix/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FileCard } from '../components/FileCard';
import { ApiError, apiFetch } from '../lib/api';
import { FIELD_LABELS, differingFields, fieldValue, type FieldKey } from '../lib/differing-fields';
import { formatBytes } from '../lib/format';

export function Review() {
  const { scanId, groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupView | null | undefined>(undefined);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadStale, setReloadStale] = useState<boolean | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const focusHeader = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const shownId = useRef<number | null>(null);

  function show(g: GroupView | null) {
    shownId.current = g?.id ?? null;
    setGroup(g);
    setMarked(new Set(g?.preMarkedIds ?? []));
  }

  useEffect(() => {
    if (groupId && shownId.current === Number(groupId)) return;
    const path = groupId ? `/api/groups/${groupId}` : `/api/scans/${scanId}/groups/current`;
    apiFetch<GroupView | null>(path).then(show).catch((e: ApiError) => setError(e.message));
  }, [scanId, groupId]);

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

  if (error) return <p className="alert">{error}</p>;
  if (group === undefined) return <p>Carregando…</p>;
  if (group === null) {
    return (
      <section className="card">
        <h1>Revisão concluída</h1>
        <p>Não há mais grupos pendentes nesta análise.</p>
        <div className="row">
          <button type="button" className="button" onClick={async () => {
            await apiFetch(`/api/scans/${scanId}/unskip`, { method: 'POST' });
            show(await apiFetch<GroupView | null>(`/api/scans/${scanId}/groups/current`));
          }}>Rever grupos pulados</button>
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
    navigate(g ? `/revisao/${scanId}/grupo/${g.id}` : `/revisao/${scanId}`, { replace: true });
  }
  async function skip() {
    try {
      goTo(await apiFetch<GroupView | null>(`/api/groups/${group!.id}/skip`, { method: 'POST' }));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }
  async function afterApply(stale: boolean) {
    setReloadStale(null);
    try {
      focusHeader.current = true;
      goTo(await apiFetch<GroupView | null>(stale ? `/api/groups/${group!.id}` : `/api/scans/${scanId}/groups/current`));
    } catch (e) {
      focusHeader.current = false;
      setError(null);
      setReloadStale(stale);
      setLoadError((e as ApiError).message);
    }
  }
  async function back() {
    try {
      const prev = await apiFetch<GroupView | null>(`/api/groups/${group!.id}/previous`);
      if (prev) goTo(prev);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  return (
    <>
    <section className="review" inert={confirming}>
      <div className="group-header card" tabIndex={-1} ref={headerRef}>
        <strong>
          Grupo {group.position} de {group.total} · Cópias idênticas · {formatBytes(group.bytesFreedSoFar)} liberados até agora
        </strong>
        {' '}<Link className="batch-link" to={`/lote/${scanId}`}>Revisar em lote</Link>
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
        <button type="button" className="button" onClick={back} disabled={group.position <= 1}>← Voltar</button>
        <button type="button" className="button" onClick={skip}>Pular</button>
        <button
          type="button"
          ref={deleteButton}
          className="button danger"
          disabled={marked.size === 0 || group.status === 'resolved'}
          onClick={() => setConfirming(true)}
        >
          Excluir marcadas ({marked.size})
        </button>
      </div>
    </section>

      {confirming && (
        <ConfirmDialog
          groupId={group.id}
          deleteIds={[...marked]}
          onCancel={() => { setConfirming(false); deleteButton.current?.focus(); }}
          onDone={(stale) => { setConfirming(false); void afterApply(stale); }}
        />
      )}
    </>
  );
}
