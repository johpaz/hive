//! Prueba a mano del motor, sin Tauri:
//!   cargo run --example probe -- list
//!   cargo run --example probe -- tone [salida]
//!   cargo run --example probe -- loopback [entrada] [salida]   (graba 4 s y los reproduce)

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hive_media::dsp::{f32_to_i16, Resampler, INPUT_RATE, OUTPUT_RATE};
use hive_media::{list_devices, Camera, Capture, Direction, EchoCanceller, FrameKind, Player, ScreenShare};

fn arg(n: usize) -> Option<String> {
    std::env::args().nth(n).filter(|s| !s.is_empty() && s != "-")
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("list") => {
            for (titulo, dir) in [("Entradas", Direction::Input), ("Salidas", Direction::Output)] {
                println!("{titulo}:");
                match list_devices(dir) {
                    Ok(l) if l.is_empty() => println!("  (ninguna)"),
                    Ok(l) => {
                        for d in l {
                            println!("  {} {}  [{}]", if d.is_default { "*" } else { " " }, d.name, d.id);
                        }
                    }
                    Err(e) => println!("  error: {e}"),
                }
            }
        }
        Some("tone") => {
            let player = Player::start(arg(2).as_deref(), None).expect("abrir salida");
            // Dos notas como las de `probar()` en audio.ts: 660 y 990 Hz.
            for hz in [660.0f32, 990.0] {
                let n = (OUTPUT_RATE as f32 * 0.4) as usize;
                let mut bytes = Vec::with_capacity(n * 2);
                for i in 0..n {
                    let t = i as f32 / OUTPUT_RATE as f32;
                    let env = (i.min(n - i) as f32 / 480.0).min(1.0);
                    let s = (2.0 * std::f32::consts::PI * hz * t).sin() * 0.2 * env;
                    bytes.extend(f32_to_i16(s).to_le_bytes());
                }
                player.enqueue(&bytes);
            }
            while player.is_speaking() {
                std::thread::sleep(Duration::from_millis(50));
            }
            std::thread::sleep(Duration::from_millis(200));
            println!("ok: tono reproducido");
        }
        Some("levels") => {
            // Diagnóstico: formato real del dispositivo y nivel cada 250 ms,
            // con pico de muestra, para distinguir saturación de un error.
            use cpal::traits::{DeviceTrait, HostTrait};
            let host = cpal::default_host();
            if let Some(d) = host.default_input_device() {
                if let Ok(c) = d.default_input_config() {
                    println!("host {:?} | {:?}", host.id(), c);
                }
            }
            let pico = Arc::new(Mutex::new(0i16));
            let p = pico.clone();
            let capture = Capture::start(arg(2).as_deref(), None, move |b| {
                let m = b.chunks_exact(2).map(|x| i16::from_le_bytes([x[0], x[1]]).saturating_abs()).max().unwrap_or(0);
                let mut g = p.lock().unwrap();
                *g = (*g).max(m);
            })
            .expect("abrir micrófono");
            for _ in 0..16 {
                std::thread::sleep(Duration::from_millis(250));
                let mut g = pico.lock().unwrap();
                println!("rms {:.3}  pico muestra {:>5}/32767", capture.level(), *g);
                *g = 0;
            }
        }
        Some("aec") => aec_en_la_habitacion(),
        Some("aecdump") => volcar_para_analisis(),
        Some("aecanalyze") => analizar_volcado(),
        Some("gatelong") => compuerta_larga(),
        Some("cameras") => match hive_media::list_cameras() {
            Ok(l) if l.is_empty() => println!("(ninguna cámara)"),
            Ok(l) => l.iter().for_each(|c| println!("  {}  {}", c.id, c.name)),
            Err(e) => println!("error: {e}"),
        },
        Some("camera") => capturar_video(false),
        Some("screen") => capturar_video(true),
        Some("loopback") => {
            let grabado: Arc<Mutex<Vec<u8>>> = Arc::default();
            let destino = grabado.clone();
            let capture = Capture::start(arg(2).as_deref(), None, move |bloque| {
                destino.lock().unwrap().extend(bloque);
            })
            .expect("abrir micrófono");

            println!("Habla durante 4 s…");
            let inicio = Instant::now();
            let mut pico = 0.0f32;
            while inicio.elapsed() < Duration::from_secs(4) {
                pico = pico.max(capture.level());
                std::thread::sleep(Duration::from_millis(40));
            }
            drop(capture);

            let bytes = grabado.lock().unwrap().clone();
            let muestras = bytes.len() / 2;
            println!(
                "Capturado: {} muestras a {} Hz = {:.2} s, nivel pico {:.3}",
                muestras, INPUT_RATE, muestras as f32 / INPUT_RATE as f32, pico
            );

            // 16 kHz de entrada → 24 kHz de salida, como si lo dijera el modelo.
            let mut f = Vec::new();
            hive_media::dsp::pcm16_to_f32(&bytes, &mut f);
            let mut subido = Vec::new();
            Resampler::new(INPUT_RATE, OUTPUT_RATE).process(&f, &mut subido);
            let pcm: Vec<u8> = subido.iter().flat_map(|s| f32_to_i16(*s).to_le_bytes()).collect();

            let player = Player::start(arg(3).as_deref(), None).expect("abrir salida");
            player.enqueue(&pcm);
            while player.is_speaking() {
                std::thread::sleep(Duration::from_millis(50));
            }
            std::thread::sleep(Duration::from_millis(200));
            println!("ok");
        }
        _ => eprintln!("uso: probe aecdump <entrada> <salida> <carpeta> | aecanalyze <carpeta> | cameras | camera [id] [salida.jpg] | screen [salida.jpg] | list | tone [salida] | loopback [entrada] [salida] | aec [entrada] [salida] [salida.wav]"),
    }
}

