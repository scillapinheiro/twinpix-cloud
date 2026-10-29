// Local-only: npx tsx apps/api/scripts/validate-listing.ts <lsjson.json> [...]
// Input: rclone lsjson -R --files-only --hash --hash-type quickxor
// Probable copies are skipped: rclone listings carry no dimensions/takenAt.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { combineListings, computeListingStats, type LsjsonItem } from '../src/grouping/listing-stats';

function print(label: string, s: ReturnType<typeof computeListingStats>): void {
  console.log(`== ${label} ==`);
  console.log(`arquivos de midia: ${s.files} (fotos ${s.photos}, videos ${s.videos})`);
  console.log(`grupos identicos: ${s.identicalGroups}`);
  console.log(`copias sobrando: ${s.extraCopies}`);
  console.log(`bytes liberaveis: ${s.bytesFreeable} (${(s.bytesFreeable / 1024 ** 3).toFixed(2)} GiB)`);
  console.log(`sem hash: ${s.withoutHash}`);
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('uso: tsx validate-listing.ts <listagem.json> [...]');
  process.exit(1);
}
const listings: LsjsonItem[][] = [];
for (const p of paths) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`erro: nao foi possivel ler/analisar ${p}: ${(e as Error).message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`erro: ${p} nao contem um array JSON (esperado saida de rclone lsjson)`);
    process.exit(1);
  }
  listings.push(parsed as LsjsonItem[]);
  print(basename(p), computeListingStats(parsed as LsjsonItem[]));
}
if (listings.length > 1) print('COMBINADO (grupos entre pastas)', computeListingStats(combineListings(listings)));
console.log('nota: copias provaveis nao avaliadas (rclone nao traz dimensoes/takenAt).');
