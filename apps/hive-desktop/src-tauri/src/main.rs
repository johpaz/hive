#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    AppHandle, Manager, RunEvent, State, WebviewUrl,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// El mismo puerto que usa la CLI instalada con bun. La app de escritorio
/// tomaba un puerto libre al azar en cada arranque, así que cada instalación
/// vivía en una dirección distinta de la que documentamos y de la que el
/// usuario ve en el navegador.
const DEFAULT_PORT: u16 = 18790;

struct GatewayState {
    child: Mutex<Option<CommandChild>>,
    port: u16,
    hive_home: PathBuf,
    shutting_down: Arc<AtomicBool>,
    /// El gateway ya estaba corriendo (lo levantó la CLI): esta app es solo su
    /// ventana. Nunca hay que matarlo al cerrar ni reiniciarlo.
    external: bool,
}

fn available_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("No se pudo reservar un puerto local: {error}"))
        .and_then(|listener| {
            listener
                .local_addr()
                .map(|address| address.port())
                .map_err(|error| format!("No se pudo leer el puerto local: {error}"))
        })
}

fn spawn_gateway(
    app: &AppHandle,
    port: u16,
    hive_home: &PathBuf,
) -> Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild), String> {
    let port_text = port.to_string();
    let home_text = hive_home.to_string_lossy().to_string();
    let command = app
        .shell()
        // Tauri copies external binaries next to the desktop executable in
        // installed bundles. The source path still lives under `binaries/`,
        // but the runtime sidecar name must be relative to the executable.
        .sidecar("hive-gateway")
        .map_err(|error| format!("No se pudo localizar el gateway incluido: {error}"))?
        .args(["start", "--skip-check"])
        .env("HIVE_HOME", &home_text)
        .env("HIVE_HOST", "127.0.0.1")
        .env("HIVE_PORT", &port_text)
        .env("HIVE_GATEWAY_CHILD", "1")
        .env("NO_BROWSER", "1")
        .env("NODE_ENV", "production");

    command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar el gateway: {error}"))
}

/// Vuelca la salida del sidecar al log de la app. No reinicia nada: de eso se
/// encarga `watch_gateway_health`, porque el proceso que este receptor observa
/// no es el servidor.
fn monitor_gateway(mut events: tauri::async_runtime::Receiver<CommandEvent>) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    println!(
                        "[Hive Gateway] {}",
                        String::from_utf8_lossy(&bytes).trim_end()
                    )
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!(
                        "[Hive Gateway] {}",
                        String::from_utf8_lossy(&bytes).trim_end()
                    )
                }
                CommandEvent::Error(error) => eprintln!("[Hive Gateway] {error}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!("[Hive Gateway] terminado: {payload:?}");
                }
                _ => {}
            }
        }
    });
}

/// Reinicia el gateway cuando deja de responder.
///
/// El evento `Terminated` del sidecar no alcanza: el proceso que Tauri lanza es
/// el envoltorio de la CLI, y el servidor de verdad corre como *nieto*. Cuando
/// ese servidor se muere —un crash, un `hive start` desde la terminal que libera
/// el puerto a la fuerza— el envoltorio sigue vivo, Tauri nunca se entera y la
/// ventana se queda hablándole a un puerto muerto: conectada en apariencia,
/// muda en los hechos. Preguntarle a `/health` es la única señal que cubre los
/// dos casos.
fn watch_gateway_health(
    app: AppHandle,
    port: u16,
    hive_home: PathBuf,
    shutting_down: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if shutting_down.load(Ordering::SeqCst) {
                break;
            }
            if gateway_is_healthy(port) {
                continue;
            }
            // Segunda oportunidad: un turno pesado puede tardar en contestar.
            tokio::time::sleep(Duration::from_secs(3)).await;
            if shutting_down.load(Ordering::SeqCst) || gateway_is_healthy(port) {
                continue;
            }

            eprintln!("[Hive Agents] el gateway dejó de responder — reiniciándolo");
            if let Some(state) = app.try_state::<GatewayState>() {
                if let Ok(mut child) = state.child.lock() {
                    if let Some(previous) = child.take() {
                        let _ = previous.kill();
                    }
                }
            }

            match spawn_gateway(&app, port, &hive_home) {
                Ok((events, next_child)) => {
                    monitor_gateway(events);
                    if let Some(state) = app.try_state::<GatewayState>() {
                        if let Ok(mut child) = state.child.lock() {
                            *child = Some(next_child);
                        }
                    }
                    if wait_for_gateway(port).await.is_err() {
                        eprintln!("[Hive Agents] el gateway reiniciado no respondió a tiempo");
                    }
                }
                Err(error) => eprintln!("[Hive Agents] no se pudo reiniciar el gateway: {error}"),
            }
        }
    });
}

