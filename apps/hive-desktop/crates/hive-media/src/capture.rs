//! Captura de micrófono: PCM16 mono a 16 kHz en bloques de ~40 ms, igual que el
//! AudioWorklet del motor web.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use crate::devices::{resolve, Direction};
use crate::dsp::{downmix, rms, DcBlocker, Framer, Resampler, FRAME_SAMPLES, INPUT_RATE};
use crate::echo::{EchoCanceller, APM_FRAME};
use crate::gate::ResidualGate;
use crate::error::{MediaError, MediaErrorKind};

/// Tiempo tras abrir el dispositivo en el que se entrega silencio. Los
/// micrófonos USB tardan en estabilizarse: medido, ~250 ms de escalón de DC.
const WARMUP_MS: u64 = 300;

pub struct Capture {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    level: Arc<AtomicU32>,
    /// Nivel de lo que se entrega, ya sin eco: comparado con `level` mide cuánto quita.
    out_level: Arc<AtomicU32>,
    /// true desde que se pide parar: los errores que el backend emite al
    /// cerrar el stream ("Device disconnected") ya no son noticia.
    closing: Arc<AtomicBool>,
}

impl Capture {
    /// Abre el micrófono (`None` = el del sistema) y entrega cada bloque PCM16
    /// little-endian a `on_frame`, que corre en el hilo de audio: que no bloquee.
    ///
    /// Con `echo`, el micrófono sale sin el eco de lo que reproduce el `Player`
    /// que comparta ese mismo cancelador.
    pub fn start(
        device_id: Option<&str>,
        echo: Option<EchoCanceller>,
        on_frame: impl FnMut(Vec<u8>) + Send + 'static,
    ) -> Result<Self, MediaError> {
        let device_id = device_id.map(str::to_owned);
        let level = Arc::new(AtomicU32::new(0));
        let level_cb = level.clone();
        let out_level = Arc::new(AtomicU32::new(0));
        let out_level_cb = out_level.clone();
        let closing = Arc::new(AtomicBool::new(false));
        let closing_cb = closing.clone();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), MediaError>>();

        // El stream vive y muere en este hilo: en varias plataformas no es `Send`.
        let thread = std::thread::Builder::new()
            .name("hive-media-capture".into())
            .spawn(move || {
                let stream = match build(device_id.as_deref(), echo, on_frame, level_cb, out_level_cb, closing_cb) {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv();
                drop(stream);
            })
            .map_err(|e| MediaError::other(e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { stop: Some(stop_tx), thread: Some(thread), level, out_level, closing }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err(MediaError::other("el hilo de captura terminó sin responder")),
        }
    }

    /// Nivel RMS reciente (0–1) de lo que capta el micrófono, para el medidor.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// Nivel RMS reciente (0–1) de lo que se entrega, tras quitar el eco.
    pub fn output_level(&self) -> f32 {
        f32::from_bits(self.out_level.load(Ordering::Relaxed))
    }

    pub fn stop(&mut self) {
        self.closing.store(true, Ordering::Relaxed);
        self.stop.take();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn build(
    device_id: Option<&str>,
    echo: Option<EchoCanceller>,
    on_frame: impl FnMut(Vec<u8>) + Send + 'static,
    level: Arc<AtomicU32>,
    out_level: Arc<AtomicU32>,
    closing: Arc<AtomicBool>,
) -> Result<cpal::Stream, MediaError> {
    let device = resolve(Direction::Input, device_id)?;
    let supported = device.default_input_config()?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let stream = match format {
        SampleFormat::F32 => input::<f32>(&device, &config, echo, on_frame, level, out_level, closing),
        SampleFormat::I16 => input::<i16>(&device, &config, echo, on_frame, level, out_level, closing),
        SampleFormat::U16 => input::<u16>(&device, &config, echo, on_frame, level, out_level, closing),
        SampleFormat::I32 => input::<i32>(&device, &config, echo, on_frame, level, out_level, closing),
        other => Err(MediaError::new(
            MediaErrorKind::Unsupported,
            format!("formato de muestra no soportado: {other:?}"),
        )),
    }?;
    stream.play()?;
    Ok(stream)
}

fn input<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    echo: Option<EchoCanceller>,
    mut on_frame: impl FnMut(Vec<u8>) + Send + 'static,
    level: Arc<AtomicU32>,
    out_level: Arc<AtomicU32>,
    closing: Arc<AtomicBool>,
) -> Result<cpal::Stream, MediaError>
where
    T: SizedSample + Copy,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let mut resampler = Resampler::new(config.sample_rate, INPUT_RATE);
    let mut framer = Framer::new(FRAME_SAMPLES);
    let mut dc = DcBlocker::new();
    let warmup_samples = (config.sample_rate as u64 * WARMUP_MS / 1000) as usize;
    let mut vistas = 0usize;
    let (mut floats, mut mono, mut resampled) = (Vec::new(), Vec::new(), Vec::new());
    // El cancelador trabaja en tramas de 10 ms: lo que sobre espera al siguiente ciclo.
    let (mut pendiente, mut limpio) = (Vec::<f32>::new(), Vec::<f32>::new());
    let mut trama = [0.0f32; APM_FRAME];
    // Lo que el cancelador no consigue quitar (televisor, sala con reverberación):
    // se apaga mientras sea del tamaño del eco esperado y no de una voz.
    let mut compuerta = ResidualGate::new();

    let stream = device.build_input_stream(
        config.clone(),
        move |data: &[T], _| {
            floats.clear();
            mono.clear();
            resampled.clear();
            floats.extend(data.iter().map(|s| f32::from_sample(*s)));
            downmix(&floats, channels, &mut mono);
            dc.process(&mut mono);
            if vistas < warmup_samples {
                vistas += mono.len();
                mono.iter_mut().for_each(|s| *s = 0.0);
            }
            level.store(rms(&mono).to_bits(), Ordering::Relaxed);
            resampler.process(&mono, &mut resampled);
            match &echo {
                Some(echo) => {
                    pendiente.extend_from_slice(&resampled);
                    limpio.clear();
                    let mut usadas = 0;
                    while pendiente.len() - usadas >= APM_FRAME {
                        echo.process_capture(&pendiente[usadas..usadas + APM_FRAME], &mut trama);
                        if !compuerta.process(echo.render_level(), rms(&trama)) {
                            trama.fill(0.0);
                        }
                        limpio.extend_from_slice(&trama);
                        usadas += APM_FRAME;
                    }
                    pendiente.drain(..usadas);
                    out_level.store(rms(&limpio).to_bits(), Ordering::Relaxed);
                    framer.push(&limpio, &mut on_frame);
                }
                None => {
                    out_level.store(rms(&resampled).to_bits(), Ordering::Relaxed);
                    framer.push(&resampled, &mut on_frame);
                }
            }
        },
        move |e| {
            if !closing.load(Ordering::Relaxed) {
                eprintln!("[hive-media] error de captura: {e}");
            }
        },
        None,
    )?;
    Ok(stream)
}
