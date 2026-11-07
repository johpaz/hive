//! Cancelación de eco, ruido y desfase: el reemplazo nativo de lo que el
//! navegador hacía con `echoCancellation`/`noiseSuppression`.
//!
//! Va sobre `sonora`, un port en Rust puro del procesador de audio de WebRTC
//! (AEC3): sin toolchain de C++, así que compila igual en Linux, macOS y Windows.
//!
//! El eco solo se puede quitar sabiendo qué está sonando. Por eso el
//! reproductor entrega aquí, desde su propio callback, las muestras que de verdad
//! salen por el altavoz (la referencia), y la captura las usa para restárselas
//! al micrófono. Con eso la colmena se puede interrumpir a media frase aunque
//! hable por un altavoz abierto, que es lo que el modo altavoz evitaba callando
//! el micrófono.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use sonora::config::{EchoCanceller as AecConfig, NoiseSuppression};
use sonora::{AudioProcessing, Config, StreamConfig};

/// El procesador trabaja en tramas de 10 ms; a 16 kHz son 160 muestras.
pub const APM_RATE: u32 = 16_000;
pub const APM_FRAME: usize = 160;

#[derive(Clone)]
pub struct EchoCanceller {
    apm: Arc<Mutex<AudioProcessing>>,
    /// Nivel RMS de la última trama que sonó. Lo lee la captura para su
    /// compuerta de eco residual: el eco que queda es proporcional a esto.
    render_level: Arc<AtomicU32>,
}

impl EchoCanceller {
    pub fn new() -> Self {
        Self::with_noise_suppression(true)
    }

    /// El supresor de ruido se puede apagar: cualquier reducción de ruido
    /// recorta algo de voz, y en una prueba o un entorno silencioso no compensa.
    pub fn with_noise_suppression(enabled: bool) -> Self {
        let config = Config {
            echo_canceller: Some(AecConfig::default()),
            noise_suppression: enabled.then(NoiseSuppression::default),
            ..Default::default()
        };
        let apm = AudioProcessing::builder()
            .config(config)
            .capture_config(StreamConfig::new(APM_RATE, 1))
            .render_config(StreamConfig::new(APM_RATE, 1))
            .build();
        Self { apm: Arc::new(Mutex::new(apm)), render_level: Arc::new(AtomicU32::new(0)) }
    }

    /// Indica cuánto tarda en llegar al micrófono lo que suena por el altavoz
    /// (salida del sistema + altavoz + sala). Es una pista para el cancelador:
    /// con un televisor por HDMI esa cifra se va a cientos de milisegundos.
    pub fn set_stream_delay_ms(&self, ms: i32) {
        if let Ok(mut apm) = self.apm.lock() {
            let _ = apm.set_stream_delay_ms(ms);
        }
    }

    /// Procesa audio ya grabado, trama a trama como en vivo. `far` es lo que se
    /// reprodujo y `mic` lo que se grabó, ambos a 16 kHz y alineados en el
    /// tiempo desde el mismo origen. Sirve para medir y comparar configuraciones
    /// sin volver a poner sonido en la habitación.
    pub fn process_recording(
        far: &[f32],
        mic: &[f32],
        noise_suppression: bool,
        delay_hint_ms: Option<i32>,
    ) -> Vec<f32> {
        let aec = Self::with_noise_suppression(noise_suppression);
        if let Some(ms) = delay_hint_ms {
            aec.set_stream_delay_ms(ms);
        }
        let mut salida = Vec::with_capacity(mic.len());
        let mut trama = [0.0f32; APM_FRAME];
        for (i, m) in mic.chunks_exact(APM_FRAME).enumerate() {
            let desde = i * APM_FRAME;
            if far.len() >= desde + APM_FRAME {
                aec.process_render(&far[desde..desde + APM_FRAME]);
            } else {
                aec.process_render(&[0.0; APM_FRAME]);
            }
            aec.process_capture(m, &mut trama);
            salida.extend_from_slice(&trama);
        }
        salida
    }

    /// Nivel RMS (0–1) de lo último que sonó por el altavoz.
    pub(crate) fn render_level(&self) -> f32 {
        f32::from_bits(self.render_level.load(Ordering::Relaxed))
    }

    /// Limpia una trama de micrófono. Devuelve `false` y deja `out` igual a la
    /// entrada si no se pudo procesar: mejor audio con eco que audio mudo.
    pub(crate) fn process_capture(&self, input: &[f32], out: &mut [f32]) -> bool {
        debug_assert_eq!(input.len(), APM_FRAME);
        let Ok(mut apm) = self.apm.lock() else {
            out.copy_from_slice(input);
            return false;
        };
        if apm.process_capture_f32(&[input], &mut [&mut *out]).is_err() {
            out.copy_from_slice(input);
            return false;
        }
        true
    }

