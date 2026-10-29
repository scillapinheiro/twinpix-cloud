import type { ReconcilePlan } from '@twinpix/shared';
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { plural } from '../lib/plural';

interface Props {
  plan: ReconcilePlan;
  /** Arquivos que só existem numa pasta do conjunto (soma). */
  uniqueCount: number;
  /** Quantos desses estão na pasta escolhida (para não contar duas vezes as cópias extras). */
  keepFolderUnique: number;
  /** Arquivos que ficam nas outras pastas por serem repetidos só entre elas (sem cópia na pasta escolhida). */
  repeatedElsewhere: number;
  /** Envia o lote; se rejeitar, o erro aparece no modal e dá para tentar de novo. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Chamado por "Recarregar" quando a prévia mudou: fecha o modal e recarrega. */
  onReload: () => void;
}

const fileName = (f: { folderPath: string; name: string }) => `${f.folderPath === '/' ? '' : f.folderPath}/${f.name}`;

/** "a", "a e b", "a, b e c". */
const joinPt = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

export function ReconcileConfirmDialog({ plan, uniqueCount, keepFolderUnique, repeatedElsewhere, onConfirm, onCancel, onReload }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError((e as ApiError).message);
      busyRef.current = false;
      setBusy(false);
    }
  }

  const n = plan.deleteFiles.length;
  const keepRemaining = plan.remaining.find((r) => r.path === plan.keepFolder)?.fileCount ?? 0;
  const extraCopies = Math.max(0, keepRemaining - plan.keepFiles.length - keepFolderUnique);
  // Prévia mudou, ou outro lote ficou aberto: recarregar mostra a situação atual (e o lote aberto).
  const staying = [
    uniqueCount > 0 && plural(uniqueCount, 'arquivo que só existe numa pasta', 'arquivos que só existem numa pasta'),
    extraCopies > 0 && plural(extraCopies, 'cópia extra na pasta escolhida', 'cópias extras na pasta escolhida'),
    repeatedElsewhere > 0 && plural(repeatedElsewhere, 'arquivo repetido só entre as outras pastas', 'arquivos repetidos só entre as outras pastas'),
  ].filter((x): x is string => !!x);
  const stale = error !== null && /prévia mudou|lote pausado ou em andamento/i.test(error);
  return (
    <div className="modal-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reconcile-confirm-title" tabIndex={-1} ref={dialogRef}>
        <h1 id="reconcile-confirm-title">Confirmar pastas repetidas</h1>
        <p>
          <strong>{plural(n, 'arquivo vai', 'arquivos vão')} para a lixeira do OneDrive</strong>, liberando {formatBytes(plan.bytes)}.
          As cópias ficam em <strong>{plan.keepFolder}</strong>. Os arquivos que só existem em uma pasta não são tocados. Nada é apagado de vez.
        </p>
        <h2>Saem ({n})</h2>
        <ul className="reconcile-list" aria-label="Arquivos que saem">
          {plan.deleteFiles.map((f) => <li key={f.id}>{fileName(f)}</li>)}
        </ul>
        <h2>Cópia que fica de cada arquivo repetido ({plan.keepFiles.length})</h2>
        <ul className="reconcile-list" aria-label="Cópias que ficam">
          {plan.keepFiles.map((f) => <li key={f.id}>{fileName(f)}</li>)}
        </ul>
        {staying.length > 0 && <p className="muted">Também continuam onde estão: {joinPt(staying)}.</p>}
        <h3>Como cada pasta fica</h3>
        <ul aria-label="Pastas depois da limpeza">
          {plan.remaining.map((r) => (
            <li key={r.path}>{r.path}: {r.fileCount === 0 ? 'fica vazia' : plural(r.fileCount, 'arquivo', 'arquivos')}</li>
          ))}
        </ul>
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="button" onClick={onCancel} disabled={busy}>Voltar</button>
          {stale ? (
            <button type="button" className="button primary" onClick={onReload}>Recarregar</button>
          ) : (
            <button type="button" className="button danger" disabled={busy} onClick={() => void confirm()}>
              {error ? 'Tentar de novo' : 'Mover para a lixeira'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
