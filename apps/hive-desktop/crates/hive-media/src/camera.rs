//! Cámara: fotogramas JPEG a baja cadencia, en Linux (V4L2), macOS (AVFoundation)
//! y Windows (Media Foundation) a través de `nokhwa`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Instant;

use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
    Resolution,
};

use crate::error::{MediaError, MediaErrorKind};
use crate::video::{
    encode_jpeg, FrameKind, Pacer, Pixels, VideoFrame, CAMERA_MODEL, CAMERA_PREVIEW,
    CAMERA_PREVIEW_INTERVAL, MODEL_INTERVAL,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraDevice {
    /// Número de la cámara en el sistema, como texto: es lo que se guarda.
    pub id: String,
    pub name: String,
}

pub fn list_cameras() -> Result<Vec<CameraDevice>, MediaError> {
    Ok(nokhwa::query(ApiBackend::Auto)
        .map_err(from_nokhwa)?
        .into_iter()
        .filter(|c| !es_nodo_sin_imagen(&c.index().to_string()))
        .map(|c| CameraDevice { id: c.index().to_string(), name: c.human_name() })
        .collect())
}

/// ¿Este nodo de vídeo es de metadatos y no entrega imagen?
///
/// En Linux una sola webcam aparece como dos nodos: `/dev/video0` (la imagen) y
/// `/dev/video1` (metadatos del sensor). V4L2 los lista a los dos como cámaras,
/// pero el segundo no sirve fotogramas: ofrecerlo, o tomarlo por defecto, deja a
/// la persona eligiendo entre una cámara y un fallo. El sistema publica en
/// sysfs cuál es cuál: la captura es el índice 0 de su dispositivo.
fn es_nodo_sin_imagen(id: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        let ruta = format!("/sys/class/video4linux/video{id}/index");
        return std::fs::read_to_string(ruta)
            .map(|t| t.trim() != "0")
            .unwrap_or(false);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = id;
        false
    }
}

pub struct Camera {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Camera {
    /// Abre la cámara (`None` = la primera) y entrega fotogramas por `on_frame`:
    /// uno por segundo para el modelo y ~8 por segundo, pequeños, para la vista
    /// previa. `on_frame` corre en el hilo de captura: que no bloquee.
    pub fn start(
        device_id: Option<&str>,
        mut on_frame: impl FnMut(VideoFrame) + Send + 'static,
    ) -> Result<Self, MediaError> {
        // Sin cámara elegida, la primera que de verdad entrega imagen: el 0 no
        // siempre lo es (en Linux puede ser un nodo de metadatos).
        let por_defecto = list_cameras()
            .ok()
            .and_then(|l| l.into_iter().next())
            .and_then(|c| c.id.parse::<u32>().ok())
            .unwrap_or(0);
        let index = CameraIndex::Index(
            device_id.and_then(|s| s.parse::<u32>().ok()).unwrap_or(por_defecto),
        );
        let stop = Arc::new(AtomicBool::new(false));
        let stop_t = stop.clone();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), MediaError>>();

        let thread = std::thread::Builder::new()
            .name("hive-media-camera".into())
            .spawn(move || {
                // Como en el audio: se crea y vive en este hilo.
                let formato = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
                    CameraFormat::new(Resolution::new(1280, 720), FrameFormat::MJPEG, 30),
                ));
                let mut camara = match nokhwa::Camera::new(index, formato) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ready_tx.send(Err(from_nokhwa(e)));
                        return;
                    }
                };
                if let Err(e) = camara.open_stream() {
                    let _ = ready_tx.send(Err(from_nokhwa(e)));
                    return;
                }
                let _ = ready_tx.send(Ok(()));

                let (mut modelo, mut previa) =
                    (Pacer::new(MODEL_INTERVAL), Pacer::new(CAMERA_PREVIEW_INTERVAL));
                let mut fallos = 0u32;
                while !stop_t.load(Ordering::Relaxed) {
                    let buffer = match camara.frame() {
                        Ok(b) => {
                            fallos = 0;
                            b
                        }
                        Err(_) => {
                            // Un fallo suelto es un fotograma perdido; si no para, se rinde.
                            fallos += 1;
                            if fallos > 50 {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(40));
                            continue;
                        }
                    };
                    let ahora = Instant::now();
                    let (quiere_modelo, quiere_previa) = (modelo.due(ahora), previa.due(ahora));
                    if !quiere_modelo && !quiere_previa {
                        continue; // sin decodificar: el MJPEG a 30 fps no es gratis
                    }
                    let Ok(img) = buffer.decode_image::<RgbFormat>() else { continue };
                    let (w, h, raw) = (img.width(), img.height(), img.as_raw());
                    if quiere_previa {
                        if let Ok(jpeg) = encode_jpeg(raw, w, h, Pixels::Rgb, CAMERA_PREVIEW) {
                            on_frame(VideoFrame { kind: FrameKind::Preview, jpeg });
                        }
                    }
                    if quiere_modelo {
                        if let Ok(jpeg) = encode_jpeg(raw, w, h, Pixels::Rgb, CAMERA_MODEL) {
                            on_frame(VideoFrame { kind: FrameKind::Model, jpeg });
                        }
                    }
                }
                let _ = camara.stop_stream();
            })
            .map_err(|e| MediaError::other(e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { stop, thread: Some(thread) }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err(MediaError::other("el hilo de la cámara terminó sin responder")),
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Camera {
    fn drop(&mut self) {
        self.stop();
    }
}

/// `nokhwa` no clasifica sus errores; se deduce del texto lo que la interfaz
/// necesita distinguir.
fn from_nokhwa(e: nokhwa::NokhwaError) -> MediaError {
    let texto = e.to_string();
    let bajo = texto.to_lowercase();
    let kind = if bajo.contains("permission") || bajo.contains("denied") || bajo.contains("authoriz") {
        MediaErrorKind::PermissionDenied
    } else if bajo.contains("busy") || bajo.contains("in use") || bajo.contains("resource") {
        MediaErrorKind::Busy
    } else if bajo.contains("no camera") || bajo.contains("not found") || bajo.contains("index") {
        MediaErrorKind::NoDevice
    } else {
        MediaErrorKind::Other
    };
    MediaError::new(kind, texto)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_indice_que_no_existe_no_se_toma_por_nodo_de_metadatos() {
        // Sin entrada en sysfs no hay motivo para descartarlo.
        assert!(!es_nodo_sin_imagen("987654"));
    }

    #[test]
    fn clasifica_los_fallos_que_la_interfaz_distingue() {
        let permiso = from_nokhwa(nokhwa::NokhwaError::GeneralError("Permission denied".into()));
        assert_eq!(permiso.kind, MediaErrorKind::PermissionDenied);
        let ocupada = from_nokhwa(nokhwa::NokhwaError::GeneralError("Device or resource busy".into()));
        assert_eq!(ocupada.kind, MediaErrorKind::Busy);
        let rara = from_nokhwa(nokhwa::NokhwaError::GeneralError("algo raro".into()));
        assert_eq!(rara.kind, MediaErrorKind::Other);
    }
}
