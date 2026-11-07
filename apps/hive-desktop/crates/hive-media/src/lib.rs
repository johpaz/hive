//! Medios nativos para la voz de Hive: audio hoy; cámara y pantalla después.
//!
//! No depende de Tauri ni de quien lo llame: recibe y entrega bytes. El formato
//! de cable es el de la Live API (PCM16 mono, 16 kHz hacia el modelo y 24 kHz de
//! vuelta), idéntico al del motor web. Funciona igual en Linux, macOS y Windows.

pub mod camera;
pub mod capture;
pub mod devices;
pub mod dsp;
pub mod echo;
pub mod error;
pub mod gate;
pub mod playback;
pub mod screen;
pub mod video;

pub use camera::{list_cameras, Camera, CameraDevice};
pub use capture::Capture;
pub use echo::EchoCanceller;
pub use devices::{list as list_devices, AudioDevice, Direction};
pub use error::{MediaError, MediaErrorKind};
pub use playback::Player;
pub use screen::ScreenShare;
pub use video::{FrameKind, VideoFrame};
