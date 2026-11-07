//! Fotogramas de cámara y pantalla: escalado, JPEG y cadencia.
//!
//! Puro, sin hardware: lo que hoy hacen `camera.ts` y `screen.ts` con un canvas.
//! La Live API recibe fotogramas sueltos —no vídeo continuo— a baja cadencia: con
//! vídeo recorta la sesión de 15 minutos a unos 2 y cada imagen cuesta cientos de
//! tokens. Por eso hay dos tipos de fotograma:
//! - `Model`: el que va al modelo, ~1 por segundo.
//! - `Preview`: pequeño y más frecuente, solo para que la persona se vea; no
//!   sale de la aplicación.

use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{ExtendedColorType, ImageBuffer, Rgb};

use crate::error::MediaError;

/// Primer byte de cada mensaje hacia la interfaz: qué trae el resto.
pub const TAG_MODEL: u8 = 0;
pub const TAG_PREVIEW: u8 = 1;
/// Sin carga: la captura terminó por su cuenta (la persona cortó la compartición).
pub const TAG_ENDED: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    Model,
    Preview,
}

pub struct VideoFrame {
    pub kind: FrameKind,
    pub jpeg: Vec<u8>,
}

impl VideoFrame {
    /// `[etiqueta][jpeg…]`: un solo búfer, que viaja crudo por el IPC.
    pub fn into_wire(self) -> Vec<u8> {
        let tag = match self.kind {
            FrameKind::Model => TAG_MODEL,
            FrameKind::Preview => TAG_PREVIEW,
        };
        let mut out = Vec::with_capacity(self.jpeg.len() + 1);
        out.push(tag);
        out.extend(self.jpeg);
        out
    }
}

/// Mismos valores que `camera.ts` y `screen.ts`.
#[derive(Debug, Clone, Copy)]
pub struct JpegSpec {
    pub max_width: u32,
    /// 1–100.
    pub quality: u8,
}

/// Cámara: de sobra para reconocer una escena.
pub const CAMERA_MODEL: JpegSpec = JpegSpec { max_width: 640, quality: 60 };
pub const CAMERA_PREVIEW: JpegSpec = JpegSpec { max_width: 320, quality: 55 };
/// Pantalla: el doble de ancho y más calidad, porque aquí hay que leer texto.
pub const SCREEN_MODEL: JpegSpec = JpegSpec { max_width: 1280, quality: 72 };
pub const SCREEN_PREVIEW: JpegSpec = JpegSpec { max_width: 640, quality: 55 };

pub const MODEL_INTERVAL: Duration = Duration::from_millis(1000);
pub const CAMERA_PREVIEW_INTERVAL: Duration = Duration::from_millis(125);
pub const SCREEN_PREVIEW_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pixels {
    Rgb,
    Rgba,
}

impl Pixels {
    fn channels(self) -> usize {
        match self {
            Pixels::Rgb => 3,
            Pixels::Rgba => 4,
        }
    }
}

/// Ancho y alto tras reducir a `max_width`, conservando la proporción. Nunca amplía.
pub fn scaled_size(width: u32, height: u32, max_width: u32) -> (u32, u32) {
    if width <= max_width || width == 0 {
        return (width, height);
    }
    let h = (height as u64 * max_width as u64 / width as u64).max(1) as u32;
    (max_width, h)
}

/// Reduce y codifica en JPEG. El alfa se descarta: JPEG no lo tiene.
pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    format: Pixels,
    spec: JpegSpec,
) -> Result<Vec<u8>, MediaError> {
    let canales = format.channels();
    if width == 0 || height == 0 || pixels.len() < width as usize * height as usize * canales {
        return Err(MediaError::other("fotograma vacío o truncado"));
    }
    let rgb: Vec<u8> = match format {
        Pixels::Rgb => pixels[..width as usize * height as usize * 3].to_vec(),
        Pixels::Rgba => pixels
            .chunks_exact(4)
            .take(width as usize * height as usize)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect(),
    };
    let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, rgb)
        .ok_or_else(|| MediaError::other("dimensiones inconsistentes"))?;

    let (w, h) = scaled_size(width, height, spec.max_width);
    let img = if (w, h) != (width, height) {
        imageops::resize(&img, w, h, FilterType::Triangle)
    } else {
        img
    };

    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, spec.quality.clamp(1, 100))
        .encode(img.as_raw(), w, h, ExtendedColorType::Rgb8)
        .map_err(|e| MediaError::other(e.to_string()))?;
    Ok(out)
}