/// Voz sintética para sonar por los altavoces: armónicos con tono y sílabas
/// variables más un soplo de ruido, a 24 kHz.
fn senal_lejana(segundos: f32) -> Vec<u8> {
    let n = (OUTPUT_RATE as f32 * segundos) as usize;
    let mut ruido = 12345u32;
    (0..n)
        .flat_map(|i| {
            let t = i as f32 / OUTPUT_RATE as f32;
            let f0 = 130.0 + 45.0 * (2.0 * std::f32::consts::PI * 0.6 * t).sin();
            let fase = 2.0 * std::f32::consts::PI * f0 * t;
            let armonicos: f32 = (1..=8).map(|k| (fase * k as f32).sin() / k as f32).sum();
            ruido = ruido.wrapping_mul(1664525).wrapping_add(1013904223);
            let soplo = ((ruido >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.15;
            let silaba = 0.35 + 0.65 * (2.0 * std::f32::consts::PI * 3.5 * t).sin().max(0.0);
            f32_to_i16((armonicos * 0.45 + soplo) * silaba * 0.8).to_le_bytes()
        })
        .collect()
}

fn escribir_wav(ruta: &str, pcm16: &[u8], rate: u32) {
    let mut f = Vec::with_capacity(44 + pcm16.len());
    f.extend(b"RIFF");
    f.extend((36 + pcm16.len() as u32).to_le_bytes());
    f.extend(b"WAVEfmt ");
    f.extend(16u32.to_le_bytes());
    f.extend(1u16.to_le_bytes());
    f.extend(1u16.to_le_bytes());
    f.extend(rate.to_le_bytes());
    f.extend((rate * 2).to_le_bytes());
    f.extend(2u16.to_le_bytes());
    f.extend(16u16.to_le_bytes());
    f.extend(b"data");
    f.extend((pcm16.len() as u32).to_le_bytes());
    f.extend(pcm16);
    std::fs::write(ruta, f).expect("escribir wav");
}

/// Mide el cancelador con tu equipo real. Dos fases de 6 s con una señal sonando
/// por los altavoces: primero callado (cuánto eco queda) y después hablando
/// encima (cuánta voz sobrevive). Sin auriculares.
fn aec_en_la_habitacion() {
    let echo = EchoCanceller::new();
    let grabado: Arc<Mutex<Vec<u8>>> = Arc::default();
    let destino = grabado.clone();
    let capture = Capture::start(arg(2).as_deref(), Some(echo.clone()), move |b| {
        destino.lock().unwrap().extend(b);
    })
    .expect("abrir micrófono");
    let player = Player::start(arg(3).as_deref(), Some(echo)).expect("abrir salida");

    let promedio = |v: &[f32]| if v.is_empty() { 0.0 } else { v.iter().sum::<f32>() / v.len() as f32 };
    let db = |a: f32, b: f32| 20.0 * (a.max(1e-9) / b.max(1e-9)).log10();

    println!("Sonará una señal por los altavoces durante 12 s. Usa altavoces, no auriculares.");
    player.enqueue(&senal_lejana(12.5));

    let fase = |nombre: &str, instruccion: &str| -> (f32, f32) {
        println!("\n{nombre}: {instruccion}");
        let (mut crudo, mut limpio) = (Vec::new(), Vec::new());
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(6) {
            std::thread::sleep(Duration::from_millis(40));
            // Los dos primeros segundos son de convergencia: no cuentan.
            if t0.elapsed() > Duration::from_secs(2) {
                crudo.push(capture.level());
                limpio.push(capture.output_level());
            }
        }
        (promedio(&crudo), promedio(&limpio))
    };

    let (c1, l1) = fase("Fase 1", "quédate en silencio");
    let (c2, l2) = fase("Fase 2", "habla con normalidad encima, cuenta del 1 al 10");

    if c1 < 1e-4 && c2 < 1e-4 {
        println!("\nEl micrófono no captó nada (nivel {c1:.5}): la medición no vale.");
        println!("Probablemente es el micrófono predeterminado y no tiene nada conectado.");
        println!("Pásale el id del que usas: `probe aec <entrada> <salida> [wav]`; mira `probe list`.");
        return;
    }

    println!("\n--- Resultado ---");
    println!("Fase 1 (solo eco):   micrófono {c1:.4} -> tras AEC {l1:.4}   atenuación {:.1} dB", db(c1, l1));
    println!("Fase 2 (hablando):   micrófono {c2:.4} -> tras AEC {l2:.4}   atenuación {:.1} dB", db(c2, l2));
    println!("Tu voz sobre el eco residual: {:.1} dB", db(l2, l1));
    println!("  (> 6 dB: se te oye y se puede interrumpir; cerca de 0: el AEC se comió tu voz)");

    drop(capture);
    drop(player);
    if let Some(ruta) = arg(4) {
        escribir_wav(&ruta, &grabado.lock().unwrap(), INPUT_RATE);
        println!("\nAudio ya procesado guardado en {ruta} (16 kHz mono): escúchalo.");
    }
}

/// Guarda el primer fotograma `Model` en un JPEG y cuenta los de vista previa que
/// llegan mientras tanto. `camera [id] [ruta]` o `screen [ruta]`.
fn capturar_video(pantalla: bool) {
    let (id, ruta) = if pantalla {
        (None, arg(2).unwrap_or_else(|| "pantalla.jpg".into()))
    } else {
        (arg(2), arg(3).unwrap_or_else(|| "camara.jpg".into()))
    };
    let (tx, rx) = std::sync::mpsc::channel::<(FrameKind, Vec<u8>)>();
    let enviar = move |f: hive_media::VideoFrame| {
        let _ = tx.send((f.kind, f.jpeg));
    };

    println!("Abriendo {}…", if pantalla { "la pantalla (elige qué compartir en el diálogo)" } else { "la cámara" });
    let t0 = Instant::now();
    let (_camara, _pantalla);
    if pantalla {
        _pantalla = Some(ScreenShare::start(enviar, || println!("(la compartición terminó sola)")).expect("abrir pantalla"));
        _camara = None;
    } else {
        _camara = Some(Camera::start(id.as_deref(), enviar).expect("abrir cámara"));
        _pantalla = None;
    }
    println!("Abierta en {:.1} s. Capturando 4 s…", t0.elapsed().as_secs_f32());

    let (mut previas, mut modelos, mut guardado) = (0, 0, false);
    let inicio = Instant::now();
    while inicio.elapsed() < Duration::from_secs(4) {
        if let Ok((tipo, jpeg)) = rx.recv_timeout(Duration::from_millis(200)) {
            match tipo {
                FrameKind::Preview => previas += 1,
                FrameKind::Model => {
                    modelos += 1;
                    if !guardado {
                        std::fs::write(&ruta, &jpeg).expect("escribir jpeg");
                        println!("Fotograma para el modelo: {} KB -> {ruta}", jpeg.len() / 1024);
                        guardado = true;
                    }
                }
            }
        }
    }
    println!("En 4 s: {modelos} para el modelo (esperado ~4) y {previas} de vista previa.");
}

fn leer_wav(ruta: &std::path::Path) -> Vec<f32> {
    let b = std::fs::read(ruta).expect("leer wav");
    b[44..].chunks_exact(2).map(|x| i16::from_le_bytes([x[0], x[1]]) as f32 / 32768.0).collect()
}

fn a_pcm(x: &[f32]) -> Vec<u8> {
    x.iter().flat_map(|s| f32_to_i16(*s).to_le_bytes()).collect()
}

/// Graba el micrófono SIN cancelar nada, junto con la señal exacta que sonó, y
/// lo guarda alineado en el tiempo. Con eso se puede probar después cualquier
/// configuración del cancelador sin volver a poner sonido en la habitación.
///   aecdump <entrada> <salida> <carpeta>
fn volcar_para_analisis() {
    let carpeta = std::path::PathBuf::from(arg(4).expect("falta la carpeta de salida"));
    std::fs::create_dir_all(&carpeta).expect("crear carpeta");

    let crudo: Arc<Mutex<Vec<u8>>> = Arc::default();
    let destino = crudo.clone();
    let t_captura = Instant::now();
    let _mic = Capture::start(arg(2).as_deref(), None, move |b| destino.lock().unwrap().extend(b))
        .expect("abrir micrófono");
    std::thread::sleep(Duration::from_millis(600)); // pasa el silencio de arranque

    let lejana_24k = senal_lejana(14.5);
    let t_sonido = Instant::now();
    let player = Player::start(arg(3).as_deref(), None).expect("abrir salida");
    player.enqueue(&lejana_24k);
    let desfase = (t_sonido - t_captura).as_secs_f32();

    println!("Sonará una señal por el altavoz durante 14 s.");
    println!("0-7 s: QUÉDATE EN SILENCIO.");
    std::thread::sleep(Duration::from_secs(7));
    println!("7-14 s: HABLA con normalidad encima (cuenta del 1 al 10, repite).");
    std::thread::sleep(Duration::from_secs(7));
    drop(player);

    // La señal que sonó, a 16 kHz y colocada en el instante en que empezó.
    let mut f24 = Vec::new();
    hive_media::dsp::pcm16_to_f32(&lejana_24k, &mut f24);
    let mut f16 = Vec::new();
    Resampler::new(OUTPUT_RATE, INPUT_RATE).process(&f24, &mut f16);
    let inicio = (desfase * INPUT_RATE as f32) as usize;
    let mic_pcm = crudo.lock().unwrap().clone();
    let largo = mic_pcm.len() / 2;
    let mut far = vec![0.0f32; inicio];
    far.extend(f16);
    far.resize(largo, 0.0);

    escribir_wav(carpeta.join("mic.wav").to_str().unwrap(), &mic_pcm, INPUT_RATE);
    escribir_wav(carpeta.join("far.wav").to_str().unwrap(), &a_pcm(&far), INPUT_RATE);
    std::fs::write(carpeta.join("meta.txt"), format!("{inicio}\n")).unwrap();
    println!("Listo: {} muestras de micrófono, la señal empezó en la muestra {inicio}. Guardado en {}", largo, carpeta.display());
}

fn rms_de(x: &[f32]) -> f32 {
    (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

/// Analiza un volcado: retraso real del altavoz al micrófono y cuánto elimina
/// el cancelador con distintas configuraciones, en las dos fases.
fn analizar_volcado() {
    let carpeta = std::path::PathBuf::from(arg(2).expect("falta la carpeta"));
    let mic = leer_wav(&carpeta.join("mic.wav"));
    let far = leer_wav(&carpeta.join("far.wav"));
    let inicio: usize = std::fs::read_to_string(carpeta.join("meta.txt")).unwrap().trim().parse().unwrap();
    let seg = |a: f32, b: f32| (inicio + (a * 16000.0) as usize)..(inicio + (b * 16000.0) as usize).min(mic.len());
    let db = |a: f32, b: f32| 20.0 * (a.max(1e-9) / b.max(1e-9)).log10();

    let silencio = seg(3.0, 6.8);
    let hablando = seg(8.0, 13.0);
    println!("Micrófono crudo: eco solo {:.4} | hablando {:.4}", rms_de(&mic[silencio.clone()]), rms_de(&mic[hablando.clone()]));

    // Retraso: solo en la fase de silencio, donde lo único que hay es el eco.
    let tramo = seg(0.0, 6.8);
    match hive_media::echo::estimate_delay_ms(&far[tramo.clone()], &mic[tramo], 900) {
        Some((ms, fuerza)) => println!("Retraso altavoz→micrófono: {ms:.0} ms (fuerza del pico {fuerza:.2}; <0.1 = no hay eco reconocible)"),
        None => println!("No se pudo estimar el retraso"),
    }
    let estimado = hive_media::echo::estimate_delay_ms(&far[seg(0.0, 6.8)], &mic[seg(0.0, 6.8)], 900).map(|(ms, _)| ms.round() as i32);

    println!("\n{:<44} {:>10} {:>14}", "configuración", "eco quita", "voz sobre eco");
    let base = hive_media::EchoCanceller::process_recording(&far, &mic, true, None);
    println!("\n--- compuerta de eco residual sobre la salida actual (ruido on, sin pista) ---");
    evaluar_compuerta(&far, &base, silencio.clone(), hablando.clone());
    println!();
    let configs: Vec<(String, bool, Option<i32>)> = vec![
        ("como está hoy (ruido on, sin pista)".into(), true, None),
        ("sin supresor de ruido".into(), false, None),
        (format!("ruido on + pista de retraso {:?} ms", estimado), true, estimado),
        (format!("ruido off + pista de retraso {:?} ms", estimado), false, estimado),
    ];
    for (nombre, ns, pista) in configs {
        let limpio = hive_media::EchoCanceller::process_recording(&far, &mic, ns, pista);
        let eco_crudo = rms_de(&mic[silencio.clone()]);
        let eco_limpio = rms_de(&limpio[silencio.clone()]);
        let voz_limpia = rms_de(&limpio[hablando.clone()]);
        println!("{:<44} {:>7.1} dB {:>11.1} dB", nombre, db(eco_crudo, eco_limpio), db(voz_limpia, eco_limpio));
    }
}

/// Pasa la salida del cancelador por la compuerta, trama a trama, y mide sobre la
/// grabación real: cuánto eco deja pasar con la persona callada y cuánta voz
/// conserva cuando habla encima.
fn evaluar_compuerta(far: &[f32], limpio: &[f32], silencio: std::ops::Range<usize>, hablando: std::ops::Range<usize>) {
    use hive_media::gate::{GateParams, ResidualGate};
    // Rejilla: para cada combinación, cuánto eco se cuela y cuánta voz se conserva.
    if std::env::var("GATE_GRID").is_ok() {
        let n = limpio.len() / 160;
        let s = (silencio.start / 160)..(silencio.end / 160).min(n);
        let h = (hablando.start / 160)..(hablando.end / 160).min(n);
        println!("{:>7} {:>6} {:>6} | {:>12} {:>14}", "inicial", "racha", "subida", "eco que pasa", "voz que pasa");
        for inicial in [0.2f32, 0.25, 0.3] {
            for racha_max in [3u32, 5, 8, 15] {
                for subida in [0.2f32, 0.6] {
                    let mut g = ResidualGate::with_params(GateParams { bajada: 0.0, inicial, racha_max, subida, ..GateParams::default() });
                    let ab: Vec<bool> = (0..n).map(|i| g.process(rms_de(&far[i*160..(i+1)*160]), rms_de(&limpio[i*160..(i+1)*160]))).collect();
                    let eco = s.clone().filter(|&i| ab[i]).count() as f32 / s.len() as f32;
                    let (mut v, mut vp) = (0, 0);
                    for i in h.clone() { if rms_de(&limpio[i*160..(i+1)*160]) > 0.05 { v += 1; if ab[i] { vp += 1; } } }
                    println!("{inicial:>7.2} {racha_max:>6} {subida:>6.1} | {:>10.1} % {:>12.1} %", eco * 100.0, 100.0 * vp as f32 / v.max(1) as f32);
                }
            }
        }
    }
    let mut g = ResidualGate::new();
    if std::env::var("GATE_TRACE").is_ok() {
        let mut t = ResidualGate::new();
        let nn = limpio.len() / 160;
        for i in 0..nn {
            let r = rms_de(&far[i * 160..(i + 1) * 160]);
            let p = rms_de(&limpio[i * 160..(i + 1) * 160]);
            let ab = t.process(r, p);
            let (ge, um, ps, _) = t.estado();
            let seg_s = (i as f32 * 0.01) - (silencio.start as f32 / 16000.0 - 3.0);
            if i % 20 == 0 && (0.0..16.0).contains(&seg_s) {
                println!("t={seg_s:>5.1}s ref={r:.3} post={p:.3} post_suave={ps:.3} g={ge:.3} umbral={um:.3} abierta={ab}");
            }
        }
    }
    let n = limpio.len() / 160;
    let mut abierta = vec![false; n];
    for i in 0..n {
        let r = rms_de(&far[i * 160..(i + 1) * 160]);
        let p = rms_de(&limpio[i * 160..(i + 1) * 160]);
        abierta[i] = g.process(r, p);
    }
    let tramas = |rango: &std::ops::Range<usize>| (rango.start / 160)..(rango.end / 160).min(n);

    let s = tramas(&silencio);
    let pasan_silencio = s.clone().filter(|&i| abierta[i]).count() as f32 / s.len() as f32;

    let h = tramas(&hablando);
    // Energía de voz que sobrevive: lo que pasa frente a lo que había tras el cancelador.
    let (mut pasa, mut total) = (0.0f32, 0.0f32);
    let (mut voz_total, mut voz_pasa) = (0, 0);
    for i in h.clone() {
        let e: f32 = limpio[i * 160..(i + 1) * 160].iter().map(|v| v * v).sum();
        total += e;
        if abierta[i] {
            pasa += e;
        }
        // "Parece voz": claramente por encima del residual de la fase de silencio.
        if rms_de(&limpio[i * 160..(i + 1) * 160]) > 0.05 {
            voz_total += 1;
            if abierta[i] {
                voz_pasa += 1;
            }
        }
    }
    // Distribución de la proporción micrófono/sonido (la que usa la compuerta).
    let (mut rs, mut ps) = (0.0f32, 0.0f32);
    let (mut eco, mut voz): (Vec<f32>, Vec<f32>) = (Vec::new(), Vec::new());
    for i in 0..n {
        let r = rms_de(&far[i * 160..(i + 1) * 160]);
        let p = rms_de(&limpio[i * 160..(i + 1) * 160]);
        rs += (r - rs) * 0.064;
        ps += (p - ps) * 0.30;
        let proporcion = ps / (rs + 1e-4);
        if rs > 0.004 {
            if s.contains(&i) { eco.push(proporcion); }
            if h.contains(&i) { voz.push(proporcion); }
        }
    }
    let pct = |v: &mut Vec<f32>, q: f32| { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[((v.len() - 1) as f32 * q) as usize] };
    for (nombre, v) in [("eco solo (silencio)", &mut eco), ("hablando encima   ", &mut voz)] {
        if v.is_empty() { continue; }
        println!("proporción {nombre}: p5 {:.3} | p25 {:.3} | p50 {:.3} | p75 {:.3} | p90 {:.3} | p99 {:.3}",
            pct(v, 0.05), pct(v, 0.25), pct(v, 0.5), pct(v, 0.75), pct(v, 0.9), pct(v, 0.99));
    }
    println!("fase de silencio : pasa el {:>5.1} % de las tramas (eco que se cuela; lo ideal es ~0)", pasan_silencio * 100.0);
    println!("fase hablando    : conserva el {:>5.1} % de la energía de voz", 100.0 * pasa / total.max(1e-9));
    println!("                   y el {:>5.1} % de las tramas que suenan a voz ({voz_pasa}/{voz_total})", 100.0 * voz_pasa as f32 / voz_total.max(1) as f32);
}

/// Solo eco, durante mucho rato: ¿se acaba filtrando? Mide por tramos.
fn compuerta_larga() {
    use hive_media::gate::{GateParams, ResidualGate};
    let carpeta = std::path::PathBuf::from(arg(2).expect("falta la carpeta"));
    let mic = leer_wav(&carpeta.join("mic.wav"));
    let far = leer_wav(&carpeta.join("far.wav"));
    let limpio = hive_media::EchoCanceller::process_recording(&far, &mic, true, None);
    let n = limpio.len() / 160;
    println!("{:>7} {:>8} {:>6} | {}", "inicial", "racha", "subida", "% de eco que pasa por tramos de ~4 s (sin olvido; ideal: 0 en todos)");
    for inicial in [0.15f32, 0.2, 0.25] {
        for racha_max in [8u32, 15, 30] {
            for subida in [0.3f32, 0.6] {
                let mut g = ResidualGate::with_params(GateParams { bajada: 0.0, inicial, racha_max, subida, ..GateParams::default() });
                let ab: Vec<bool> = (0..n).map(|i| g.process(rms_de(&far[i*160..(i+1)*160]), rms_de(&limpio[i*160..(i+1)*160]))).collect();
                let trozo = 380;
                let cols: Vec<String> = ab.chunks(trozo).filter(|c| c.len() == trozo).map(|c| format!("{:>5.1}", 100.0 * c.iter().filter(|&&x| x).count() as f32 / trozo as f32)).collect();
                println!("{inicial:>7.2} {racha_max:>8} {subida:>6.1} | {}", cols.join("  "));
            }
        }

    }
}
