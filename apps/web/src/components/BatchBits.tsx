import type { BatchKind, BatchStatus, BatchSummary } from '@twinpix/shared';
import { useState } from 'react';

export const BATCH_STATUS_TEXT: Record<BatchStatus, string> = {
  running: 'Movendo para a lixeira…',
  paused: 'Lote pausado.',
  'waiting-network': 'Sem conexão. Continua sozinho quando a internet voltar.',
  'needs-auth': 'A conexão com o OneDrive expirou.',
  done: 'Lote concluído.',
  undoing: 'Desfazendo o lote…',
  undone: 'Lote desfeito.',
  error: 'O lote parou por um erro. Os arquivos já movidos continuam no histórico e podem ser desfeitos.',
};

export const BATCH_TITLE: Record<BatchKind, string> = {
  lines: 'Lote das idênticas',
  folders: 'Lote de pastas repetidas',
  probable: 'Lote das prováveis regravações',
};

/** Rótulo curto de um lote no Histórico (sem o número): "Lote", "Pastas", "Prováveis". */
export const BATCH_LABEL: Record<BatchKind, string> = {
  lines: 'Lote',
  folders: 'Pastas',
  probable: 'Prováveis',
};

/** Lotes que impedem começar outro (o servidor recusa): a tela deve levar até eles. */
export const OPEN_BATCH_STATUSES: BatchStatus[] = ['running', 'paused', 'waiting-network', 'needs-auth', 'undoing'];

/** O lote aberto a mostrar: o desta análise e deste tipo primeiro; senão, qualquer lote aberto. */
export function findOpenBatch(all: BatchSummary[], scanId: number, kind: BatchKind): BatchSummary | undefined {
  const open = all.filter((b) => OPEN_BATCH_STATUSES.includes(b.status));
  return open.find((b) => b.scanId === scanId && b.kind === kind) ?? open[0];
}

export const OTHER_BATCH_NOTICE = 'Termine ou desfaça este lote antes de começar outro.';

export function UndoBatchButton({ onUndo }: { onUndo: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button type="button" className="button danger" onClick={async () => { await onUndo(); setConfirming(false); }}>Confirmar desfazer</button>
  ) : (
    <button type="button" className="button" onClick={() => setConfirming(true)}>Desfazer este lote</button>
  );
}
