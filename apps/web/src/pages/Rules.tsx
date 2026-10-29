import type { RuleCriterion } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';

/** Mantenha igual ao DEFAULT_RULES de apps/api/src/rules/suggest-keep.ts. */
const DEFAULT_RULES: RuleCriterion[] = [{ type: 'noCopySuffix' }, { type: 'oldestTaken' }, { type: 'oldestModified' }];

type SimpleType = Exclude<RuleCriterion['type'], 'inFolder' | 'notInFolder'>;

const SIMPLE_OPTIONS: { type: SimpleType; label: string }[] = [
  { type: 'noCopySuffix', label: 'nome sem sufixo de cópia (como "foto (1)")' },
  { type: 'oldestTaken', label: 'mais antiga (tirada em)' },
  { type: 'oldestModified', label: 'mais antiga (modificada em)' },
  { type: 'largestResolution', label: 'maior resolução' },
  { type: 'largestSize', label: 'maior tamanho' },
  { type: 'deeperFolder', label: 'está numa pasta mais organizada (dentro de mais subpastas)' },
];

export function ruleLabel(c: RuleCriterion): string {
  switch (c.type) {
    case 'inFolder': return `está na pasta ${c.path}`;
    case 'notInFolder': return `não está na pasta ${c.path}`;
    default: return SIMPLE_OPTIONS.find((o) => o.type === c.type)?.label ?? c.type;
  }
}

/** Critérios simples que ainda não estão na lista (os de pasta podem repetir com outro caminho). */
function addOptions(rules: RuleCriterion[]): { value: string; label: string }[] {
  const used = new Set(rules.map((r) => r.type));
  return [
    ...SIMPLE_OPTIONS.filter((o) => !used.has(o.type)).map((o) => ({ value: o.type, label: o.label })),
    { value: 'inFolder', label: 'está na pasta…' },
    { value: 'notInFolder', label: 'não está na pasta…' },
  ];
}

export function Rules() {
  const [rules, setRules] = useState<RuleCriterion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('noCopySuffix');
  const [newPath, setNewPath] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<RuleCriterion[]>('/api/settings/rules').then(setRules).catch((e: ApiError) => setError(e.message));
  }, []);

  if (!rules) return error ? <p className="alert" role="alert">{error}</p> : <p>Carregando…</p>;

  const change = (next: RuleCriterion[]) => { setRules(next); setMessage(null); setError(null); };
  const move = (i: number, d: number) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };

  function add() {
    if (selectedType === 'inFolder' || selectedType === 'notInFolder') {
      const typed = newPath.trim();
      const path = typed.length > 1 ? typed.replace(/\/+$/, '') || '/' : typed;
      if (!path.startsWith('/')) { setAddError('Escreva o caminho começando com "/", por exemplo /Imagens/Viagem.'); return; }
      change([...rules!, { type: selectedType, path }]);
    } else {
      change([...rules!, { type: selectedType } as RuleCriterion]);
    }
    setAdding(false); setNewPath(''); setAddError(null);
  }

  async function save() {
    if (rules!.length === 0) { setError('Deixe pelo menos uma regra na lista.'); return; }
    try {
      await apiFetch<RuleCriterion[]>('/api/settings/rules', { method: 'PUT', body: rules });
      setMessage('Regras salvas.');
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const options = addOptions(rules);
  const selectedType = options.some((o) => o.value === newType) ? newType : options[0].value;
  const needsPath = selectedType === 'inFolder' || selectedType === 'notInFolder';

  return (
    <section className="card">
      <h1>Regras de prioridade</h1>
      <p>Quando há cópias, o app sugere manter a que vence a primeira regra; se empatar, passa para a próxima.</p>
      <p className="muted">Mudar as regras não altera lotes já confirmados.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {rules.length === 0 && <p className="muted">Nenhuma regra na lista.</p>}
      <ol className="rules-list">
        {rules.map((r, i) => (
          <li key={`${i}-${r.type}-${'path' in r ? r.path : ''}`} className="row">
            <span className="rule-label">{i + 1}. {ruleLabel(r)}</span>
            <button type="button" className="button" aria-label={`Subir regra: ${ruleLabel(r)}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="button" aria-label={`Descer regra: ${ruleLabel(r)}`} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="button" aria-label={`Remover regra: ${ruleLabel(r)}`} onClick={() => change(rules.filter((_, j) => j !== i))}>Remover</button>
          </li>
        ))}
      </ol>
      {adding ? (
        <div className="row rule-add">
          <label>
            Critério{' '}
            <select value={selectedType} onChange={(e) => { setNewType(e.target.value); setAddError(null); }}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {needsPath && (
            <label className="link-input">
              Pasta{' '}
              <input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="ex.: /Imagens/Viagem" />
            </label>
          )}
          <button type="button" className="button primary" onClick={add}>Incluir regra</button>
          <button type="button" className="button" onClick={() => { setAdding(false); setAddError(null); }}>Cancelar</button>
          {addError && <p className="alert" role="alert">{addError}</p>}
        </div>
      ) : (
        <button type="button" className="button" onClick={() => setAdding(true)}>Adicionar regra</button>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="button primary" onClick={save}>Salvar</button>
        <button type="button" className="button" onClick={() => change(DEFAULT_RULES.map((r) => ({ ...r })))}>Voltar ao padrão</button>
      </div>
      <p className="muted">"Voltar ao padrão" restaura a lista inicial; clique em Salvar para valer.</p>
    </section>
  );
}
