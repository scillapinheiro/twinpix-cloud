import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export function Thumbnail({ fileId, alt }: { fileId: string; alt: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    apiFetch<{ url: string | null }>(`/api/files/${encodeURIComponent(fileId)}/thumbnail`)
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [fileId]);
  if (url === undefined) return <div className="thumb-placeholder" aria-label="Carregando miniatura" />;
  if (url === null) return <div className="thumb-placeholder" role="img" aria-label="Miniatura indisponível">sem miniatura</div>;
  return <img src={url} alt={alt} />;
}
