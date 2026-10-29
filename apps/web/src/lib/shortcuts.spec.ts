import { describe, expect, it } from 'vitest';
import { ignoreShortcut } from './shortcuts';

function keyOn(el: HTMLElement): KeyboardEvent {
  document.body.appendChild(el);
  let ev!: KeyboardEvent;
  el.addEventListener('keydown', (e) => { ev = e; });
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  return ev;
}
function input(type: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  return i;
}

describe('ignoreShortcut', () => {
  it.each(['text', 'date', 'time', 'range', 'color', 'file'])('ignora input %s', (type) => {
    expect(ignoreShortcut(keyOn(input(type)))).toBe(true);
  });
  it('deixa passar caixa de marcar', () => {
    expect(ignoreShortcut(keyOn(input('checkbox')))).toBe(false);
  });
});
