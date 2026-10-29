import { describe, expect, it } from 'vitest';
import { folderPathOf, mapFile, mapFolder, type DriveItem } from './map-drive-item';

// Exemplo no formato real de resposta do Graph (dados anonimizados).
const photo: DriveItem = {
  id: 'ABC!101',
  name: '20150206_222631_LLS.jpg',
  size: 2481234,
  webUrl: 'https://onedrive.live.com/?id=ABC%21101',
  createdDateTime: '2015-02-07T10:00:00Z',
  lastModifiedDateTime: '2015-02-07T10:00:00Z',
  parentReference: { driveId: 'abc', id: 'ABC!100', path: '/drive/root:/Imagens/Imagens%20da%20C%C3%A2mera' },
  file: { mimeType: 'image/jpeg', hashes: { quickXorHash: 'q1==' } },
  fileSystemInfo: { createdDateTime: '2015-02-06T22:26:31Z' },
  image: { width: 4128, height: 2322 },
  photo: { takenDateTime: '2015-02-06T22:26:31Z', cameraMake: 'samsung', cameraModel: 'SM-G900M' },
};

describe('mapeamento de driveItem', () => {
  it('converte caminho do Graph para caminho legível', () => {
    expect(folderPathOf(photo)).toBe('/Imagens/Imagens da Câmera');
    expect(folderPathOf({ ...photo, parentReference: { path: '/drive/root:' } })).toBe('/');
    expect(folderPathOf({ ...photo, parentReference: { path: '/drives/abc/root:/X' } })).toBe('/X');
  });

  it('mapeia foto com todos os campos', () => {
    expect(mapFile(photo)).toEqual({
      id: 'ABC!101',
      name: '20150206_222631_LLS.jpg',
      folderPath: '/Imagens/Imagens da Câmera',
      size: 2481234,
      quickXorHash: 'q1==',
      mimeType: 'image/jpeg',
      kind: 'photo',
      takenAt: '2015-02-06T22:26:31Z',
      createdAt: '2015-02-06T22:26:31Z',
      modifiedAt: '2015-02-07T10:00:00Z',
      width: 4128,
      height: 2322,
      cameraMake: 'samsung',
      cameraModel: 'SM-G900M',
      durationMs: null,
      webUrl: 'https://onedrive.live.com/?id=ABC%21101',
    });
  });

  it('vídeo: duração em milissegundos e dimensões do vídeo', () => {
    const v = mapFile({
      ...photo,
      name: 'v.mp4',
      file: { mimeType: 'video/mp4', hashes: { quickXorHash: 'q2' } },
      image: undefined,
      photo: undefined,
      video: { width: 1920, height: 1080, duration: 31000 },
    });
    expect(v).toMatchObject({ kind: 'video', durationMs: 31000, width: 1920, height: 1080, takenAt: null });
  });

  it('ignora arquivos que não são foto nem vídeo e aceita hash ausente', () => {
    expect(mapFile({ ...photo, file: { mimeType: 'application/pdf' }, image: undefined, photo: undefined })).toBeNull();
    expect(mapFile({ ...photo, file: { mimeType: 'image/heic' } })?.quickXorHash).toBeNull();
  });

  it('mapeia pasta, incluindo a raiz', () => {
    expect(mapFolder({ ...photo, name: 'Sub', file: undefined, folder: { childCount: 3 } })).toEqual({
      id: 'ABC!101',
      name: 'Sub',
      path: '/Imagens/Imagens da Câmera/Sub',
      childCount: 3,
    });
    expect(mapFolder({ ...photo, name: 'root', root: {}, parentReference: undefined, folder: { childCount: 2 } }).path).toBe('/');
  });
});
