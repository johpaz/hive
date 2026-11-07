//! Procesado de señal puro: sin hardware, sin hilos, probable en una prueba.
//!
//! Aquí vive lo que hoy hace el AudioWorklet de `audio.ts` (remuestreo lineal y
//! armado de bloques PCM16), para que el motor nativo entregue exactamente el
//! mismo formato de cable que el web.

/// Formato de cable fijado por la Live API.
pub const INPUT_RATE: u32 = 16_000;
pub const OUTPUT_RATE: u32 = 24_000;
/// ~40 ms a 16 kHz, igual que `FRAME_SAMPLES` en `audio.ts`.
pub const FRAME_SAMPLES: usize = 640;

/// Remuestreador lineal en streaming. Conserva la fase entre llamadas, así que
/// se puede alimentar con bloques de cualquier tamaño sin costuras.
pub struct Resampler {
    /// Muestras de entrada que avanza la lectura por cada muestra de salida.
    step: f64,
    /// Posición de lectura relativa al inicio del bloque actual (puede ser < 0
    /// cuando quedó una muestra pendiente del bloque anterior).
    pos: f64,
    /// Última muestra del bloque anterior, para interpolar a través del corte.
    prev: f32,
    has_prev: bool,
}

impl Resampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        assert!(from_rate > 0 && to_rate > 0, "frecuencias inválidas");
        Self {
            step: from_rate as f64 / to_rate as f64,
            pos: 0.0,
            prev: 0.0,
            has_prev: false,
        }
    }

    /// Procesa un bloque y añade lo producido a `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        // Con una muestra previa, la posición -1 es esa muestra.
        let first = if self.has_prev { -1.0 } else { 0.0 };
        if self.pos < first {
            self.pos = first;
        }
        let last = (input.len() - 1) as f64;
        while self.pos < last {
            let idx = self.pos.floor();
            let frac = (self.pos - idx) as f32;
            let a = if idx < 0.0 { self.prev } else { input[idx as usize] };
            let b = input[(idx + 1.0) as usize];
            out.push(a + (b - a) * frac);
            self.pos += self.step;
        }
        self.pos -= input.len() as f64;
        self.prev = input[input.len() - 1];
        self.has_prev = true;
    }
}

/// Filtro paso-alto de un polo que elimina el desfase de corriente continua.
///
/// Los micrófonos USB suelen abrir con un escalón de DC (medido aquí: −1,0
/// constante durante ~250 ms y luego decaimiento). Sin quitarlo llega al modelo
/// como un golpe a escala completa y dispara su detección de voz.
pub struct DcBlocker {
    r: f32,
    x1: f32,
    y1: f32,
}

impl DcBlocker {
    /// `r` cercano a 1 deja pasar casi toda la voz; 0,995 corta por debajo de ~40 Hz a 48 kHz.
    pub fn new() -> Self {
        Self { r: 0.995, x1: 0.0, y1: 0.0 }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        for s in samples {
            let y = *s - self.x1 + self.r * self.y1;
            self.x1 = *s;
            self.y1 = y;
            *s = y;
        }
    }
}

impl Default for DcBlocker {
    fn default() -> Self {
        Self::new()
    }
}

/// Mezcla un bloque intercalado de `channels` canales a mono.
pub fn downmix(input: &[f32], channels: usize, out: &mut Vec<f32>) {
    if channels <= 1 {
        out.extend_from_slice(input);
        return;
    }
    for frame in input.chunks_exact(channels) {
        out.push(frame.iter().sum::<f32>() / channels as f32);
    }
}

pub fn f32_to_i16(sample: f32) -> i16 {
    let s = sample.clamp(-1.0, 1.0);
    if s < 0.0 {
        (s * 32768.0) as i16
    } else {
        (s * 32767.0) as i16
    }
}

/// Acumula muestras mono y las entrega en bloques de tamaño fijo.
pub struct Framer {
    size: usize,
    acc: Vec<f32>,
}

impl Framer {
    pub fn new(size: usize) -> Self {
        Self { size, acc: Vec::with_capacity(size * 2) }
    }

    /// Llama a `emit` con cada bloque completo, en PCM16 little-endian.
    pub fn push(&mut self, samples: &[f32], mut emit: impl FnMut(Vec<u8>)) {
        self.acc.extend_from_slice(samples);
        while self.acc.len() >= self.size {
            let bytes: Vec<u8> = self
                .acc
                .drain(..self.size)
                .flat_map(|s| f32_to_i16(s).to_le_bytes())
                .collect();
            emit(bytes);
        }
    }
}

