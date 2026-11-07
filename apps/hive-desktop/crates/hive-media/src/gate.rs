//! Compuerta de eco residual: lo que el cancelador no consigue quitar.
//!
//! Con un televisor, una sala con reverberación y un micrófono aparte, el
//! cancelador lineal deja un eco residual (medido: ~10 dB de atenuación, con un
//! pico de correlación de 0,10 entre lo que suena y lo que se graba). Ese
//! residual tiene forma de voz, y el modelo lo toma por una persona hablando.
//!
//! El residual, sin embargo, es **proporcional a lo que está sonando**: si el
//! televisor sube, sube; si calla, desaparece. La voz de quien habla encima no
//! lo es. Esta compuerta aprende esa proporción del propio audio y solo deja
//! pasar el micrófono cuando supera con claridad el eco esperado.
//!
//! Trabaja en tramas de 10 ms, las mismas del cancelador.

/// Frames de 10 ms que se sigue dando por "sonando" tras el último sonido de la
/// colmena: el eco llega tarde (retraso del sistema, del altavoz, de la sala).
const COLA_FRAMES: u32 = 50;
/// Nivel de referencia por debajo del cual la colmena se da por callada.
const UMBRAL_SONANDO: f32 = 0.004;
/// Se cierra por debajo de esta fracción del umbral de apertura (histéresis).
const FRACCION_CERRAR: f32 = 0.6;
/// Piso absoluto: por debajo de esto no se abre aunque el eco esperado sea ~0.
const PISO_ABSOLUTO: f32 = 0.012;
/// Tras abrir se mantiene abierta este tiempo: no se corta una palabra a medias.
const RETENCION_FRAMES: u32 = 25;

/// Parámetros de la compuerta. Se separan para poder calibrarlos contra
/// grabaciones reales (`probe aecanalyze`) en vez de a ojo.
#[derive(Debug, Clone, Copy)]
pub struct GateParams {
    /// Veces la cola alta del eco que hay que superar para abrir.
    pub margen: f32,
    /// Rapidez con que el estimador sube hacia las ráfagas de eco.
    pub subida: f32,
    /// Rapidez con que olvida ráfagas viejas.
    pub bajada: f32,
    /// Valor inicial de la proporción esperada: alto = cerrada hasta aprender.
    pub inicial: f32,
    /// Tramas seguidas por encima de lo esperado hasta las que se sigue
    /// aprendiendo. Una ráfaga de eco dura pocas; una voz, cientos de
    /// milisegundos. Pasado este número se da por voz y se deja de aprender:
    /// sin esto, al hablar encima el estimador sube junto con la voz, el umbral
    /// no la alcanza nunca y la compuerta queda cerrada toda la frase.
    pub racha_max: u32,
}

impl Default for GateParams {
    fn default() -> Self {
        // Calibrado sobre una grabación real (televisor por HDMI, micrófono USB,
        // sala con reverberación), midiendo cuánto eco se cuela y cuánta voz pasa:
        // - sin olvido (`bajada` 0): con olvido, la fuga crecía con el tiempo
        //   (14 % → 52 % en 19 s de eco) porque el estimador se asentaba en la
        //   mediana del eco y no en sus ráfagas;
        // - inicial 0,2: por debajo, ráfagas normales parecen voz y no se aprenden;
        // - racha 8: con 15, los primeros 150 ms de cada sílaba entran en el
        //   estimador, el umbral sube sílaba tras sílaba y la voz que pasa cae
        //   del 99 % al 78 %.
        // Ver `probe aecanalyze` y `probe gatelong`.
        Self { margen: 1.6, subida: 0.3, bajada: 0.0, inicial: 0.2, racha_max: 8 }
    }
}

pub struct ResidualGate {
    p: GateParams,
    /// Nivel suavizado de lo que suena (referencia).
    ref_suave: f32,
    /// Nivel suavizado de lo que graba el micrófono, ya sin eco.
    post_suave: f32,
    /// Proporción residual/referencia que se espera: la del eco, sin voz.
    ganancia_eco: f32,
    cola: u32,
    abierta: bool,
    retencion: u32,
    /// Hasta la primera trama las medias no significan nada.
    arrancada: bool,
    /// Tramas seguidas con la proporción por encima de la esperada.
    racha: u32,
    /// El máximo de esa racha: lo que se aprende si resulta ser una ráfaga corta.
    pico_racha: f32,
}

impl ResidualGate {
    pub fn new() -> Self {
        Self::with_params(GateParams::default())
    }

    pub fn with_params(p: GateParams) -> Self {
        Self {
            p,
            ref_suave: 0.0,
            post_suave: 0.0,
            // Empieza alta: cerrada hasta aprender cuánto eco deja el sistema.
            ganancia_eco: p.inicial,
            cola: 0,
            abierta: true,
            retencion: 0,
            arrancada: false,
            racha: 0,
            pico_racha: 0.0,
        }
    }