/// `$HIVE_HOME`, o `~/.hive` — el mismo directorio que usa la CLI instalada con
/// bun. Antes la app guardaba todo bajo su propio `app_data_dir`, así que la
/// versión de escritorio y la de terminal eran dos instalaciones separadas con
/// agentes, historial y claves distintos aunque el usuario creyera lo contrario.
fn resolve_hive_home(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("HIVE_HOME") {
        return Ok(PathBuf::from(explicit));
    }
    app.path()
        .home_dir()
        .map(|home| home.join(".hive"))
        .map_err(|error| format!("No se pudo resolver el directorio del usuario: {error}"))
}

fn copy_tree(from: &PathBuf, to: &PathBuf) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

/// Trae los datos que la app dejó en su propio `app_data_dir` cuando usaba un
/// HIVE_HOME separado. Sin esto, mudarse a `~/.hive` sería empezar de cero:
/// agentes, historial, claves y servidores MCP viven en esa carpeta.
fn migrate_legacy_home(app: &AppHandle, hive_home: &PathBuf) {
    if hive_home.join("data").exists() {
        return; // ya hay una instalación acá; no tocar nada
    }
    let Ok(legacy) = app.path().app_data_dir().map(|dir| dir.join("hive")) else {
        return;
    };
    if legacy == *hive_home || !legacy.join("data").exists() {
        return;
    }

    println!("[Hive Agents] migrando datos de {legacy:?} a {hive_home:?}");
    let Ok(entries) = std::fs::read_dir(&legacy) else { return };
    for entry in entries.flatten() {
        let target = hive_home.join(entry.file_name());
        if target.exists() {
            continue; // lo que ya existe en el destino manda
        }
        let source = entry.path();
        if std::fs::rename(&source, &target).is_ok() {
            continue;
        }
        // Otro sistema de archivos: copiar y dejar el original como respaldo.
        if let Err(error) = copy_tree(&source, &target) {
            eprintln!("[Hive Agents] no se pudo migrar {source:?}: {error}");
        }
    }
}

fn start_gateway(app: &AppHandle) -> Result<GatewayState, String> {
    let hive_home = resolve_hive_home(app)?;
    std::fs::create_dir_all(&hive_home)
        .map_err(|error| format!("No se pudo crear HIVE_HOME: {error}"))?;
    migrate_legacy_home(app, &hive_home);
    let shutting_down = Arc::new(AtomicBool::new(false));

    // Ya hay un Hive sano escuchando (por ejemplo `hive start` desde la
    // terminal): esta ventana se conecta a ese y no levanta un segundo gateway.
    // Arrancar otro terminaría matándolo — `hive start` libera el puerto a la
    // fuerza antes de ligarlo.
    if gateway_is_healthy(DEFAULT_PORT) {
        println!("[Hive Agents] gateway ya activo en {DEFAULT_PORT} — usando esa instancia");
        return Ok(GatewayState {
            child: Mutex::new(None),
            port: DEFAULT_PORT,
            hive_home,
            shutting_down,
            external: true,
        });
    }

    // El puerto de siempre; solo si está tomado por algo que no es Hive se cae
    // a uno libre, para que la app arranque igual en vez de morir.
    let port = if TcpListener::bind(("127.0.0.1", DEFAULT_PORT)).is_ok() {
        DEFAULT_PORT
    } else {
        let fallback = available_port()?;
        eprintln!(
            "[Hive Agents] el puerto {DEFAULT_PORT} está ocupado por otro proceso — usando {fallback}"
        );
        fallback
    };

    let (events, child) = spawn_gateway(app, port, &hive_home)?;
    monitor_gateway(events);
    watch_gateway_health(app.clone(), port, hive_home.clone(), shutting_down.clone());

    Ok(GatewayState {
        child: Mutex::new(Some(child)),
        port,
        hive_home,
        shutting_down,
        external: false,
    })
}

async fn wait_for_gateway(port: u16) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(30);

    loop {
        if std::time::Instant::now() >= deadline {
            return Err(format!("El gateway no respondió en el puerto {port}"));
        }

        if gateway_is_healthy(port) {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn gateway_is_healthy(port: u16) -> bool {
    let Some(address) = ("127.0.0.1", port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
    else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ =
        stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    gateway_response_is_healthy(&response)
}

fn gateway_response_is_healthy(response: &str) -> bool {
    (response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
        && response.contains("\"status\":\"ok\"")
}

fn stop_gateway(state: &GatewayState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    if state.external {
        // No lo arrancamos nosotros: cerrar la ventana no puede dejar sin
        // gateway a la terminal que lo levantó.
        return;
    }
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            if let Err(error) = child.kill() {
                eprintln!("[Hive Agents] no se pudo detener el gateway: {error}");
            }
        }
    }
}

/// ¿Puede esta instalación reemplazarse a sí misma?
///
/// Windows (NSIS/MSI) y macOS (bundle `app`) sí: el updater descarga el
/// instalador firmado y lo aplica solo.
///
/// Linux depende del formato. El plugin sabe instalar AppImage, .deb (dpkg) y
/// .rpm (rpm), pidiendo permisos por pkexec cuando hace falta — pero
/// `latest.json` admite **un solo** asset por plataforma y el manifiesto que
/// publicamos lleva el .deb (el bundler no genera artefacto de updater para
/// rpm). O sea: en una máquina con dpkg la actualización funciona, y en una
/// Fedora/RHEL llegaría un .deb que no se puede instalar.
///
/// Antes que ofrecer un botón que descargue algo inservible, acá se responde
/// que no y la UI manda al instalador correcto. Cuando el AppImage vuelva a
/// `bundles` en release.yml, esto puede simplificarse: sirve para todo Linux.
fn self_update_supported() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return true;
    }
    ["/usr/bin/dpkg", "/bin/dpkg"]
        .iter()
        .any(|path| std::path::Path::new(path).exists())
}

