import type { BatchPreview, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

/** "Lote das prováveis (N)": N = grupos aprovados pelo filtro (prévia), não os pendentes. Sem N ou com erro, não aparece. */
export function ProbableBatchButton({ scan }: { scan: ScanSummary | null }) {
  const [count, setCount] = useState(0);
  const id = scan?.id;
  const eligible = scan?.status === 'done' && scan.probablePending > 0;
  useEffect(() => {
    if (!eligible) { setCount(0); return; }
    let alive = true;
    apiFetch<BatchPreview>(`/api/scans/${id}/batch?kind=probable`)
      .then((p) => alive && setCount(p.lines.reduce((s, l) => s + l.groupCount, 0)))
      .catch(() => alive && setCount(0));
    return () => { alive = false; };
  }, [eligible, id]);
  if (!eligible || count === 0) return null;
  return <Link className="button" to={`/lote/${id}?tipo=provaveis`}>Lote das prováveis ({count})</Link>;
}