    /// `ref_rms`: nivel RMS de la trama de lo que suena. `post_rms`: el de la
    /// trama del micrófono tras el cancelador. Devuelve si la trama pasa.
    pub fn process(&mut self, ref_rms: f32, post_rms: f32) -> bool {
        if !self.arrancada {
            // Sin esto la media de la referencia parte de cero, el eco esperado
            // sale ~0 y los primeros instantes dejan pasar el eco.
            self.ref_suave = ref_rms;
            self.post_suave = post_rms;
            self.arrancada = true;
        }
        // La referencia se suaviza lento (el eco es una versión retrasada y
        // alisada de ella); el micrófono rápido, para no comerse el arranque de
        // una palabra.
        self.ref_suave += (ref_rms - self.ref_suave) * 0.064;
        self.post_suave += (post_rms - self.post_suave) * 0.30;

        if ref_rms > UMBRAL_SONANDO {
            self.cola = COLA_FRAMES;
        } else if self.cola > 0 {
            self.cola -= 1;
        }
        if self.cola == 0 {
            // La colmena calla: no hay eco que descartar.
            self.abierta = true;
            self.retencion = 0;
            return true;
        }

        let proporcion = self.post_suave / (self.ref_suave + 1e-4);

        // Se decide con lo aprendido hasta ahora y solo después se aprende: si no,
        // el estimador alcanzaría a la voz en el mismo instante en que sube y
        // jamás se la vería por encima de él.
        let abrir = (self.p.margen * self.ganancia_eco * self.ref_suave).max(PISO_ABSOLUTO);
        if self.post_suave > abrir {
            self.abierta = true;
            self.retencion = RETENCION_FRAMES;
        } else if self.abierta {
            if self.post_suave < FRACCION_CERRAR * abrir {
                if self.retencion > 0 {
                    self.retencion -= 1;
                }
                if self.retencion == 0 {
                    self.abierta = false;
                }
            } else {
                self.retencion = RETENCION_FRAMES;
            }
        }

        // Aprendizaje: la referencia es la **cola alta** del eco, no su mínimo.
        //
        // El residual es casi nulo la mayor parte del tiempo (medido: mediana
        // 0,004) pero con ráfagas de hasta 0,2, y un umbral construido sobre el
        // mínimo queda por debajo de las ráfagas y las deja pasar todas.
        //
        // Una ráfaga se aprende **al terminar** y solo si fue corta. Eso
        // distingue el eco de la voz sin depender del estado de la compuerta: la
        // voz dura cientos de milisegundos y nunca entra en el estimador, así que
        // no hay forma de que lo infle y cierre la compuerta en mitad de una
        // frase. Y aprender también con la compuerta abierta evita el bucle sin
        // salida de antes: con el estimador bajo, las ráfagas la abren, y abierta
        // no aprendía, así que no subía nunca.
        if proporcion > self.ganancia_eco {
            self.racha += 1;
            self.pico_racha = self.pico_racha.max(proporcion);
        } else {
            if self.racha > 0 && self.racha <= self.p.racha_max {
                self.ganancia_eco += (self.pico_racha - self.ganancia_eco) * self.p.subida;
            }
            self.racha = 0;
            self.pico_racha = 0.0;
            self.ganancia_eco += (proporcion - self.ganancia_eco) * self.p.bajada;
        }
        self.abierta
    }
}

impl ResidualGate {
    /// Estado interno para diagnóstico: (proporción de eco esperada, umbral de
    /// apertura, nivel del micrófono suavizado, abierta).
    pub fn estado(&self) -> (f32, f32, f32, bool) {
        let umbral = (self.p.margen * self.ganancia_eco * self.ref_suave).max(PISO_ABSOLUTO);
        (self.ganancia_eco, umbral, self.post_suave, self.abierta)
    }
}

impl Default for ResidualGate {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simula `tramas` con la colmena sonando a `sonido`, un eco residual que es
    /// `proporcion` de eso y, desde `voz_desde`, una voz de nivel `voz`.
    /// Devuelve la fracción de tramas que pasan en el intervalo [desde, hasta).
    fn simular(
        g: &mut ResidualGate,
        tramas: usize,
        sonido: f32,
        proporcion: f32,
        voz: f32,
        voz_desde: usize,
        medir: std::ops::Range<usize>,
    ) -> f32 {
        let mut pasan = 0;
        for i in 0..tramas {
            // Eco de cola pesada, como el medido en la sala real: casi nulo la mayor
            // parte del tiempo, con ráfagas del doble de la proporción nominal.
            let ruido = if i % 17 == 0 { 2.0 } else { 0.1 + 0.9 * (i as f32 * 1.7).sin().powi(2) };
            let eco = sonido * proporcion * ruido;
            let post = if i >= voz_desde { (eco * eco + voz * voz).sqrt() } else { eco };
            let abierta = g.process(sonido * (1.0 + 0.2 * (i as f32 * 0.9).sin()), post);
            if medir.contains(&i) && abierta {
                pasan += 1;
            }
        }
        pasan as f32 / medir.len().max(1) as f32
    }

