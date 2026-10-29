import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Sem navegador disponível: o endereço já foi mostrado no terminal.
  }
}
