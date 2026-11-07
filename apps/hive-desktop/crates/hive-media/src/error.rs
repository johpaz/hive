//! Errores del motor, ya clasificados para que la interfaz diga algo accionable.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaErrorKind {
    /// No hay ningún dispositivo del tipo pedido.
    NoDevice,
    /// El sistema operativo negó el permiso (micrófono, cámara, pantalla).
    PermissionDenied,
    /// Otra aplicación tiene el dispositivo en exclusiva.
    Busy,
    /// El dispositivo no admite ningún formato que sepamos usar.
    Unsupported,
    Other,
}

#[derive(Debug, Clone)]
pub struct MediaError {
    pub kind: MediaErrorKind,
    pub message: String,
}

impl MediaError {
    pub fn new(kind: MediaErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    pub fn other(message: impl Into<String>) -> Self {
        Self::new(MediaErrorKind::Other, message)
    }
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for MediaError {}

impl From<cpal::Error> for MediaError {
    fn from(e: cpal::Error) -> Self {
        use cpal::ErrorKind as K;
        let kind = match e.kind() {
            K::PermissionDenied => MediaErrorKind::PermissionDenied,
            K::DeviceBusy => MediaErrorKind::Busy,
            K::DeviceNotAvailable => MediaErrorKind::NoDevice,
            K::UnsupportedConfig | K::UnsupportedOperation => MediaErrorKind::Unsupported,
            _ => MediaErrorKind::Other,
        };
        Self::new(kind, e.to_string())
    }
}
