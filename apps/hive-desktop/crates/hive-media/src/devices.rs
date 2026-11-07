//! Dispositivos de audio del sistema. Misma lista en Linux, macOS y Windows:
//! sale de `cpal`, no de `pactl` ni de nada propio de una plataforma.

use cpal::traits::{DeviceTrait, HostTrait};

use crate::error::{MediaError, MediaErrorKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    /// Identificador estable entre ejecuciones; es lo que se guarda como preferencia.
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Input,
    Output,
}

pub fn list(direction: Direction) -> Result<Vec<AudioDevice>, MediaError> {
    let host = cpal::default_host();
    let default_id = match direction {
        Direction::Input => host.default_input_device(),
        Direction::Output => host.default_output_device(),
    }
    .and_then(|d| d.id().ok())
    .map(|id| id.to_string());

    let devices = match direction {
        Direction::Input => host.input_devices()?.collect::<Vec<_>>(),
        Direction::Output => host.output_devices()?.collect::<Vec<_>>(),
    };

    Ok(devices
        .into_iter()
        .filter_map(|d| {
            let id = d.id().ok()?.to_string();
            let name = d.description().map(|x| x.name().to_string()).unwrap_or_else(|_| id.clone());
            if is_noise(direction, &id, &name) {
                return None;
            }
            let is_default = default_id.as_deref() == Some(id.as_str());
            Some(AudioDevice { id, name, is_default })
        })
        .collect())
}

/// Entradas falsas que el backend de PipeWire expone y que no son aparatos.
///
/// PipeWire lista nodos, no tarjetas: los sinks salen también como "entradas"
/// (son el monitor de lo que suena), el sink por defecto aparece como un
/// aparato más y los streams de otras aplicaciones llegan sin nombre. Ofrecerlos
/// como micrófono o altavoz solo confunde.
#[cfg(target_os = "linux")]
fn is_noise(direction: Direction, id: &str, name: &str) -> bool {
    let node = id.strip_prefix("pipewire:").unwrap_or(id);
    if node == "sink_default" || name == "unknown" {
        return true;
    }
    direction == Direction::Input && (node.contains("_output.") || node.contains(".monitor"))
}

#[cfg(not(target_os = "linux"))]
fn is_noise(_direction: Direction, _id: &str, _name: &str) -> bool {
    false
}

/// Abre el dispositivo pedido; si ya no existe —un auricular desconectado— cae
/// al predeterminado en vez de no arrancar por una preferencia vieja.
pub(crate) fn resolve(direction: Direction, id: Option<&str>) -> Result<cpal::Device, MediaError> {
    let host = cpal::default_host();
    if let Some(wanted) = id.filter(|s| !s.is_empty()) {
        if let Ok(parsed) = wanted.parse::<cpal::DeviceId>() {
            if let Some(device) = host.device_by_id(&parsed) {
                return Ok(device);
            }
        }
    }
    match direction {
        Direction::Input => host.default_input_device(),
        Direction::Output => host.default_output_device(),
    }
    .ok_or_else(|| {
        MediaError::new(
            MediaErrorKind::NoDevice,
            match direction {
                Direction::Input => "No se encontró ningún micrófono conectado.",
                Direction::Output => "No se encontró ninguna salida de audio.",
            },
        )
    })
}
