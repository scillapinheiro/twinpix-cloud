import type { FakeCloudProvider } from './fake-cloud-provider';

/** Árvore fictícia parecida com o caso real (spec §10), para o modo demonstração. */
export function seedDemo(p: FakeCloudProvider): void {
  const imagens = p.addFolder(p.rootId, 'Imagens');
  const camera = p.addFolder(imagens.id, 'Imagens da Câmera');
  const c2015 = p.addFolder(camera.id, '2015');
  const c2016 = p.addFolder(camera.id, '2016');
  const minhas = p.addFolder(p.rootId, 'Minhas imagens');
  const dia = p.addFolder(minhas.id, '07-06-07');
  const minhasFotos = p.addFolder(minhas.id, 'minhas fotos');
  const diaCopia = p.addFolder(minhasFotos.id, '07-06-07');

  const samsung = { cameraMake: 'Samsung', cameraModel: 'SM-G900M' };

  // Backup que rodou duas vezes: "nome.jpg" + "nome 1.jpg" idênticos.
  for (let i = 0; i < 6; i++) {
    const n = `20150206_2226${10 + i}`;
    const common = { size: 2_400_000 + i, quickXorHash: `demo-${n}`, takenAt: `2015-02-06T22:26:${10 + i}Z`, ...samsung };
    p.addFile(c2015.id, { name: `${n}.jpg`, ...common, modifiedAt: '2015-02-07T08:00:00Z' });
    p.addFile(c2015.id, { name: `${n} 1.jpg`, ...common, modifiedAt: '2015-04-21T19:30:00Z' });
  }

  // Vídeo duplicado.
  const video = { size: 48_000_000, quickXorHash: 'demo-video-1', kind: 'video' as const, durationMs: 31_000, width: 1920, height: 1080, ...samsung };
  p.addFile(c2016.id, { name: 'VID_20160101_101010.mp4', ...video, takenAt: '2016-01-01T10:10:10Z' });
  p.addFile(c2016.id, { name: 'VID_20160101_101010 1.mp4', ...video, takenAt: '2016-01-01T10:10:10Z' });

  // Três cópias da mesma foto em pastas diferentes.
  const tripla = { size: 3_100_000, quickXorHash: 'demo-tripla', takenAt: '2016-03-05T15:00:00Z', ...samsung };
  p.addFile(c2016.id, { name: 'IMG_20160305_150000.jpg', ...tripla });
  p.addFile(c2016.id, { name: 'IMG_20160305_150000 (2).jpg', ...tripla, modifiedAt: '2017-01-01T00:00:00Z' });
  p.addFile(minhas.id, { name: 'IMG_20160305_150000.jpg', ...tripla, modifiedAt: '2018-06-01T00:00:00Z' });

  // Pasta inteira duplicada (fotos de 2007), câmera antiga.
  const canon = { cameraMake: 'Canon', cameraModel: 'PowerShot A530', width: 2048, height: 1536 };
  for (let i = 1; i <= 4; i++) {
    const common = { size: 800_000 + i, quickXorHash: `demo-2007-${i}`, takenAt: `2007-06-07T1${i}:00:00Z`, ...canon };
    p.addFile(dia.id, { name: `IMG_000${i}.JPG`, ...common });
    p.addFile(diaCopia.id, { name: `IMG_000${i}.JPG`, ...common, modifiedAt: '2012-01-01T00:00:00Z' });
  }
  // Foto que só existe em "07-06-07" (a outra pasta fica toda contida nela).
  p.addFile(dia.id, { name: 'IMG_0005.JPG', size: 800_005, quickXorHash: 'demo-2007-5', takenAt: '2007-06-07T15:00:00Z', ...canon });

  // Arquivos únicos e um sem hash (vai para "não analisados").
  p.addFile(c2016.id, { name: 'IMG_20160401_090000.jpg', size: 2_000_000, ...samsung });
  p.addFile(c2016.id, { name: 'IMG_20160402_090000.jpg', size: 2_100_000, quickXorHash: null, ...samsung });
}