    #[test]
    fn el_eco_residual_no_pasa() {
        let mut g = ResidualGate::new();
        // Colmena sonando fuerte y un residual del 10 % de lo que suena.
        let pasa = simular(&mut g, 400, 0.3, 0.10, 0.0, usize::MAX, 150..400);
        assert!(pasa < 0.05, "pasó el {:.0} % del eco", pasa * 100.0);
    }

    #[test]
    fn la_voz_encima_atraviesa() {
        let mut g = ResidualGate::new();
        // Misma sala; a las 250 tramas entra una voz bastante por encima del residual.
        let pasa = simular(&mut g, 600, 0.3, 0.10, 0.20, 250, 280..600);
        assert!(pasa > 0.9, "solo pasó el {:.0} % de la voz", pasa * 100.0);
    }

    #[test]
    fn una_frase_larga_no_cierra_la_compuerta_a_mitad() {
        let mut g = ResidualGate::new();
        // 12 s hablando encima: el aprendizaje no debe confundirla con eco.
        let pasa = simular(&mut g, 1500, 0.3, 0.10, 0.20, 200, 1000..1500);
        assert!(pasa > 0.9, "se cerró durante la frase: pasó el {:.0} %", pasa * 100.0);
    }

    #[test]
    fn empezar_a_hablar_encima_no_infla_lo_que_se_cree_que_es_eco() {
        let mut g = ResidualGate::new();
        simular(&mut g, 300, 0.3, 0.10, 0.0, usize::MAX, 0..1);
        let antes = g.ganancia_eco;
        // Voz con la compuerta recién cerrada: el estimador no debe seguirla.
        simular(&mut g, 100, 0.3, 0.10, 0.20, 0, 0..1);
        assert!(g.ganancia_eco < antes * 2.0, "el estimador pasó de {antes:.3} a {:.3}", g.ganancia_eco);
    }

    #[test]
    fn a_los_pocos_segundos_ya_se_puede_interrumpir() {
        // Con el arranque conservador, la voz tiene que poder pasar enseguida.
        let mut g = ResidualGate::new();
        let pasa = simular(&mut g, 700, 0.3, 0.10, 0.20, 300, 320..700);
        assert!(pasa > 0.9, "solo pasó el {:.0} %", pasa * 100.0);
    }

    #[test]
    fn el_estimador_no_se_olvida_del_eco_con_el_tiempo() {
        // Un monólogo largo de la colmena, solo eco: no debe acabar filtrándose
        // porque el estimador "olvide" las ráfagas y se asiente en la mediana.
        let mut g = ResidualGate::new();
        let pasa = simular(&mut g, 6000, 0.3, 0.10, 0.0, usize::MAX, 4000..6000);
        assert!(pasa < 0.05, "tras 60 s se coló el {:.0} % del eco", pasa * 100.0);
    }

    #[test]
    fn si_la_colmena_calla_pasa_todo() {
        let mut g = ResidualGate::new();
        simular(&mut g, 200, 0.3, 0.10, 0.0, usize::MAX, 0..1);
        // Callada de verdad, y con micrófono bajo: debe dejarlo pasar.
        let mut pasan = 0;
        for _ in 0..300 {
            if g.process(0.0, 0.02) {
                pasan += 1;
            }
        }
        // Tras la cola de 500 ms, todo pasa.
        assert!(pasan >= 250, "pasaron {pasan} de 300");
    }

    #[test]
    fn se_adapta_a_que_suba_el_volumen_del_televisor() {
        let mut g = ResidualGate::new();
        simular(&mut g, 300, 0.1, 0.10, 0.0, usize::MAX, 0..1);
        // El televisor sube x4: el eco sube con él y sigue sin pasar.
        let pasa = simular(&mut g, 400, 0.4, 0.10, 0.0, usize::MAX, 150..400);
        assert!(pasa < 0.1, "con más volumen se coló el {:.0} %", pasa * 100.0);
    }

    #[test]
    fn empieza_cerrada_mientras_aprende() {
        let mut g = ResidualGate::new();
        // Los primeros instantes con la colmena sonando no dejan pasar nada.
        let mut pasan = 0;
        for i in 0..10 {
            if g.process(0.3, 0.03 * (1.0 + 0.3 * (i as f32).sin())) {
                pasan += 1;
            }
        }
        assert!(pasan <= 2, "pasaron {pasan} de 10 al arrancar");
    }

    #[test]
    fn una_voz_muy_baja_no_se_confunde_con_eco_pero_tampoco_se_inventa() {
        let mut g = ResidualGate::new();
        // Voz por debajo del piso absoluto: no pasa (no hay forma de distinguirla).
        let pasa = simular(&mut g, 600, 0.3, 0.10, 0.008, 250, 280..600);
        assert!(pasa < 0.2, "pasó el {:.0} % de una voz inaudible", pasa * 100.0);
    }
}

