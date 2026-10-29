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

  it('o erro tem nome próprio', () => {
    expect(new UnsafeDeletionError('x').name).toBe('UnsafeDeletionError');
  });

  it('propriedade: ou recusa, ou sempre sobra pelo menos uma cópia do grupo', () => {
    let accepted = 0;
    let refused = 0;
    const scenario = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 8 })
      .chain((group) =>
        fc.record({
          group: fc.constant(group),
          // a seleção vem do próprio grupo (às vezes com repetidos), e às vezes ganha um intruso
          selection: fc.subarray(group).chain((sub) => fc.shuffledSubarray([...sub, ...sub], { minLength: sub.length })),
          outsider: fc.option(fc.string({ minLength: 1, maxLength: 4 }).filter((x) => !group.includes(x)), { freq: 4 }),
        }),
      );
    fc.assert(
      fc.property(scenario, ({ group, selection, outsider }) => {
        const chosen = outsider === null ? selection : [...selection, outsider];
        try {
          const plan = planDeletion(group, chosen);
          accepted += 1;
          const all = new Set([...plan.deleteIds, ...plan.keepIds]);
          return (
            outsider === null &&
            plan.keepIds.length > 0 &&
            plan.deleteIds.every((id) => group.includes(id)) &&
            plan.deleteIds.every((id) => !plan.keepIds.includes(id)) &&
            all.size === group.length
          );
        } catch (e) {
          refused += 1;
          return e instanceof UnsafeDeletionError;
        }
      }),
      { numRuns: 500, seed: 20261029 },
    );
    // garante que os dois caminhos foram de fato exercitados
    expect(accepted).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});
