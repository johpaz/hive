//! Reproducción de la voz del modelo: PCM16 mono a 24 kHz → dispositivo de salida.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

use crate::devices::{resolve, Direction};
use crate::dsp::{pcm16_to_f32, Resampler, OUTPUT_RATE};
use crate::echo::{EchoCanceller, APM_FRAME, APM_RATE};
use crate::error::{MediaError, MediaErrorKind};

/// Tope de lo que se admite en cola (a la frecuencia del dispositivo, en segundos).
/// Evita que un productor desbocado agote la memoria.
const MAX_QUEUE_SECONDS: usize = 120;

struct Shared {
    queue: VecDeque<f32>,
    resampler: Resampler,
}

pub struct Player {
    shared: Arc<Mutex<Shared>>,
    device_rate: u32,
    level: Arc<AtomicU32>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    closing: Arc<AtomicBool>,
}

impl Player {
    /// Abre la salida (`None` = la del sistema). Para cambiar de dispositivo se
    /// crea otro `Player`: lo que quedara en cola se descarta.
    ///
    /// Con `echo`, lo que de verdad sale por el altavoz se entrega como
    /// referencia al cancelador que comparta la `Capture`.
    pub fn start(device_id: Option<&str>, echo: Option<EchoCanceller>) -> Result<Self, MediaError> {
        let device_id = device_id.map(str::to_owned);
        let level = Arc::new(AtomicU32::new(0));
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(Arc<Mutex<Shared>>, u32), MediaError>>();
        let level_cb = level.clone();
        let closing = Arc::new(AtomicBool::new(false));
        let closing_cb = closing.clone();

        let thread = std::thread::Builder::new()
            .name("hive-media-playback".into())
            .spawn(move || {
                let built = build(device_id.as_deref(), echo, level_cb, closing_cb);
                let (stream, shared, rate) = match built {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok((shared, rate)));
                let _ = stop_rx.recv();
                drop(stream);
            })
            .map_err(|e| MediaError::other(e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok((shared, device_rate))) => Ok(Self {
                shared,
                device_rate,
                level,
                stop: Some(stop_tx),
                thread: Some(thread),
                closing,
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err(MediaError::other("el hilo de reproducción terminó sin responder")),
        }
    }

    /// Encola un bloque PCM16 little-endian mono a 24 kHz.
    pub fn enqueue(&self, pcm: &[u8]) {
        let mut samples = Vec::with_capacity(pcm.len() / 2);
        pcm16_to_f32(pcm, &mut samples);
        let mut shared = self.shared.lock().unwrap();
        let mut out = Vec::with_capacity(samples.len() * 2);
        shared.resampler.process(&samples, &mut out);
        let cap = self.device_rate as usize * MAX_QUEUE_SECONDS;
        if shared.queue.len() + out.len() > cap {
            return;
        }
        shared.queue.extend(out);
    }

    /// Barge-in: descarta todo lo pendiente.
    pub fn interrupt(&self) {
        let mut shared = self.shared.lock().unwrap();
        shared.queue.clear();
        shared.resampler = Resampler::new(OUTPUT_RATE, self.device_rate);
    }

    /// Milisegundos de audio que faltan por sonar.
    pub fn queued_ms(&self) -> u64 {
        self.shared.lock().unwrap().queue.len() as u64 * 1000 / self.device_rate as u64
    }

    pub fn is_speaking(&self) -> bool {
        self.queued_ms() > 0
    }

    /// Nivel RMS reciente (0–1) de lo que está sonando.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    pub fn stop(&mut self) {
        self.closing.store(true, Ordering::Relaxed);
        self.stop.take();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.stop();
    }
}

fn build(
    device_id: Option<&str>,
    echo: Option<EchoCanceller>,
    level: Arc<AtomicU32>,
    closing: Arc<AtomicBool>,
) -> Result<(cpal::Stream, Arc<Mutex<Shared>>, u32), MediaError> {
    let device = resolve(Direction::Output, device_id)?;
    let supported = device.default_output_config()?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate;

    let shared = Arc::new(Mutex::new(Shared {
        queue: VecDeque::new(),
        resampler: Resampler::new(OUTPUT_RATE, rate),
    }));

    let stream = match format {
        SampleFormat::F32 => output::<f32>(&device, &config, shared.clone(), echo, level, closing),
        SampleFormat::I16 => output::<i16>(&device, &config, shared.clone(), echo, level, closing),
        SampleFormat::U16 => output::<u16>(&device, &config, shared.clone(), echo, level, closing),
        SampleFormat::I32 => output::<i32>(&device, &config, shared.clone(), echo, level, closing),
        other => Err(MediaError::new(
            MediaErrorKind::Unsupported,
            format!("formato de muestra no soportado: {other:?}"),
        )),
    }?;
    stream.play()?;
    Ok((stream, shared, rate))
}

fn output<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<Mutex<Shared>>,
    echo: Option<EchoCanceller>,
    level: Arc<AtomicU32>,
    closing: Arc<AtomicBool>,
) -> Result<cpal::Stream, MediaError>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    // Referencia para el cancelador: lo que se saca del altavoz, a 16 kHz y en
    // tramas de 10 ms. Se alimenta del callback porque ese es el instante real.
    let mut a_16k = Resampler::new(config.sample_rate, APM_RATE);
    let (mut sonado, mut sonado_16k, mut pendiente) =
        (Vec::<f32>::new(), Vec::<f32>::new(), Vec::<f32>::new());
    let stream = device.build_output_stream(
        config.clone(),
        move |data: &mut [T], _| {
            let mut sum = 0.0f32;
            let mut n = 0usize;
            // try_lock: el hilo de audio nunca espera; si el productor está
            // encolando, este ciclo sale en silencio y el siguiente recupera.
            let mut guard = shared.try_lock().ok();
            sonado.clear();
            for frame in data.chunks_mut(channels) {
                let s = guard
                    .as_mut()
                    .and_then(|g| g.queue.pop_front())
                    .unwrap_or(0.0);
                sum += s * s;
                n += 1;
                if echo.is_some() {
                    sonado.push(s);
                }
                for out in frame.iter_mut() {
                    *out = T::from_sample(s);
                }
            }
            let rms = if n > 0 { (sum / n as f32).sqrt() } else { 0.0 };
            level.store(rms.to_bits(), Ordering::Relaxed);

            if let Some(echo) = &echo {
                sonado_16k.clear();
                a_16k.process(&sonado, &mut sonado_16k);
                pendiente.extend_from_slice(&sonado_16k);
                let mut usadas = 0;
                while pendiente.len() - usadas >= APM_FRAME {
                    echo.process_render(&pendiente[usadas..usadas + APM_FRAME]);
                    usadas += APM_FRAME;
                }
                pendiente.drain(..usadas);
            }
        },
        move |e| {
            if !closing.load(Ordering::Relaxed) {
                eprintln!("[hive-media] error de reproducción: {e}");
            }
        },
        None,
    )?;
    Ok(stream)
}