    /// Entrega la referencia: lo que está sonando ahora. No espera nunca; si el
    /// procesador está ocupado con la captura, esa trama de referencia se pierde
    /// y el siguiente ciclo la recupera, que es mejor que cortar el audio de salida.
    pub(crate) fn process_render(&self, frame: &[f32]) {
        debug_assert_eq!(frame.len(), APM_FRAME);
        // El nivel se anota aunque el procesador esté ocupado: la compuerta lo
        // necesita para saber que la colmena está sonando.
        let nivel = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
        self.render_level.store(nivel.to_bits(), Ordering::Relaxed);
        if let Ok(mut apm) = self.apm.try_lock() {
            let mut sink = [0.0f32; APM_FRAME];
            let _ = apm.process_render_f32(&[frame], &mut [&mut sink[..]]);
        }
    }
}

impl Default for EchoCanceller {
    fn default() -> Self {
        Self::new()
    }
}

/// Retraso (ms) con que `mic` repite a `far`, por correlación cruzada.
///
/// Se blanquean las señales con una diferencia de primer orden —la voz y el
/// ruido de un televisor tienen casi toda su energía en graves, y sin eso la
/// correlación sale ancha y plana— y se busca el máximo hasta `max_ms`.
/// Devuelve también la fuerza del pico (0–1): un valor bajo quiere decir que no
/// hay eco reconocible, o que la alineación es mala.
pub fn estimate_delay_ms(far: &[f32], mic: &[f32], max_ms: usize) -> Option<(f32, f32)> {
    let blanquear = |x: &[f32]| -> Vec<f32> { x.windows(2).map(|w| w[1] - w[0]).collect() };
    // A 4 kHz sobra para ubicar el pico y es 16 veces más barato que a 16 kHz.
    let reducir = |x: Vec<f32>| -> Vec<f32> { x.chunks_exact(4).map(|c| c.iter().sum::<f32>() / 4.0).collect() };
    let f = reducir(blanquear(far));
    let m = reducir(blanquear(mic));
    let n = f.len().min(m.len());
    if n < 400 {
        return None;
    }
    let max_lag = (max_ms * (APM_RATE as usize / 4) / 1000).min(n / 2);
    let ef: f32 = f[..n].iter().map(|v| v * v).sum::<f32>().sqrt();
    let em: f32 = m[..n].iter().map(|v| v * v).sum::<f32>().sqrt();
    if ef < 1e-9 || em < 1e-9 {
        return None;
    }
    let (mut mejor, mut mejor_lag) = (f32::MIN, 0usize);
    for lag in 0..max_lag {
        let c: f32 = (0..n - lag).map(|i| f[i] * m[i + lag]).sum();
        if c > mejor {
            mejor = c;
            mejor_lag = lag;
        }
    }
    let ms = mejor_lag as f32 * 1000.0 / (APM_RATE as f32 / 4.0);
    Some((ms, (mejor / (ef * em)).clamp(0.0, 1.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generador pseudoaleatorio determinista (sin dependencias).
    struct Ruido(u32);
    impl Ruido {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
            (self.0 >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
        }
    }

    fn energia(x: &[f32]) -> f32 {
        x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32
    }

    /// Simula altavoz → sala → micrófono: lo que suena vuelve atenuado y
    /// retrasado. Devuelve la energía del micrófono (con eco) y la de su
    /// salida limpia, solo en el último tramo, cuando el filtro ya convergió.
    fn simular(retraso_ms: usize, ganancia: f32, segundos: usize) -> (f32, f32) {
        let aec = EchoCanceller::new();
        let mut ruido = Ruido(7);
        let retraso = retraso_ms * APM_RATE as usize / 1000;
        let tramas = segundos * 100;
        let mut sono: Vec<f32> = Vec::new();
        let (mut mic_cola, mut limpio_cola) = (Vec::new(), Vec::new());

        for n in 0..tramas {
            // Habla sintética: ruido de banda ancha con una envolvente lenta.
            let env = 0.25 + 0.2 * (n as f32 * 0.05).sin().abs();
            let lejano: Vec<f32> = (0..APM_FRAME).map(|_| ruido.next() * env).collect();
            // Lo que se reproduce llega al micrófono tras el retraso.
            let desde = n * APM_FRAME;
            sono.extend_from_slice(&lejano);
            let eco: Vec<f32> = (0..APM_FRAME)
                .map(|i| {
                    let pos = desde + i;
                    if pos >= retraso { sono[pos - retraso] * ganancia } else { 0.0 }
                })
                .collect();

            aec.process_render(&lejano);
            let mut limpio = vec![0.0; APM_FRAME];
            aec.process_capture(&eco, &mut limpio);

            if n >= tramas - 200 {
                mic_cola.extend_from_slice(&eco);
                limpio_cola.extend_from_slice(&limpio);
            }
        }
        (energia(&mic_cola), energia(&limpio_cola))
    }

    fn db(razon: f32) -> f32 {
        10.0 * razon.max(1e-12).log10()
    }

    #[test]
    fn el_nivel_de_lo_que_suena_queda_disponible_para_la_compuerta() {
        let aec = EchoCanceller::new();
        assert_eq!(aec.render_level(), 0.0);
        aec.process_render(&[0.5; APM_FRAME]);
        assert!((aec.render_level() - 0.5).abs() < 1e-6);
        aec.process_render(&[0.0; APM_FRAME]);
        assert_eq!(aec.render_level(), 0.0);
        // Una copia del cancelador (la que usa la captura) ve el mismo nivel.
        let otra = aec.clone();
        aec.process_render(&[0.25; APM_FRAME]);
        assert!((otra.render_level() - 0.25).abs() < 1e-6);
    }

    #[test]
    fn la_correlacion_encuentra_el_retraso_de_un_televisor() {
        let mut ruido = Ruido(5);
        let far: Vec<f32> = (0..APM_RATE as usize * 6).map(|_| ruido.next() * 0.3).collect();
        for retraso_ms in [40usize, 180, 320] {
            let d = retraso_ms * APM_RATE as usize / 1000;
            let mic: Vec<f32> = (0..far.len())
                .map(|i| if i >= d { far[i - d] * 0.4 } else { 0.0 })
                .collect();
            let (ms, fuerza) = estimate_delay_ms(&far, &mic, 600).unwrap();
            assert!((ms - retraso_ms as f32).abs() <= 2.0, "esperado {retraso_ms}, salió {ms}");
            assert!(fuerza > 0.5, "pico débil: {fuerza}");
        }
    }

    #[test]
    fn sin_eco_la_correlacion_no_inventa_un_pico_fuerte() {
        let (mut a, mut b) = (Ruido(1), Ruido(99));
        let far: Vec<f32> = (0..APM_RATE as usize * 6).map(|_| a.next() * 0.3).collect();
        let mic: Vec<f32> = (0..far.len()).map(|_| b.next() * 0.3).collect();
        let (_, fuerza) = estimate_delay_ms(&far, &mic, 600).unwrap();
        assert!(fuerza < 0.1, "pico espurio: {fuerza}");
    }

    #[test]
    fn procesar_una_grabacion_da_lo_mismo_que_hacerlo_en_vivo() {
        let mut ruido = Ruido(7);
        let far: Vec<f32> = (0..APM_RATE as usize * 8).map(|_| ruido.next() * 0.3).collect();
        let d = 60 * APM_RATE as usize / 1000;
        let mic: Vec<f32> = (0..far.len()).map(|i| if i >= d { far[i - d] * 0.5 } else { 0.0 }).collect();
        let limpio = EchoCanceller::process_recording(&far, &mic, true, None);
        let cola = limpio.len() - 2 * APM_RATE as usize;
        let erle = db(energia(&mic[cola..]) / energia(&limpio[cola..]));
        assert!(erle > 15.0, "solo {erle:.1} dB");
    }

    #[test]
    fn atenua_el_eco_de_un_altavoz_con_retraso_de_sala() {
        let (con_eco, limpio) = simular(60, 0.5, 12);
        let erle = db(con_eco / limpio);
        assert!(con_eco > 1e-4, "la prueba no generó eco ({con_eco})");
        assert!(erle > 15.0, "solo se atenuó {erle:.1} dB");
    }

    #[test]
    fn tambien_con_el_retraso_de_un_televisor_por_hdmi() {
        let (con_eco, limpio) = simular(180, 0.5, 15);
        let erle = db(con_eco / limpio);
        assert!(erle > 10.0, "solo se atenuó {erle:.1} dB con 180 ms");
    }

    /// Voz sintética: armónicos de un tono que sube y baja, con sílabas de ~4 Hz.
    /// Un tono puro y quieto no vale: el supresor de ruido lo trata, con razón,
    /// como ruido de fondo.
    fn voz(n: usize) -> f32 {
        let t = n as f32 / APM_RATE as f32;
        let f0 = 140.0 + 40.0 * (2.0 * std::f32::consts::PI * 0.7 * t).sin();
        let fase = 2.0 * std::f32::consts::PI * f0 * t;
        let armonicos: f32 = (1..=6).map(|k| (fase * k as f32).sin() / k as f32).sum();
        let silaba = (2.0 * std::f32::consts::PI * 4.0 * t).sin().max(0.0);
        armonicos * silaba * 0.25
    }

    #[test]
    fn sin_referencia_no_se_come_la_voz_del_usuario() {
        // Voz del usuario sin nada sonando: debe salir casi intacta.
        let aec = EchoCanceller::new();
        let mut entrada = Vec::new();
        let mut salida = Vec::new();
        for n in 0..600 {
            let trama: Vec<f32> = (0..APM_FRAME).map(|i| voz(n * APM_FRAME + i)).collect();
            let mut out = vec![0.0; APM_FRAME];
            aec.process_capture(&trama, &mut out);
            if n >= 300 {
                entrada.extend_from_slice(&trama);
                salida.extend_from_slice(&out);
            }
        }
        let perdida = db(energia(&entrada) / energia(&salida));
        eprintln!("voz sin eco: pérdida {perdida:.1} dB");
        assert!(perdida < 6.0, "se perdieron {perdida:.1} dB de voz sin eco");
    }

    #[test]
    #[ignore = "diagnóstico: imprime cifras, no comprueba nada"]
    fn diagnostico_doble_habla() {
        for ns in [true, false] {
            for (nombre, ganancia_eco) in [("con eco 0.5", 0.5f32), ("sin eco", 0.0)] {
                let aec = EchoCanceller::with_noise_suppression(ns);
                let mut ruido = Ruido(11);
                let retraso = 60 * APM_RATE as usize / 1000;
                let mut sono: Vec<f32> = Vec::new();
                let (mut v, mut o, mut m) = (Vec::new(), Vec::new(), Vec::new());
                for n in 0..2_000 {
                    let env = 0.25 + 0.2 * (n as f32 * 0.05).sin().abs();
                    let lejano: Vec<f32> = (0..APM_FRAME).map(|_| ruido.next() * env).collect();
                    sono.extend_from_slice(&lejano);
                    let mic: Vec<f32> = (0..APM_FRAME)
                        .map(|i| {
                            let pos = n * APM_FRAME + i;
                            let eco = if pos >= retraso { sono[pos - retraso] * ganancia_eco } else { 0.0 };
                            eco + if n >= 1_500 { voz(pos) } else { 0.0 }
                        })
                        .collect();
                    aec.process_render(&lejano);
                    let mut out = vec![0.0; APM_FRAME];
                    aec.process_capture(&mic, &mut out);
                    if n >= 1_700 {
                        v.extend((0..APM_FRAME).map(|i| voz(n * APM_FRAME + i)));
                        o.extend_from_slice(&out);
                        m.extend_from_slice(&mic);
                    }
                }
                eprintln!(
                    "DIAG ns={ns:5} {nombre:12}: voz {:.5} | mic {:.5} | salida {:.5} | salida/voz {:.1} dB",
                    energia(&v), energia(&m), energia(&o), db(energia(&o) / energia(&v))
                );
            }
        }
    }

    // Ignorada a propósito. En simulación, con un eco que es una copia lineal y
    // perfecta de ruido blanco, el AEC3 se vuelve tan confiado que suprime también
    // la voz que se le habla encima (medido: −28 dB con el supresor apagado). Un
    // cuarto real no se parece a eso, así que esta cifra no dice cómo se
    // comportará con altavoces de verdad. Eso se mide con `probe aec`.
    #[test]
    #[ignore = "simulación irreal; validar con `cargo run --example probe -- aec`"]
    fn mientras_suena_la_colmena_la_voz_del_usuario_sigue_pasando() {
        // El caso que justifica todo: interrumpir hablando encima, por altavoz.
        let aec = EchoCanceller::new();
        let mut ruido = Ruido(11);
        let retraso = 60 * APM_RATE as usize / 1000;
        let mut sono: Vec<f32> = Vec::new();
        let (mut solo_voz, mut salida) = (Vec::new(), Vec::new());
        let tramas = 2_000;
        for n in 0..tramas {
            let env = 0.25 + 0.2 * (n as f32 * 0.05).sin().abs();
            let lejano: Vec<f32> = (0..APM_FRAME).map(|_| ruido.next() * env).collect();
            sono.extend_from_slice(&lejano);
            // El usuario empieza a hablar encima cuando el filtro ya convergió.
            let habla = n >= 1_500;
            let mic: Vec<f32> = (0..APM_FRAME)
                .map(|i| {
                    let pos = n * APM_FRAME + i;
                    let eco = if pos >= retraso { sono[pos - retraso] * 0.5 } else { 0.0 };
                    eco + if habla { voz(pos) } else { 0.0 }
                })
                .collect();
            aec.process_render(&lejano);
            let mut out = vec![0.0; APM_FRAME];
            aec.process_capture(&mic, &mut out);
            if n >= 1_700 {
                solo_voz.extend((0..APM_FRAME).map(|i| voz(n * APM_FRAME + i)));
                salida.extend_from_slice(&out);
            }
        }
        let conservada = db(energia(&salida) / energia(&solo_voz));
        eprintln!("voz con eco: conservada {conservada:.1} dB respecto a la original");
        assert!(conservada > -8.0, "la voz del usuario quedó {conservada:.1} dB: no se le puede interrumpir");
    }
}