#[tauri::command]
fn gateway_info(state: State<'_, GatewayState>) -> serde_json::Value {
    serde_json::json!({
        "port": state.port,
        "url": format!("http://127.0.0.1:{}", state.port),
        "hiveHome": state.hive_home,
        "selfUpdate": self_update_supported(),
    })
}

/// Escala de toda la vista de la aplicación.
///
/// No es un `transform` de CSS: es el zoom del propio motor, así que reescala
/// también lo que la página no controla —tamaños de fuente del sistema,
/// desplazamiento, superficies del canvas— y no rompe el diseño.
#[tauri::command]
fn set_zoom(window: tauri::WebviewWindow, factor: f64) -> Result<(), String> {
    window
        .set_zoom(factor.clamp(0.5, 2.5))
        .map_err(|e| e.to_string())
}

/// Una salida de audio del sistema, tal como la ve el servidor de sonido.
#[derive(serde::Serialize)]
struct SalidaAudio {
    id: String,
    nombre: String,
    #[serde(rename = "porDefecto")]
    por_defecto: bool,
}

/// Salidas de audio disponibles según el sistema operativo.
///
/// Hace falta porque WebKitGTK —el motor del webview en Linux— no implementa
/// `AudioContext.setSinkId()` ni devuelve ningún dispositivo `audiooutput` en
/// `enumerateDevices()`: comprobado sobre 2.52.5, la lista llega vacía incluso
/// con permiso de micrófono concedido.
///
/// Enumera **puertos de tarjeta**, no sinks, que es lo que enseña el menú de
/// sonido del escritorio. Un sink existe sólo para el perfil activo de su
/// tarjeta: en el equipo donde se depuró esto, listar sinks daba dos salidas
/// —HDMI 2 y el Bluetooth— mientras el sistema ofrecía seis, porque los
/// altavoces USB, su salida digital y el HDMI 1 viven en perfiles que no
/// estaban puestos.
///
/// Devuelve el motivo en el error en vez de una lista vacía: una lista vacía es
/// indistinguible de "este equipo no tiene altavoces", y con eso la interfaz no
/// puede decir nada útil.
#[cfg(target_os = "linux")]
#[tauri::command]
fn audio_outputs() -> Result<Vec<SalidaAudio>, String> {
    let tarjetas = pactl_json(&["list", "cards"])?;
    let sinks = pactl_json(&["list", "sinks"])?;
    let por_defecto = pactl(&["get-default-sink"]).unwrap_or_default().trim().to_string();
    Ok(salidas_de(&tarjetas, &sinks, &por_defecto))
}

/// Arma la lista con lo que reporta el servidor de sonido. Aparte del mandado
/// para poder probarla contra capturas reales de `pactl`.
#[cfg(target_os = "linux")]
fn salidas_de(
    tarjetas: &serde_json::Value,
    sinks: &serde_json::Value,
    sink_por_defecto: &str,
) -> Vec<SalidaAudio> {
    let mut salidas = Vec::new();
    for tarjeta in tarjetas.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let id_tarjeta = tarjeta.get("name").and_then(|n| n.as_str()).unwrap_or_default();
        if id_tarjeta.is_empty() {
            continue;
        }
        let nombre_tarjeta = tarjeta
            .get("properties")
            .and_then(|p| p.get("device.description"))
            .and_then(|d| d.as_str())
            .unwrap_or(id_tarjeta);

        // El puerto activo sólo es "el del sistema" si el sink por defecto es el
        // de esta tarjeta: nombres como `analog-output-speaker` se repiten.
        let activo = sink_de_tarjeta(sinks, id_tarjeta)
            .filter(|s| s.get("name").and_then(|n| n.as_str()) == Some(sink_por_defecto))
            .and_then(|s| s.get("active_port").and_then(|p| p.as_str()))
            .unwrap_or_default()
            .to_string();

        let puertos = match tarjeta.get("ports").and_then(|p| p.as_object()) {
            Some(puertos) => puertos,
            None => continue,
        };
        let mut de_esta: Vec<(i64, SalidaAudio)> = Vec::new();
        for (nombre_puerto, puerto) in puertos {
            if !es_puerto_de_salida(nombre_puerto, puerto) {
                continue;
            }
            // Un conector sin nada enchufado; el escritorio tampoco lo ofrece.
            if puerto.get("availability").and_then(|a| a.as_str()) == Some("not available") {
                continue;
            }
            let descripcion = puerto
                .get("description")
                .and_then(|d| d.as_str())
                .filter(|d| !d.is_empty() && *d != "(null)")
                .unwrap_or(nombre_puerto);
            let prioridad = puerto.get("priority").and_then(|p| p.as_i64()).unwrap_or(0);
            de_esta.push((
                prioridad,
                SalidaAudio {
                    id: format!("{id_tarjeta}|{nombre_puerto}"),
                    nombre: format!("{descripcion} – {nombre_tarjeta}"),
                    por_defecto: nombre_puerto.as_str() == activo,
                },
            ));
        }
        // Dentro de cada tarjeta manda la prioridad que declara el sistema: es
        // la que pone los altavoces antes que la salida digital.
        de_esta.sort_by(|a, b| b.0.cmp(&a.0));
        salidas.extend(de_esta.into_iter().map(|(_, salida)| salida));
    }
    salidas
}

