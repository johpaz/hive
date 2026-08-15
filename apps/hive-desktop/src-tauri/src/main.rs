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

#[tauri::command]
fn gateway_info(state: State<'_, GatewayState>) -> serde_json::Value {
    serde_json::json!({
        "port": state.port,
        "url": format!("http://127.0.0.1:{}", state.port),
        "hiveHome": state.hive_home,
    })
}

fn create_window(app: &AppHandle, port: u16) -> Result<(), String> {
    let url =
        url::Url::parse(&format!("http://127.0.0.1:{port}")).map_err(|error| error.to_string())?;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Hive Agents")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
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
        .invoke_handler(tauri::generate_handler![gateway_info])
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
