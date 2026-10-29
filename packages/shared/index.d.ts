export type MediaKind = 'photo' | 'video';

export interface CloudItem {
  id: string;
  name: string;
  /** Caminho da pasta que contém o arquivo, ex.: "/Imagens/2015". Raiz = "/". */
  folderPath: string;
  size: number;
  quickXorHash: string | null;
  mimeType: string;
  kind: MediaKind;
  /** photo.takenDateTime; null quando o OneDrive não informa. */
  takenAt: string | null;
  createdAt: string;
  modifiedAt: string;
  width: number | null;
  height: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  /** Duração do vídeo em milissegundos. */
  durationMs: number | null;
  webUrl: string;
}

export interface CloudFolder {
  id: string;
  name: string;
  /** Caminho completo, ex.: "/Minhas imagens/07-06-07". Raiz = "/". */
  path: string;
  childCount: number;
}

export type ScanStatus = 'running' | 'paused' | 'waiting-network' | 'needs-auth' | 'done' | 'error';

export interface ScanSummary {
  id: number;
  status: ScanStatus;
  roots: CloudFolder[];
  foldersDone: number;
  foldersTotal: number;
  filesFound: number;
  unanalyzedCount: number;
  groupsTotal: number;
  groupsPending: number;
  groupsSkipped: number;
  bytesFreed: number;
  error: string | null;
}

export type GroupStatus = 'pending' | 'skipped' | 'resolved' | 'stale';

export type RuleCriterion =
  | { type: 'largestResolution' }
  | { type: 'largestSize' }
  | { type: 'oldestTaken' }
  | { type: 'oldestModified' }
  | { type: 'inFolder'; path: string }
  | { type: 'notInFolder'; path: string }
  | { type: 'noCopySuffix' };

export interface Suggestion {
  keepId: string;
  /** Ex.: "regra: mais antiga (tirada em)". */
  reason: string;
  /** true só quando a escolha caiu na ordem alfabética (sem regra clara). */
  fallback: boolean;
}

export interface GroupView {
  id: number;
  scanId: number;
  kind: 'identical';
  status: GroupStatus;
  /** Posição 1-based entre todos os grupos da varredura. */
  position: number;
  total: number;
  files: CloudItem[];
  suggestion: Suggestion;
  preMarkedIds: string[];
  bytesFreedSoFar: number;
}

export interface DeletionPreview {
  groupId: number;
  deleteFiles: CloudItem[];
  keepFiles: CloudItem[];
  bytes: number;
}

export type ActionStatus = 'pending' | 'done' | 'failed' | 'undone';

export interface ActionResult {
  actionId: number;
  fileId: string;
  fileName: string;
  status: ActionStatus;
  error: string | null;
}

export interface ApplyResult {
  groupId: number;
  /** true quando algo mudou no OneDrive desde a varredura; nada foi movido. */
  stale: boolean;
  /** true quando a conferência dentro da trava reprovou (ex.: lote); nada foi movido. */
  skipped?: boolean;
  results: ActionResult[];
}

export interface HistoryEntry {
  actionId: number;
  groupId: number;
  file: CloudItem;
  status: ActionStatus;
  error: string | null;
  createdAt: string;
  batchId: number | null;
}

export type RestoreResult = 'restored' | 'not-in-trash' | 'conflict';

export interface UndoResponse {
  result: RestoreResult;
  message: string;
}

export interface AuthStatus {
  /** false quando falta TWINPIX_CLIENT_ID no .env (e não é modo demonstração). */
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  demo: boolean;
}

export interface NestedRoot {
  inner: string;
  outer: string;
}

export interface BatchItem {
  groupId: number;
  keep: { name: string; folderPath: string };
  remove: Array<{ id: string; name: string; folderPath: string; size: number }>;
}

export interface BatchLine {
  key: string;
  keepFolder: string;
  removeFolders: string[];
  reasons: string[];
  groupCount: number;
  fileCount: number;
  bytes: number;
  items: BatchItem[];
}

export interface BatchPreview {
  scanId: number;
  lines: BatchLine[];
  tiesCount: number;
  pendingCount: number;
}

export type BatchStatus = 'running' | 'paused' | 'waiting-network' | 'needs-auth' | 'done' | 'undoing' | 'undone' | 'error';

export interface BatchSummary {
  id: number;
  scanId: number;
  status: BatchStatus;
  createdAt: string;
  totalGroups: number;
  doneGroups: number;
  skippedGroups: number;
  movedFiles: number;
  movedBytes: number;
  failedFiles: number;
  restoredFiles: number;
  notRestoredFiles: number;
  error: string | null;
}
