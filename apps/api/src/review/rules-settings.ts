import type { RuleCriterion } from '@twinpix/shared';
import { DEFAULT_RULES, isValidRules } from '../rules/suggest-keep';
import type { Db } from '../storage/db';

const KEY = 'rules';

export function getRules(db: Db): RuleCriterion[] {
  const row = db.sql.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return defaults();
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return defaults();
  }
  return isValidRules(parsed) ? parsed : defaults();
}

/** Cópia, para que quem recebe possa alterar sem mexer no padrão compartilhado. */
function defaults(): RuleCriterion[] {
  return DEFAULT_RULES.map((r) => ({ ...r }));
}

export function setRules(db: Db, rules: RuleCriterion[]): void {
  db.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(KEY, JSON.stringify(rules));
}
