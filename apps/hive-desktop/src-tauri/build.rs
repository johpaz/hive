fn main() {
    // Los comandos propios de la app necesitan permiso explícito.
    //
    // La ventana no carga archivos empaquetados: apunta al gateway por http, y
    // para Tauri eso es un origen REMOTO. Desde un origen remoto su ACL exige
    // que cada comando esté declarado —declarar `remote` en la capability abre
    // el origen, pero no concede los comandos—, y sin ambas mitades la
    // aplicación arranca entera mientras todos los `invoke` se rechazan con
    // "Command X not allowed by ACL": sin salidas de audio, sin zoom y sin
    // saber si puede autoactualizarse, los tres en silencio.
    //
    // Esto genera un permiso `allow-<comando-con-guiones>` por cada uno; la
    // capability los referencia por ese nombre.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "gateway_info",
                "audio_outputs",
                "set_audio_output",
                "bluetooth_names",
                "set_zoom",
                // Audio nativo (crate hive-media). Misma lista que media::COMMANDS.
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
            ]),
        ),
    )
    .expect("no se pudo generar la ACL de la app de escritorio");
}
