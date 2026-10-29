import type { BatchStatus } from '@twinpix/shared';
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

export function UndoBatchButton({ onUndo }: { onUndo: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button type="button" className="button danger" onClick={async () => { await onUndo(); setConfirming(false); }}>Confirmar desfazer</button>
  ) : (
    <button type="button" className="button" onClick={() => setConfirming(true)}>Desfazer este lote</button>
  );
}