/// ¿Este puerto de tarjeta saca sonido?
///
/// El JSON de `pactl` no trae la dirección del puerto, así que se deduce de dos
/// señales que sí trae y que coinciden en ALSA y en Bluetooth: el tipo
/// (`port.type`) y el nombre, que siempre lleva `output` o `input`
/// —`analog-output-speaker`, `headset-hf-output`, `analog-input-mic`—.
#[cfg(target_os = "linux")]
fn es_puerto_de_salida(nombre: &str, puerto: &serde_json::Value) -> bool {
    let tipo = puerto
        .get("properties")
        .and_then(|p| p.get("port.type"))
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    if tipo == "mic" || nombre.contains("input") {
        return false;
    }
    nombre.contains("output")
        || matches!(
            tipo,
            "speaker" | "headphones" | "hdmi" | "spdif" | "line" | "tv" | "headset" | "handsfree"
        )
}

/// El sink que corresponde a una tarjeta.
///
/// El JSON de sinks no trae el índice de su tarjeta, pero los nombres comparten
/// la raíz: `alsa_card.pci-0000_06_00.1` ↔ `alsa_output.pci-0000_06_00.1.hdmi…`,
/// `bluez_card.15_08_…` ↔ `bluez_output.15_08_….1`.
#[cfg(target_os = "linux")]
fn sink_de_tarjeta<'a>(
    sinks: &'a serde_json::Value,
    tarjeta: &str,
) -> Option<&'a serde_json::Value> {
    let raiz = tarjeta.split_once('.').map(|(_, resto)| resto).unwrap_or(tarjeta);
    sinks.as_array()?.iter().find(|sink| {
        sink.get("name")
            .and_then(|n| n.as_str())
            .map(|nombre| nombre.contains(raiz))
            .unwrap_or(false)
    })
}

/// Perfil que hay que activar para que un puerto exista. `None` = no hay que
/// tocar nada, porque el perfil puesto ya lo incluye.
///
/// Entre los candidatos gana el que conserve la entrada de la misma tarjeta: en
/// un aparato USB con micrófono —el caso de este equipo— pasar a
/// `output:analog-stereo` a secas apagaría el micrófono con el que se está
/// hablando, mientras que `output:analog-stereo+input:mono-fallback` deja las
/// dos mitades vivas.
#[cfg(target_os = "linux")]
fn perfil_para(puerto: &serde_json::Value, perfil_activo: &str) -> Option<String> {
    let perfiles: Vec<&str> = puerto
        .get("profiles")?
        .as_array()?
        .iter()
        .filter_map(|p| p.as_str())
        .collect();
    if perfiles.iter().any(|p| *p == perfil_activo) {
        return None;
    }
    perfiles
        .iter()
        .find(|p| p.contains("+input:"))
        .or_else(|| perfiles.first())
        .map(|p| p.to_string())
}

