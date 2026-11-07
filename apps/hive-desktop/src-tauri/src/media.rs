//! Puente de Tauri hacia `hive-media`: expone el audio nativo a la interfaz.
//!
//! Solo traduce. La lógica vive en el crate, que no sabe que existe Tauri. Los
//! bytes de audio viajan crudos —un `Channel` hacia la interfaz, el cuerpo de la
//! petición hacia el reproductor— para no pasar por JSON, que multiplicaría por
//! cuatro lo que cruza el puente cada 40 ms.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use hive_media::{
    AudioDevice, Camera, Capture, Direction, EchoCanceller, MediaError, MediaErrorKind, Player,
    ScreenShare,
};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::State;

#[derive(Default)]
pub struct MediaState {
    /// Uno solo para micrófono y altavoz: el eco se quita con lo que suena, así
    /// que las dos mitades tienen que hablar con el mismo procesador.
    echo: EchoCanceller,
    /// Quién es dueño del micrófono abierto. Cada apertura recibe un número y
    /// solo ese número puede cerrarla: el medidor de Ajustes y la llamada se
    /// turnan el mismo micrófono, y sin esto el cierre tardío del medidor
    /// cortaría el de la llamada recién abierta.
    owner: AtomicU64,
    capture: Mutex<Option<Capture>>,
    player: Mutex<Option<Player>>,
    /// Cámara y pantalla, con la misma regla de propiedad por token que el micrófono.
    camera_owner: AtomicU64,
    camera: Mutex<Option<Camera>>,
    screen_owner: AtomicU64,
    screen: Mutex<Option<ScreenShare>>,
}

/// Fallo clasificado: la interfaz decide qué decirle a la persona según `kind`.
#[derive(Serialize)]
pub struct MediaFailure {
    kind: &'static str,
    message: String,
}

impl From<MediaError> for MediaFailure {
    fn from(e: MediaError) -> Self {
        let kind = match e.kind {
            MediaErrorKind::NoDevice => "no_device",
            MediaErrorKind::PermissionDenied => "permission_denied",
            MediaErrorKind::Busy => "busy",
            MediaErrorKind::Unsupported => "unsupported",
            MediaErrorKind::Other => "other",
        };
        Self { kind, message: e.message }
    }
}

