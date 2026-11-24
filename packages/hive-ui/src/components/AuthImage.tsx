import { useEffect, useState, type ImgHTMLAttributes } from "react";

/**
 * <img> que descarga la imagen con el token del gateway.
 *
 * Una etiqueta <img> no puede mandar la cabecera Authorization, y las rutas
 * /api/artifacts/* la exigen cuando hay login (contraseña o Google): sin esto
 * la imagen generada salía rota. El token viaja por cabecera, nunca en la URL,
 * para que no quede guardado dentro de los mensajes del chat.
 */
export function AuthImage({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const needsAuth = src.includes("/api/artifacts/");
  const [resolved, setResolved] = useState<string | null>(needsAuth ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!needsAuth) { setResolved(src); return; }
    let revoked = false;
    let objectUrl: string | null = null;
    const token = localStorage.getItem("hive-auth-token");
    setFailed(false);
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
  }, [src, needsAuth]);

  if (failed) {
    return <div className="px-4 py-3 text-xs text-white/50">No se pudo cargar la imagen.</div>;
  }
  if (!resolved) {
    return <div className="h-40 w-64 animate-pulse bg-white/5" aria-label="Cargando imagen" />;
  }
  return <img src={resolved} {...rest} />;
}
