import { useEffect, useState, type VideoHTMLAttributes } from "react";

/** <video> que baja el archivo con el token del gateway (la etiqueta no puede mandar Authorization). */
export function AuthVideo({ src, ...rest }: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    const token = localStorage.getItem("hive-auth-token");
    setFailed(false);
    setResolved(null);
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved(objectUrl);
      })
      .catch(() => { if (!revoked) setFailed(true); });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) return <div className="p-4 text-xs text-zinc-500">No se pudo cargar el video.</div>;
  if (!resolved) return <div className="aspect-[9/16] w-full animate-pulse rounded-lg bg-white/5" aria-label="Cargando video" />;
  return <video src={resolved} controls playsInline {...rest} />;
}
