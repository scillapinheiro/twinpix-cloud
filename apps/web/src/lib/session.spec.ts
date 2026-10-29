import { captureTokenFromHash, getToken } from './session';

it('captura o token do endereço e limpa o hash', () => {
  window.location.hash = '#token=abc123';
  captureTokenFromHash();
  expect(getToken()).toBe('abc123');
  expect(window.location.hash).toBe('');
});
