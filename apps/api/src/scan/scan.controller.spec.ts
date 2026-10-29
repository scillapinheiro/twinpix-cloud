import { BadRequestException } from '@nestjs/common';
import type { CloudFolder } from '@twinpix/shared';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { ScanController } from './scan.controller';
import type { ScanService } from './scan.service';

const folder = (path: string): CloudFolder => ({ id: path, name: path.split('/').pop() || 'OneDrive', path, childCount: 0 });

function setup(env: Record<string, string>) {
  const scans = { start: vi.fn(() => 1), summary: vi.fn(() => ({ id: 1 })) };
  const controller = new ScanController(scans as unknown as ScanService, loadConfig(env, []));
  return { scans, controller };
}

describe('ScanController com a trava da pasta de teste', () => {
  it('recusa raízes fora da pasta de teste sem começar a análise', () => {
    const { scans, controller } = setup({ TWINPIX_TEST_FOLDER: '/TwinPix Teste' });
    for (const roots of [[folder('/')], [folder('/Fotos')], [folder('/TwinPix Teste'), folder('/TwinPix Teste 2')]]) {
      expect(() => controller.start({ roots })).toThrow(BadRequestException);
    }
    expect(scans.start).not.toHaveBeenCalled();
  });

  it('aceita a pasta de teste e subpastas', () => {
    const { scans, controller } = setup({ TWINPIX_TEST_FOLDER: '/TwinPix Teste' });
    controller.start({ roots: [folder('/TwinPix Teste'), folder('/TwinPix Teste/Sub')] });
    expect(scans.start).toHaveBeenCalledTimes(1);
  });

  it('sem a trava, qualquer pasta é aceita', () => {
    const { scans, controller } = setup({});
    controller.start({ roots: [folder('/')] });
    expect(scans.start).toHaveBeenCalledTimes(1);
  });
});
