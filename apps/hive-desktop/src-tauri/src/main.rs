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

struct GatewayState {
    child: Mutex<Option<CommandChild>>,
    port: u16,
    hive_home: PathBuf,
    shutting_down: Arc<AtomicBool>,
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

fn monitor_gateway(
    app: AppHandle,
    port: u16,
    hive_home: PathBuf,
    shutting_down: Arc<AtomicBool>,
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
) {
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
                    if shutting_down.load(Ordering::SeqCst) {
                        break;
                    }

                    eprintln!("[Hive Agents] reiniciando el gateway incluido...");
                    match spawn_gateway(&app, port, &hive_home) {
                        Ok((next_events, next_child)) => {
                            if let Some(state) = app.try_state::<GatewayState>() {
                                if let Ok(mut child) = state.child.lock() {
                                    *child = Some(next_child);
                                }
                            }
                            events = next_events;
                        }
                        Err(error) => {
                            eprintln!("[Hive Agents] no se pudo reiniciar el gateway: {error}");
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

fn start_gateway(app: &AppHandle) -> Result<GatewayState, String> {
    let port = available_port()?;
    let hive_home = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver el directorio de datos: {error}"))?
        .join("hive");

    std::fs::create_dir_all(&hive_home)
        .map_err(|error| format!("No se pudo crear HIVE_HOME: {error}"))?;

    let (events, child) = spawn_gateway(app, port, &hive_home)?;
    let shutting_down = Arc::new(AtomicBool::new(false));
    monitor_gateway(
        app.clone(),
        port,
        hive_home.clone(),
        shutting_down.clone(),
        events,
    );

    Ok(GatewayState {
        child: Mutex::new(Some(child)),
        port,
        hive_home,
        shutting_down,
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
    use super::gateway_response_is_healthy;

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