fn fail(message: &str) -> MediaFailure {
    MediaFailure { kind: "other", message: message.to_string() }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDto {
    id: String,
    nombre: String,
    por_defecto: bool,
}

impl From<AudioDevice> for DeviceDto {
    fn from(d: AudioDevice) -> Self {
        Self { id: d.id, nombre: d.name, por_defecto: d.is_default }
    }
}

fn direction(kind: &str) -> Result<Direction, MediaFailure> {
    match kind {
        "input" => Ok(Direction::Input),
        "output" => Ok(Direction::Output),
        _ => Err(fail("dirección de audio desconocida")),
    }
}

#[tauri::command]
pub fn media_list_devices(kind: String) -> Result<Vec<DeviceDto>, MediaFailure> {
    Ok(hive_media::list_devices(direction(&kind)?)?.into_iter().map(Into::into).collect())
}

/// Abre el micrófono y empuja cada bloque PCM16 (16 kHz mono, ~40 ms) por `frames`.
/// Si ya había uno abierto se cierra antes: cambiar de micrófono es llamar de nuevo.
/// Devuelve el token con el que hay que cerrarlo.
#[tauri::command]
pub fn media_mic_start(
    state: State<'_, MediaState>,
    device_id: Option<String>,
    frames: Channel<InvokeResponseBody>,
) -> Result<u64, MediaFailure> {
    let mut slot = state.capture.lock().map_err(|_| fail("estado de captura envenenado"))?;
    // Antes de abrir el nuevo: dos flujos del mismo aparato dan problemas.
    drop(slot.take());
    let capture = Capture::start(device_id.as_deref(), Some(state.echo.clone()), move |pcm| {
        let _ = frames.send(InvokeResponseBody::Raw(pcm));
    })?;
    *slot = Some(capture);
    Ok(state.owner.fetch_add(1, Ordering::SeqCst) + 1)
}

/// Cierra el micrófono solo si `token` sigue siendo el de la apertura vigente.
#[tauri::command]
pub fn media_mic_stop(state: State<'_, MediaState>, token: u64) {
    if let Ok(mut slot) = state.capture.lock() {
        if state.owner.load(Ordering::SeqCst) == token {
            drop(slot.take());
        }
    }
}

/// Abre la salida (`None` = la del sistema). Cambiar de salida es abrir otra vez.
#[tauri::command]
pub fn media_player_start(
    state: State<'_, MediaState>,
    device_id: Option<String>,
) -> Result<(), MediaFailure> {
    let mut slot = state.player.lock().map_err(|_| fail("estado de reproducción envenenado"))?;
    drop(slot.take());
    *slot = Some(Player::start(device_id.as_deref(), Some(state.echo.clone()))?);
    Ok(())
}

/// Encola PCM16 mono a 24 kHz. El cuerpo de la petición son los bytes tal cual.
#[tauri::command]
pub fn media_player_enqueue(
    state: State<'_, MediaState>,
    request: Request<'_>,
) -> Result<(), MediaFailure> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(fail("se esperaban bytes crudos"));
    };
    if let Ok(slot) = state.player.lock() {
        if let Some(player) = slot.as_ref() {
            player.enqueue(bytes);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn media_player_interrupt(state: State<'_, MediaState>) {
    if let Ok(slot) = state.player.lock() {
        if let Some(player) = slot.as_ref() {
            player.interrupt();
        }
    }
}

#[tauri::command]
pub fn media_player_stop(state: State<'_, MediaState>) {
    if let Ok(mut slot) = state.player.lock() {
        drop(slot.take());
    }
}

#[derive(Serialize)]
pub struct CameraDto {
    id: String,
    nombre: String,
}

#[tauri::command]
pub async fn media_list_cameras() -> Result<Vec<CameraDto>, MediaFailure> {
    // Consultar las cámaras toca el sistema (y en algunas plataformas es lento).
    let lista = tauri::async_runtime::spawn_blocking(hive_media::list_cameras)
        .await
        .map_err(|_| fail("la consulta de cámaras se interrumpió"))??;
    Ok(lista.into_iter().map(|c| CameraDto { id: c.id, nombre: c.name }).collect())
}

/// Manda un fotograma a la interfaz: `[etiqueta][jpeg…]`, crudo.
fn enviar(canal: &Channel<InvokeResponseBody>, frame: hive_media::VideoFrame) {
    let _ = canal.send(InvokeResponseBody::Raw(frame.into_wire()));
}

/// Abre la cámara y empuja fotogramas por `frames`. Devuelve el token de cierre.
#[tauri::command]
pub async fn media_camera_start(
    state: State<'_, MediaState>,
    device_id: Option<String>,
    frames: Channel<InvokeResponseBody>,
) -> Result<u64, MediaFailure> {
    // Antes de abrir otra: una cámara no se comparte entre dos aperturas.
    if let Ok(mut slot) = state.camera.lock() {
        drop(slot.take());
    }
    let camara = tauri::async_runtime::spawn_blocking(move || {
        Camera::start(device_id.as_deref(), move |f| enviar(&frames, f))
    })
    .await
    .map_err(|_| fail("la apertura de la cámara se interrumpió"))??;
    let mut slot = state.camera.lock().map_err(|_| fail("estado de cámara envenenado"))?;
    *slot = Some(camara);
    Ok(state.camera_owner.fetch_add(1, Ordering::SeqCst) + 1)
}

#[tauri::command]
pub fn media_camera_stop(state: State<'_, MediaState>, token: u64) {
    if let Ok(mut slot) = state.camera.lock() {
        if state.camera_owner.load(Ordering::SeqCst) == token {
            drop(slot.take());
        }
    }
}

/// Empieza a compartir pantalla. **Tarda lo que tarde la persona en elegir** en el
/// diálogo del sistema; por eso es asíncrono y no congela la ventana. Si la
/// persona corta la compartición desde el sistema, llega un mensaje con la
/// etiqueta `TAG_ENDED` por `frames`.
#[tauri::command]
pub async fn media_screen_start(
    state: State<'_, MediaState>,
    frames: Channel<InvokeResponseBody>,
) -> Result<u64, MediaFailure> {
    if let Ok(mut slot) = state.screen.lock() {
        drop(slot.take());
    }
    let al_terminar = frames.clone();
    let pantalla = tauri::async_runtime::spawn_blocking(move || {
        ScreenShare::start(move |f| enviar(&frames, f), move || {
            let _ = al_terminar.send(InvokeResponseBody::Raw(vec![hive_media::video::TAG_ENDED]));
        })
    })
    .await
    .map_err(|_| fail("la apertura de la pantalla se interrumpió"))??;
    let mut slot = state.screen.lock().map_err(|_| fail("estado de pantalla envenenado"))?;
    *slot = Some(pantalla);
    Ok(state.screen_owner.fetch_add(1, Ordering::SeqCst) + 1)
}

#[tauri::command]
pub fn media_screen_stop(state: State<'_, MediaState>, token: u64) {
    if let Ok(mut slot) = state.screen.lock() {
        if state.screen_owner.load(Ordering::SeqCst) == token {
            drop(slot.take());
        }
    }
}

/// Nombres de los comandos, para la ACL y su prueba: una sola lista.
#[cfg(test)]
pub const COMMANDS: &[&str] = &[
    "media_list_devices",
    "media_mic_start",
    "media_mic_stop",
    "media_player_start",
    "media_player_enqueue",
    "media_player_interrupt",
    "media_player_stop",
    "media_list_cameras",
    "media_camera_start",
    "media_camera_stop",
    "media_screen_start",
    "media_screen_stop",
];

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    /// El contador que reparte tokens: el primero es 1 (0 queda para "ninguno") y
    /// cada apertura invalida el token anterior.
    #[test]
    fn cada_apertura_invalida_el_token_anterior() {
        let owner = AtomicU64::new(0);
        let abrir = || owner.fetch_add(1, Ordering::SeqCst) + 1;
        let medidor = abrir();
        let llamada = abrir();
        assert_eq!(medidor, 1);
        assert_ne!(medidor, llamada);
        // El cierre tardío del medidor ya no coincide con el dueño actual.
        assert_ne!(owner.load(Ordering::SeqCst), medidor);
        assert_eq!(owner.load(Ordering::SeqCst), llamada);
    }
}
