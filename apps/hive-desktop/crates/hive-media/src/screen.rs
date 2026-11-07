//! Compartir pantalla: fotogramas JPEG a baja cadencia, con `xcap`.
//!
//! En Linux con Wayland (GNOME, KDE) el sistema no deja leer la pantalla
//! directamente: hay que pedirla por el portal ScreenCast, que enseña el diálogo
//! de «¿qué quieres compartir?» una sola vez y entrega un flujo de PipeWire. Es
//! el mismo recorrido que hace `getDisplayMedia` hoy. En X11, macOS y Windows
//! `xcap` captura directamente.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::error::{MediaError, MediaErrorKind};
use crate::video::{
    encode_jpeg, FrameKind, Pacer, Pixels, VideoFrame, MODEL_INTERVAL, SCREEN_MODEL,
    SCREEN_PREVIEW, SCREEN_PREVIEW_INTERVAL,
};

pub struct ScreenShare {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ScreenShare {
    /// Empieza a compartir. **Bloquea hasta que la persona elige qué compartir**
    /// (o cancela, y entonces devuelve error): quien llame debe hacerlo fuera del
    /// hilo de la interfaz.
    ///
    /// `on_ended` se llama si la compartición termina por su cuenta —la persona
    /// la corta desde el sistema—, y no se llama si es `stop()` quien la cierra.
    pub fn start(
        mut on_frame: impl FnMut(VideoFrame) + Send + 'static,
        on_ended: impl FnOnce() + Send + 'static,
    ) -> Result<Self, MediaError> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_t = stop.clone();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), MediaError>>();

        let thread = std::thread::Builder::new()
            .name("hive-media-screen".into())
            .spawn(move || {
                let preparado = (|| {
                    let monitores = xcap::Monitor::all().map_err(from_xcap)?;
                    let monitor = monitores
                        .iter()
                        .find(|m| m.is_primary().unwrap_or(false))
                        .or_else(|| monitores.first())
                        .ok_or_else(|| {
                            MediaError::new(MediaErrorKind::NoDevice, "No hay ninguna pantalla disponible.")
                        })?;
                    let (grabador, fotogramas) = monitor.video_recorder().map_err(from_xcap)?;
                    grabador.start().map_err(from_xcap)?;
                    Ok::<_, MediaError>((grabador, fotogramas))
                })();
                let (grabador, fotogramas) = match preparado {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));

                let (mut modelo, mut previa) =
                    (Pacer::new(MODEL_INTERVAL), Pacer::new(SCREEN_PREVIEW_INTERVAL));
                let mut terminada_sola = false;
                while !stop_t.load(Ordering::Relaxed) {
                    match fotogramas.recv_timeout(Duration::from_millis(250)) {
                        Ok(f) => {
                            let ahora = Instant::now();
                            if previa.due(ahora) {
                                if let Ok(jpeg) =
                                    encode_jpeg(&f.raw, f.width, f.height, Pixels::Rgba, SCREEN_PREVIEW)
                                {
                                    on_frame(VideoFrame { kind: FrameKind::Preview, jpeg });
                                }
                            }
                            if modelo.due(ahora) {
                                if let Ok(jpeg) =
                                    encode_jpeg(&f.raw, f.width, f.height, Pixels::Rgba, SCREEN_MODEL)
                                {
                                    on_frame(VideoFrame { kind: FrameKind::Model, jpeg });
                                }
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            terminada_sola = true;
                            break;
                        }
                    }
                }
                let _ = grabador.stop();
                if terminada_sola && !stop_t.load(Ordering::Relaxed) {
                    on_ended();
                }
            })
            .map_err(|e| MediaError::other(e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { stop, thread: Some(thread) }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err(MediaError::other("el hilo de pantalla terminó sin responder")),
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for ScreenShare {
    fn drop(&mut self) {
        self.stop();
    }
}

fn from_xcap(e: xcap::XCapError) -> MediaError {
    let texto = e.to_string();
    let bajo = texto.to_lowercase();
    let kind = if bajo.contains("cancel") || bajo.contains("denied") || bajo.contains("permission") {
        MediaErrorKind::PermissionDenied
    } else {
        MediaErrorKind::Other
    };
    MediaError::new(kind, texto)
}