/// PCM16 little-endian → f32, para reproducir lo que llega del modelo.
pub fn pcm16_to_f32(bytes: &[u8], out: &mut Vec<f32>) {
    out.extend(
        bytes
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0),
    );
}

/// Nivel RMS (0–1) de un bloque, para el medidor de la interfaz.
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seno(rate: u32, hz: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn la_cantidad_de_muestras_sigue_la_razon_de_frecuencias() {
        let mut r = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        r.process(&seno(48_000, 440.0, 48_000), &mut out);
        assert!((out.len() as i64 - 16_000).abs() <= 2, "salieron {}", out.len());
    }

    #[test]
    fn subir_la_frecuencia_tambien_conserva_la_duracion() {
        let mut r = Resampler::new(16_000, 48_000);
        let mut out = Vec::new();
        r.process(&seno(16_000, 440.0, 16_000), &mut out);
        assert!((out.len() as i64 - 48_000).abs() <= 3, "salieron {}", out.len());
    }

    #[test]
    fn partir_la_entrada_en_bloques_da_lo_mismo_que_darla_entera() {
        let entrada = seno(44_100, 300.0, 4_410);
        let mut entero = Vec::new();
        Resampler::new(44_100, 16_000).process(&entrada, &mut entero);

        let mut troceado = Vec::new();
        let mut r = Resampler::new(44_100, 16_000);
        for trozo in entrada.chunks(137) {
            r.process(trozo, &mut troceado);
        }
        assert!((entero.len() as i64 - troceado.len() as i64).abs() <= 1);
        let n = entero.len().min(troceado.len());
        for i in 0..n {
            assert!((entero[i] - troceado[i]).abs() < 1e-3, "difiere en {i}");
        }
    }

    #[test]
    fn mantiene_la_forma_de_la_onda() {
        let mut r = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        r.process(&seno(48_000, 200.0, 4_800), &mut out);
        let esperado = seno(16_000, 200.0, out.len());
        let err: f32 = out
            .iter()
            .zip(&esperado)
            .skip(4)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f32::max);
        assert!(err < 0.05, "error máximo {err}");
    }

    #[test]
    fn framer_entrega_bloques_de_640_muestras_en_pcm16() {
        let mut f = Framer::new(FRAME_SAMPLES);
        let mut bloques = Vec::new();
        f.push(&vec![0.5; 1_500], |b| bloques.push(b));
        assert_eq!(bloques.len(), 2);
        assert!(bloques.iter().all(|b| b.len() == FRAME_SAMPLES * 2));
        assert_eq!(i16::from_le_bytes([bloques[0][0], bloques[0][1]]), 16383);
    }

    #[test]
    fn la_conversion_satura_en_los_extremos() {
        assert_eq!(f32_to_i16(2.0), 32767);
        assert_eq!(f32_to_i16(-2.0), -32768);
        assert_eq!(f32_to_i16(0.0), 0);
    }

    #[test]
    fn ida_y_vuelta_pcm16_es_casi_exacta() {
        let mut bytes = Vec::new();
        for s in [-1.0f32, -0.25, 0.0, 0.25, 0.99] {
            bytes.extend(f32_to_i16(s).to_le_bytes());
        }
        let mut out = Vec::new();
        pcm16_to_f32(&bytes, &mut out);
        for (a, b) in [-1.0f32, -0.25, 0.0, 0.25, 0.99].iter().zip(&out) {
            assert!((a - b).abs() < 1e-3);
        }
    }

    #[test]
    fn el_bloqueador_de_dc_deja_a_cero_un_desfase_constante() {
        let mut f = DcBlocker::new();
        let mut x = vec![-1.0f32; 48_000];
        f.process(&mut x);
        // Tras 100 ms el escalón ya casi no se nota.
        let cola = x[4_800..].iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!(cola < 0.01, "queda {cola}");
    }

    #[test]
    fn el_bloqueador_de_dc_respeta_la_voz() {
        let entrada = seno(48_000, 300.0, 9_600);
        let mut salida = entrada.clone();
        DcBlocker::new().process(&mut salida);
        let pico = salida[2_000..].iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!(pico > 0.95, "la voz salió atenuada: {pico}");
    }

    #[test]
    fn downmix_promedia_los_canales() {
        let mut out = Vec::new();
        downmix(&[1.0, 0.0, 0.5, 0.5], 2, &mut out);
        assert_eq!(out, vec![0.5, 0.5]);
    }
}