/// Decide cuándo toca emitir. La captura llega a su ritmo, no al nuestro.
pub struct Pacer {
    interval: Duration,
    last: Option<Instant>,
}

impl Pacer {
    pub fn new(interval: Duration) -> Self {
        Self { interval, last: None }
    }

    /// true si ya pasó el intervalo desde la última vez que dijo true. El primero
    /// siempre toca: no se espera un segundo para el primer fotograma.
    pub fn due(&mut self, now: Instant) -> bool {
        match self.last {
            Some(prev) if now.duration_since(prev) < self.interval => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn degradado(w: u32, h: u32, formato: Pixels) -> Vec<u8> {
        let c = formato.channels();
        let mut v = Vec::with_capacity((w * h) as usize * c);
        for y in 0..h {
            for x in 0..w {
                v.extend([(x * 255 / w) as u8, (y * 255 / h) as u8, 128]);
                if c == 4 {
                    v.push(255);
                }
            }
        }
        v
    }

    fn decodificar(jpeg: &[u8]) -> (u32, u32) {
        let (w, h) = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg)
            .map(|i| (i.width(), i.height()))
            .expect("JPEG válido");
        (w, h)
    }

    #[test]
    fn reduce_conservando_la_proporcion() {
        assert_eq!(scaled_size(1920, 1080, 640), (640, 360));
        assert_eq!(scaled_size(2560, 1440, 1280), (1280, 720));
    }

    #[test]
    fn nunca_amplia() {
        assert_eq!(scaled_size(320, 240, 640), (320, 240));
        assert_eq!(scaled_size(640, 480, 640), (640, 480));
    }

    #[test]
    fn el_alto_nunca_se_queda_en_cero() {
        assert_eq!(scaled_size(10_000, 1, 640).1, 1);
    }

    #[test]
    fn el_jpeg_sale_al_ancho_pedido() {
        let px = degradado(1280, 720, Pixels::Rgba);
        let jpeg = encode_jpeg(&px, 1280, 720, Pixels::Rgba, CAMERA_MODEL).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "no empieza como un JPEG");
        assert_eq!(decodificar(&jpeg), (640, 360));
    }

    #[test]
    fn rgb_y_rgba_dan_la_misma_imagen() {
        let a = encode_jpeg(&degradado(64, 48, Pixels::Rgb), 64, 48, Pixels::Rgb, CAMERA_MODEL).unwrap();
        let b = encode_jpeg(&degradado(64, 48, Pixels::Rgba), 64, 48, Pixels::Rgba, CAMERA_MODEL).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn mas_calidad_pesa_mas() {
        let px = degradado(640, 480, Pixels::Rgb);
        let baja = encode_jpeg(&px, 640, 480, Pixels::Rgb, JpegSpec { max_width: 640, quality: 30 }).unwrap();
        let alta = encode_jpeg(&px, 640, 480, Pixels::Rgb, JpegSpec { max_width: 640, quality: 90 }).unwrap();
        assert!(alta.len() > baja.len());
    }

    #[test]
    fn un_fotograma_truncado_es_un_error_no_un_panico() {
        assert!(encode_jpeg(&[0; 10], 640, 480, Pixels::Rgb, CAMERA_MODEL).is_err());
        assert!(encode_jpeg(&[], 0, 0, Pixels::Rgb, CAMERA_MODEL).is_err());
    }

    #[test]
    fn el_cable_lleva_la_etiqueta_delante() {
        let f = VideoFrame { kind: FrameKind::Preview, jpeg: vec![9, 9] }.into_wire();
        assert_eq!(f, vec![TAG_PREVIEW, 9, 9]);
        let f = VideoFrame { kind: FrameKind::Model, jpeg: vec![7] }.into_wire();
        assert_eq!(f, vec![TAG_MODEL, 7]);
    }

    #[test]
    fn el_primer_fotograma_no_espera_y_los_siguientes_si() {
        let t0 = Instant::now();
        let mut p = Pacer::new(Duration::from_millis(1000));
        assert!(p.due(t0));
        assert!(!p.due(t0 + Duration::from_millis(400)));
        assert!(!p.due(t0 + Duration::from_millis(999)));
        assert!(p.due(t0 + Duration::from_millis(1000)));
        // El intervalo cuenta desde la última emisión, no desde el principio.
        assert!(!p.due(t0 + Duration::from_millis(1500)));
        assert!(p.due(t0 + Duration::from_millis(2000)));
    }
}