/// Manda la voz de la colmena a una salida concreta.
///
/// Tres pasos, en el orden que pide el sistema: activar el perfil que hace
/// existir el puerto, poner ese puerto en su sink, y mover ahí los flujos de
/// esta aplicación. Sólo los nuestros: la salida por defecto del sistema no se
/// toca, para no reencaminar lo que esté sonando aparte.
///
/// Devuelve cuántos flujos movió. Cero es un resultado válido —el puerto quedó
/// puesto, pero no había nada sonando— y le dice a la página que vuelva a
/// intentarlo cuando la colmena empiece a hablar.
#[cfg(target_os = "linux")]
#[tauri::command]
async fn set_audio_output(id: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Compatibilidad: una preferencia guardada antes de listar puertos lleva
        // el nombre de un sink, sin tarjeta delante.
        let sink = match id.split_once('|') {
            Some((tarjeta, puerto)) => preparar_puerto(tarjeta, puerto)?,
            None => id.clone(),
        };
        Ok(mover_flujos(&sink))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Deja el puerto pedido activo y devuelve el sink por el que ya suena.
#[cfg(target_os = "linux")]
fn preparar_puerto(tarjeta: &str, puerto: &str) -> Result<String, String> {
    let tarjetas = pactl_json(&["list", "cards"])?;
    let datos_tarjeta = tarjetas
        .as_array()
        .and_then(|lista| {
            lista
                .iter()
                .find(|c| c.get("name").and_then(|n| n.as_str()) == Some(tarjeta))
        })
        .ok_or_else(|| format!("La tarjeta de sonido «{tarjeta}» ya no está conectada."))?;
    let datos_puerto = datos_tarjeta
        .get("ports")
        .and_then(|p| p.get(puerto))
        .ok_or_else(|| format!("La salida «{puerto}» ya no existe en esa tarjeta."))?;

    let perfil_activo = datos_tarjeta
        .get("active_profile")
        .and_then(|p| p.as_str())
        .unwrap_or_default();
    if let Some(perfil) = perfil_para(datos_puerto, perfil_activo) {
        pactl(&["set-card-profile", tarjeta, &perfil])
            .ok_or_else(|| format!("El sistema no aceptó activar el perfil «{perfil}»."))?;
    }

    // Tras cambiar de perfil el sink tarda un instante en existir.
    for _ in 0..20 {
        let sinks = pactl_json(&["list", "sinks"])?;
        if let Some(sink) = sink_de_tarjeta(&sinks, tarjeta) {
            let nombre = sink
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string();
            if sink.get("active_port").and_then(|p| p.as_str()) != Some(puerto) {
                pactl(&["set-sink-port", &nombre, puerto])
                    .ok_or_else(|| format!("El sistema no aceptó pasar a «{puerto}»."))?;
            }
            return Ok(nombre);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("El sistema no creó ninguna salida para esa tarjeta.".to_string())
}

/// Mueve a `sink` lo que esté sonando desde esta aplicación.
///
/// Espera medio segundo por si el audio acaba de arrancar, pero no más: si no
/// hay nada sonando, quien reproduce vuelve a llamar con el siguiente bloque de
/// voz, y bloquear aquí sólo retrasaría esa segunda oportunidad.
#[cfg(target_os = "linux")]
fn mover_flujos(sink: &str) -> usize {
    for _ in 0..5 {
        let mut movidos = 0;
        for indice in flujos_propios() {
            if pactl(&["move-sink-input", &indice, sink]).is_some() {
                movidos += 1;
            }
        }
        if movidos > 0 {
            return movidos;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    0
}

/// Índices de los flujos de reproducción que pertenecen a esta aplicación.
///
/// No sirve mirar el PID: el proceso que emite el audio es el que renderiza la
/// página (WebKitWebProcess) y corre en un espacio de nombres propio, así que
/// `application.process.id` llega como un número del sandbox —medido: 2— que no
/// existe fuera. Lo que sí se conserva es el binario que emite y el nombre de la
/// aplicación anfitriona, y la pareja identifica el flujo sin ambigüedad.
#[cfg(target_os = "linux")]
fn flujos_propios() -> Vec<String> {
    let flujos = match pactl_json(&["list", "sink-inputs"]) {
        Ok(flujos) => flujos,
        Err(_) => return Vec::new(),
    };
    let yo = nombre_de_proceso();
    flujos
        .as_array()
        .map(|lista| {
            lista
                .iter()
                .filter_map(|f| {
                    let props = f.get("properties")?;
                    let binario = props.get("application.process.binary")?.as_str()?;
                    let app = props.get("application.name")?.as_str()?;
                    if binario == "WebKitWebProcess" && app == yo {
                        Some(f.get("index")?.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Cómo nos ve el servidor de sonido: el nombre corto de nuestro ejecutable.
#[cfg(target_os = "linux")]
fn nombre_de_proceso() -> String {
    std::fs::read_to_string("/proc/self/comm")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "hive-desktop".to_string())
}

#[cfg(target_os = "linux")]
fn pactl_json(args: &[&str]) -> Result<serde_json::Value, String> {
    let mut completo = vec!["-f", "json"];
    completo.extend_from_slice(args);
    let texto = pactl(&completo).ok_or_else(|| {
        "No se pudo consultar el servidor de sonido: falta `pactl` (paquete pulseaudio-utils) \
         o PipeWire/PulseAudio no está corriendo en esta sesión."
            .to_string()
    })?;
    serde_json::from_str(&texto)
        .map_err(|error| format!("El servidor de sonido respondió algo ilegible: {error}"))
}

#[cfg(target_os = "linux")]
fn pactl(args: &[&str]) -> Option<String> {
    // LC_ALL=C porque los estados vienen traducidos —"no disponible" en un
    // escritorio en español— y aquí se comparan contra literales. Los nombres de
    // los aparatos no se ven afectados: los pone el demonio, no `pactl`.
    let salida = std::process::Command::new("pactl")
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !salida.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&salida.stdout).to_string())
}

/// En Windows el webview es WebView2 —Chromium— y sí expone `setSinkId()` y las
/// salidas en `enumerateDevices()`, así que la interfaz nunca llega hasta aquí:
/// resuelve la elección dentro de la página, igual que la app web.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[tauri::command]
fn audio_outputs() -> Result<Vec<SalidaAudio>, String> {
    Err("Esta plataforma elige la salida desde el propio navegador.".to_string())
}

/// macOS es el único caso sin salida posible, y conviene decirlo en vez de
/// mostrar un selector que no encamina nada: WKWebView tampoco implementa
/// `setSinkId()` —es el mismo WebKit que en Linux—, y CoreAudio no ofrece
/// encaminar una aplicación suelta a un dispositivo: el `default output` es del
/// sistema entero. Cambiarlo desde aquí movería también la música y las
/// reuniones de quien lo use, así que esa elección se deja donde el sistema la
/// pone.
#[cfg(target_os = "macos")]
#[tauri::command]
fn audio_outputs() -> Result<Vec<SalidaAudio>, String> {
    Err("En macOS la salida se elige en Ajustes del Sistema → Sonido: el sistema no permite \
         mandar una sola aplicación a otro altavoz. HiveLive suena por la salida activa."
        .to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn set_audio_output(_id: String) -> Result<usize, String> {
    Err("Esta plataforma elige la salida desde el propio navegador.".to_string())
}

/// Habilita micrófono y cámara dentro de la ventana.
///
/// WebKitGTK arranca con `enable-media-stream` en FALSE y sin manejador de
/// `permission-request`, y wry no toca ninguno de los dos (revisado en wry
/// 0.55.1). Con esa configuración `navigator.mediaDevices` ni siquiera existe
/// dentro de la ventana: el botón de micrófono del webchat fallaba en silencio
/// mientras el mismo build andaba bien en el navegador.
///
/// macOS y Windows no lo necesitan: wry ya responde `Grant` al
/// `requestMediaCapturePermissionForOrigin` de WKWebView, y WebView2 muestra su
/// propio diálogo de permiso. Lo que sí hace falta en macOS es
/// `NSMicrophoneUsageDescription` en el Info.plist (está en `Info.plist`), o el
/// sistema mata el proceso al pedir el micrófono.
#[cfg(target_os = "linux")]
fn enable_media_capture(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::object::Cast;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

    let result = window.with_webview(|webview| {
        let inner = webview.inner();
        if let Some(settings) = WebViewExt::settings(&inner) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
        }
        // Sólo se conceden las peticiones de cámara/micrófono/pantalla. Devolver
        // `false` para el resto (geolocalización, notificaciones, portapapeles…)
        // deja el comportamiento por defecto de WebKit, que es denegarlas.
        //
        // `getDisplayMedia` (compartir pantalla en HiveLive) llega por este mismo
        // tipo de petición y queda concedida con el `allow()` de abajo.
        //
        // No se distingue de la cámara porque el binding de webkit2gtk 2 sólo
        // expone `is_for_audio_device` / `is_for_video_device`; el
        // `is_for_display_device` de WebKitGTK reciente no está enlazado aquí.
        // En Wayland, además, conceder el permiso no basta: la captura la
        // resuelve el portal xdg-desktop-portal, así que si falta el portal el
        // permiso se otorga pero no llega ningún fotograma.
        inner.connect_permission_request(|_, request| {
            match request.clone().downcast::<UserMediaPermissionRequest>() {
                Ok(media) => {
                    media.allow();
                    true
                }
                Err(_) => false,
            }
        });
    });

    if let Err(error) = result {
        eprintln!("[hive-desktop] no se pudo habilitar la captura de audio/video: {error}");
    }
}

#[cfg(not(target_os = "linux"))]
fn enable_media_capture(_window: &tauri::WebviewWindow) {}

fn create_window(app: &AppHandle, port: u16) -> Result<(), String> {
    let url =
        url::Url::parse(&format!("http://127.0.0.1:{port}")).map_err(|error| error.to_string())?;
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Hive Agents")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    enable_media_capture(&window);
    Ok(())
}

fn create_tray(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, "show", "Mostrar Hive", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|error| error.to_string())?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = start_gateway(&app.handle()).map_err(std::io::Error::other)?;
            let port = state.port;
            app.manage(state);

            tauri::async_runtime::block_on(wait_for_gateway(port))
                .map_err(std::io::Error::other)?;
            create_window(&app.handle(), port).map_err(std::io::Error::other)?;
            create_tray(&app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![gateway_info, audio_outputs, set_audio_output, set_zoom])
        .build(tauri::generate_context!())
        .map_err(Into::into)
        .map(|app| {
            app.run(|app_handle, event| {
                if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                    if let Some(state) = app_handle.try_state::<GatewayState>() {
                        stop_gateway(&state);
                    }
                }
            });
        })
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[Hive Agents] {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{copy_tree, gateway_response_is_healthy};
    use std::path::PathBuf;

    #[test]
    fn copy_tree_preserves_nested_data() {
        // La migración a ~/.hive no puede perder el árbol de datos cuando el
        // rename falla por cruzar de sistema de archivos.
        let root = std::env::temp_dir().join(format!("hive-copy-tree-{}", std::process::id()));
        let from = root.join("origen");
        let to = root.join("destino");
        std::fs::create_dir_all(from.join("data/nested")).unwrap();
        std::fs::write(from.join("data/nested/hivedb"), b"contenido").unwrap();

        copy_tree(&from, &to).unwrap();

        assert_eq!(
            std::fs::read(to.join("data/nested/hivedb")).unwrap(),
            b"contenido"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _: PathBuf = to;
    }

    #[test]
    fn starting_health_response_is_not_ready() {
        assert!(!gateway_response_is_healthy(
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"starting\"}"
        ));
    }

    #[test]
    fn completed_health_response_is_ready() {
        assert!(gateway_response_is_healthy(
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"ok\"}"
        ));
    }
}

/// Pruebas de la elección de salida, contra capturas reales del servidor de
/// sonido: son la única forma de comprobar esta lógica sin abrir la ventana.
#[cfg(all(test, target_os = "linux"))]
mod salidas {
    use super::*;

    /// Capturas reales de `pactl` en el equipo donde se depuró esto: dos
    /// tarjetas con varios puertos cada una, una webcam que sólo tiene
    /// micrófono y una tarjeta interna con la salida de auriculares sin nada
    /// enchufado. El escritorio ofrece seis salidas sobre ese mismo estado.
    fn tarjetas() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/pactl-cards.json")).unwrap()
    }

    fn sinks() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/pactl-sinks.json")).unwrap()
    }

    const SINK_POR_DEFECTO: &str = "bluez_output.15_08_20_27_0A_D5.1";

    #[test]
    fn ofrece_las_mismas_salidas_que_el_menu_del_escritorio() {
        // La regresión concreta: listar sinks daba dos salidas —el HDMI activo y
        // el Bluetooth— mientras el sistema mostraba seis. Las otras cuatro
        // viven en perfiles de tarjeta que no estaban puestos.
        let salidas = salidas_de(&tarjetas(), &sinks(), SINK_POR_DEFECTO);
        let nombres: Vec<&str> = salidas.iter().map(|s| s.nombre.as_str()).collect();
        assert_eq!(
            nombres,
            vec![
                "HDMI / DisplayPort – Radeon High Definition Audio Controller",
                "HDMI / DisplayPort 2 – Radeon High Definition Audio Controller",
                "Manos libres – BS-2",
                "Auriculares – BS-2",
                "Altavoces – ME6S",
                "Salida digital (S/PDIF) – ME6S",
            ]
        );
    }

    #[test]
    fn marca_como_actual_solo_el_puerto_del_sink_por_defecto() {
        let salidas = salidas_de(&tarjetas(), &sinks(), SINK_POR_DEFECTO);
        let actuales: Vec<&str> = salidas
            .iter()
            .filter(|s| s.por_defecto)
            .map(|s| s.nombre.as_str())
            .collect();
        assert_eq!(actuales, vec!["Auriculares – BS-2"]);
    }

    #[test]
    fn deja_fuera_micrófonos_y_conectores_sin_nada_enchufado() {
        let salidas = salidas_de(&tarjetas(), &sinks(), SINK_POR_DEFECTO);
        let ids: Vec<&str> = salidas.iter().map(|s| s.id.as_str()).collect();
        // La webcam sólo tiene micrófono; el HDMI 3 y los auriculares de la
        // placa están "not available".
        assert!(!ids.iter().any(|id| id.contains("Live_Cam")));
        assert!(!ids.iter().any(|id| id.ends_with("hdmi-output-2")));
        assert!(!ids.iter().any(|id| id.ends_with("analog-output-headphones")));
        assert!(!ids.iter().any(|id| id.contains("input")));
    }

    #[test]
    fn el_identificador_lleva_tarjeta_y_puerto() {
        let salidas = salidas_de(&tarjetas(), &sinks(), SINK_POR_DEFECTO);
        let altavoces = salidas.iter().find(|s| s.nombre.starts_with("Altavoces")).unwrap();
        assert_eq!(
            altavoces.id,
            "alsa_card.usb-ME6S_MS_N-B_R-UN__3db_ME6S-00|analog-output-speaker"
        );
    }

    #[test]
    fn el_perfil_elegido_conserva_el_microfono_de_la_misma_tarjeta() {
        // Con el micrófono USB en uso, pasar a sus altavoces con
        // `output:analog-stereo` a secas lo apagaría a media conversación.
        let tarjetas = tarjetas();
        let me6s = tarjetas
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"].as_str().unwrap().contains("ME6S"))
            .unwrap();
        let altavoces = me6s.get("ports").unwrap().get("analog-output-speaker").unwrap();
        assert_eq!(
            perfil_para(altavoces, me6s["active_profile"].as_str().unwrap()),
            Some("output:analog-stereo+input:mono-fallback".to_string())
        );
    }

    #[test]
    fn no_cambia_de_perfil_cuando_el_puesto_ya_sirve() {
        let tarjetas = tarjetas();
        let bt = tarjetas
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"].as_str().unwrap().starts_with("bluez_card"))
            .unwrap();
        let auriculares = bt.get("ports").unwrap().get("headset-output").unwrap();
        assert_eq!(perfil_para(auriculares, bt["active_profile"].as_str().unwrap()), None);
    }

    #[test]
    fn empareja_cada_tarjeta_con_su_sink_por_la_raiz_del_nombre() {
        let sinks = sinks();
        let sink = sink_de_tarjeta(&sinks, "alsa_card.pci-0000_06_00.1").unwrap();
        assert_eq!(
            sink["name"].as_str().unwrap(),
            "alsa_output.pci-0000_06_00.1.hdmi-stereo-extra1"
        );
        // Una tarjeta cuyo perfil no crea ningún sink no empareja con nada.
        assert!(sink_de_tarjeta(&sinks, "alsa_card.usb-ME6S_MS_N-B_R-UN__3db_ME6S-00").is_none());
    }

    #[test]
    fn distingue_entradas_de_salidas_en_bluetooth() {
        let tarjetas = tarjetas();
        let bt = tarjetas
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"].as_str().unwrap().starts_with("bluez_card"))
            .unwrap();
        let puertos = bt.get("ports").unwrap().as_object().unwrap();
        // Los tres comparten perfiles: sólo el nombre los separa.
        assert!(!es_puerto_de_salida("headset-input", &puertos["headset-input"]));
        assert!(es_puerto_de_salida("headset-output", &puertos["headset-output"]));
        assert!(es_puerto_de_salida("headset-hf-output", &puertos["headset-hf-output"]));
    }
}

/// La ACL, resuelta igual que en el arranque real.
///
/// La ventana carga el gateway por http, así que para Tauri es un origen
/// remoto y su ACL rechaza cualquier `invoke` que no esté declarado. Eso estuvo
/// roto sin que se notara: la app se veía entera y los comandos fallaban en
/// silencio. Esta prueba resuelve los mismos archivos que compila `generate_context!`
/// y comprueba el permiso desde la URL del gateway, sin abrir ninguna ventana.
#[cfg(test)]
mod acl {
    use std::collections::BTreeMap;
    use tauri_utils::acl::{
        capability::Capability, manifest::Manifest, resolved::Resolved, ExecutionContext,
    };

    #[test]
    fn cada_comando_propio_esta_permitido_desde_el_gateway() {
        let manifiestos: BTreeMap<String, Manifest> =
            serde_json::from_str(include_str!("../gen/schemas/acl-manifests.json")).unwrap();
        let capacidades: BTreeMap<String, Capability> =
            serde_json::from_str(include_str!("../gen/schemas/capabilities.json")).unwrap();
        let resuelta = Resolved::resolve(
            &manifiestos,
            capacidades,
            tauri_utils::platform::Target::Linux,
        )
        .unwrap();

        // Puerto distinto del habitual a propósito: si el 18790 está ocupado la
        // app toma otro libre, y el permiso tiene que seguir valiendo.
        let url: url::Url = "http://127.0.0.1:41337/voz".parse().unwrap();
        for comando in ["gateway_info", "audio_outputs", "set_audio_output", "set_zoom"] {
            let permitido = resuelta
                .allowed_commands
                .get(comando)
                .unwrap_or_else(|| panic!("{comando} no aparece en la ACL resuelta"));
            assert!(
                permitido.iter().any(|entrada| match &entrada.context {
                    ExecutionContext::Remote { url: patron } => patron.test(&url),
                    ExecutionContext::Local => false,
                }),
                "{comando} se rechazaría desde el gateway"
            );
        }
    }

    #[test]
    fn un_origen_ajeno_sigue_sin_acceso() {
        let manifiestos: BTreeMap<String, Manifest> =
            serde_json::from_str(include_str!("../gen/schemas/acl-manifests.json")).unwrap();
        let capacidades: BTreeMap<String, Capability> =
            serde_json::from_str(include_str!("../gen/schemas/capabilities.json")).unwrap();
        let resuelta = Resolved::resolve(
            &manifiestos,
            capacidades,
            tauri_utils::platform::Target::Linux,
        )
        .unwrap();

        let ajena: url::Url = "https://ejemplo.invalido/pagina".parse().unwrap();
        for entrada in resuelta.allowed_commands.get("set_audio_output").unwrap() {
            if let ExecutionContext::Remote { url: patron } = &entrada.context {
                assert!(!patron.test(&ajena), "el permiso alcanza a cualquier sitio");
            }
        }
    }
}
