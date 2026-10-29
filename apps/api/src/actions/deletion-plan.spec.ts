import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planDeletion, UnsafeDeletionError } from './deletion-plan';

describe('planDeletion', () => {
  it('separa o que sai do que fica', () => {
    expect(planDeletion(['a', 'b', 'c'], ['b'])).toEqual({ deleteIds: ['b'], keepIds: ['a', 'c'] });
  });

  it('recusa excluir todas as cópias', () => {
    expect(() => planDeletion(['a', 'b'], ['a', 'b'])).toThrow(UnsafeDeletionError);
  });

  it('recusa seleção vazia', () => {
    expect(() => planDeletion(['a', 'b'], [])).toThrow(UnsafeDeletionError);
  });

  it('recusa arquivo de fora do grupo', () => {
    expect(() => planDeletion(['a', 'b'], ['z'])).toThrow(UnsafeDeletionError);
  });

  it('IDs repetidos na seleção contam uma vez só', () => {
    expect(() => planDeletion(['a', 'b'], ['a', 'a'])).not.toThrow();
    expect(planDeletion(['a', 'b'], ['a', 'a']).deleteIds).toEqual(['a']);
  });

  it('propriedade: ou recusa, ou sempre sobra pelo menos uma cópia do grupo', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 10 }),
        (group, selection) => {
          try {
            const plan = planDeletion(group, selection);
            const all = new Set([...plan.deleteIds, ...plan.keepIds]);
            return (
              plan.keepIds.length > 0 &&
              plan.deleteIds.every((id) => group.includes(id)) &&
              plan.deleteIds.every((id) => !plan.keepIds.includes(id)) &&
              all.size === group.length
            );
          } catch (e) {
            return e instanceof UnsafeDeletionError;
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
