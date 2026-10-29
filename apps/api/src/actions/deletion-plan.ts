export class UnsafeDeletionError extends Error {}

export function planDeletion(
  groupFileIds: string[],
  deleteIds: string[],
): { deleteIds: string[]; keepIds: string[] } {
  const group = new Set(groupFileIds);
  const toDelete = new Set(deleteIds);
  if (toDelete.size === 0) throw new UnsafeDeletionError('Nenhuma cópia marcada para excluir.');
  for (const id of toDelete) {
    if (!group.has(id)) throw new UnsafeDeletionError('Um dos arquivos marcados não pertence a este grupo.');
  }
  const keepIds = [...group].filter((id) => !toDelete.has(id));
  if (keepIds.length === 0) {
    throw new UnsafeDeletionError('Não é possível excluir todas as cópias de um grupo. Deixe pelo menos uma.');
  }
  return { deleteIds: [...toDelete], keepIds };
}
