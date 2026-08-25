import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Model, Provider } from "@/types";
import { getModelPrice, isFree } from "@/lib/model-pricing";

/**
 * Manuales de la pantalla de providers.
 *
 * El contenido explicativo es texto redactado, pero todo dato concreto —qué
 * providers son gratuitos, cuáles están configurados— se deriva de la BD, no de
 * una lista escrita a mano que se desactualiza como pasó con el catálogo NVIDIA.
 */

interface ProviderGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Provider[];
  models: Model[];
  /** Manual a mostrar al abrir. */
  initialGuide?: GuideId;
}

type GuideId = "configurar" | "gratuitos" | "agregar" | "ollama" | "modelscope" | "costos";

const GUIDES: { id: GuideId; title: string; blurb: string }[] = [
  { id: "configurar", title: "Configurar un provider", blurb: "API key, endpoint y activación" },
  { id: "gratuitos", title: "Providers gratuitos", blurb: "Cuáles no cobran por token" },
  { id: "agregar", title: "Agregar un modelo", blurb: "Descubrir vs. cargar a mano" },
  { id: "ollama", title: "Modelos de Ollama", blurb: "Cómo se nombran los modelos locales" },
  { id: "modelscope", title: "ModelScope y Qwen", blurb: "El dominio correcto y los créditos" },
  { id: "costos", title: "Cómo se calcula el costo", blurb: "Precios, «sin tarifa» y el dashboard" },
];

const P = "text-[12px] leading-relaxed text-white/55";
const H = "text-[11px] font-black uppercase tracking-widest text-white/70 mt-4 mb-1.5 first:mt-0";
const CODE = "font-mono text-[11px] bg-white/5 border border-white/10 rounded px-1 py-0.5 text-white/70";

export function ProviderGuideDialog({ open, onOpenChange, providers, models, initialGuide }: ProviderGuideDialogProps) {
  const [guide, setGuide] = useState<GuideId>(initialGuide ?? "configurar");

  /** Providers cuyos modelos de catálogo están todos a precio 0 — salido de la BD. */
  const freeProviders = useMemo(() => {
    const byProvider = new Map<string, Model[]>();
    for (const m of models) {
      const pid = m.providerId || m.provider_id;
      if (!pid) continue;
      if (!byProvider.has(pid)) byProvider.set(pid, []);
      byProvider.get(pid)!.push(m);
    }
    return [...byProvider.entries()]
      .filter(([, list]) => {
        const prices = list.map(getModelPrice).filter((p): p is NonNullable<typeof p> => p !== null);
        return prices.length > 0 && prices.every(isFree);
      })
      .map(([pid]) => providers.find((p) => p.id === pid)?.name || pid)
      .sort();
  }, [models, providers]);

  const configuredCount = providers.filter((p) => p.has_api_key).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl border border-white/10 p-0 overflow-hidden w-[calc(100vw-2rem)] max-w-3xl bg-[#09090b]">
        <div className="p-5 border-b border-white/5 bg-white/5 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-32 w-32 bg-blue-600/10 rounded-full blur-[80px] pointer-events-none" />
          <DialogTitle className="text-lg font-black text-white uppercase tracking-tighter">Guía de providers</DialogTitle>
          <DialogDescription className="text-xs text-white/40 font-medium mt-0.5">
            {providers.length} providers · {configuredCount} con API key · {models.length} modelos
          </DialogDescription>
        </div>

        <div className="flex flex-col sm:flex-row max-h-[65vh]">
          {/* Índice */}
          <nav className="sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-white/5 p-2 flex sm:flex-col gap-1 overflow-x-auto">
            {GUIDES.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGuide(g.id)}
                className={`text-left rounded-md px-2.5 py-2 transition-colors shrink-0 ${
                  guide === g.id ? 'bg-blue-500/10 border border-blue-500/25' : 'border border-transparent hover:bg-white/5'
                }`}
              >
                <span className={`block text-[11px] font-bold ${guide === g.id ? 'text-blue-300' : 'text-white/70'}`}>
                  {g.title}
                </span>
                <span className="block text-[10px] text-white/30 mt-0.5 whitespace-nowrap sm:whitespace-normal">{g.blurb}</span>
              </button>
            ))}
          </nav>

          {/* Contenido */}
          <div className="flex-1 p-5 overflow-y-auto hive-scroll">
            {guide === "configurar" && (
              <div>
                <h4 className={H}>1. Activá el provider</h4>
                <p className={P}>
                  El switch de la tarjeta activa el provider y, en cascada, sus modelos. Un provider apagado no se
                  ofrece a los agentes aunque tenga la key cargada.
                </p>
                <h4 className={H}>2. Cargá la API key</h4>
                <p className={P}>
                  Botón <span className={CODE}>CONFIG</span>. La key se guarda cifrada, separada del resto de la
                  configuración, y nunca se devuelve entera: la tarjeta sólo muestra una versión enmascarada.
                </p>
                <h4 className={H}>3. Endpoint</h4>
                <p className={P}>
                  Cada provider trae su <span className={CODE}>base_url</span> por defecto. Cámbialo solo si usas un
                  proxy propio o un gateway corporativo. El verificador de key y el descubrimiento de modelos usan
                  ese mismo endpoint, así que apuntar a un proxy funciona de punta a punta.
                </p>
                <h4 className={H}>Providers locales</h4>
                <p className={P}>
                  Ollama y otros en <span className={CODE}>localhost</span> no necesitan API key. En esos aparece
                  además el campo <span className={CODE}>num_ctx</span>, que fija el contexto que el servidor local
                  reserva por request.
                </p>
              </div>
            )}

            {guide === "gratuitos" && (
              <div>
                <h4 className={H}>Sin costo por token</h4>
                {freeProviders.length > 0 ? (
                  <>
                    <p className={P}>
                      Según el catálogo cargado, estos providers tienen todos sus modelos a precio cero:
                    </p>
                    <ul className="mt-2 space-y-1">
                      {freeProviders.map((name) => (
                        <li key={name} className="flex items-center gap-2 text-[12px] text-emerald-400/80">
                          <span className="h-1 w-1 rounded-full bg-emerald-400/60" />{name}
                        </li>
                      ))}
                    </ul>
                    <p className={`${P} mt-3`}>
                      Esta lista sale de los precios guardados en la base, así que se actualiza sola cuando cambia el
                      catálogo. Gratis no significa sin límites: suelen tener cuotas de uso por cuenta.
                    </p>
                  </>
                ) : (
                  <p className={P}>
                    Ningún provider del catálogo actual tiene todos sus modelos a precio cero.
                  </p>
                )}
                <h4 className={H}>Ojo con el $0 engañoso</h4>
                <p className={P}>
                  Un modelo <em>sin tarifa cargada</em> también suma $0 al dashboard, pero no porque sea gratis sino
                  porque falta el dato. En la lista de modelos se distinguen: <span className={CODE}>Gratis</span> en
                  verde contra <span className={CODE}>Sin tarifa</span> en gris.
                </p>
              </div>
            )}

            {guide === "agregar" && (
              <div>
                <h4 className={H}>Descubrir (recomendado)</h4>
                <p className={P}>
                  Trae la lista real de modelos que el provider sirve en este momento y elegís de ahí. Es la forma
                  segura: un ID escrito a mano puede estar mal o haber sido retirado, y eso no falla al guardar —
                  falla mucho después, en plena conversación, con un <span className={CODE}>404</span> o un{" "}
                  <span className={CODE}>410 Gone</span>.
                </p>
                <p className={`${P} mt-2`}>
                  Los modelos que ya tienes cargados aparecen marcados para que no los dupliques.
                </p>
                <h4 className={H}>Manual</h4>
                <p className={P}>
                  Para providers que no publican su lista de modelos. Campos:
                </p>
                <ul className={`${P} mt-2 space-y-1.5 list-disc pl-4`}>
                  <li><b className="text-white/70">ID en la API</b> — el nombre exacto que espera el provider.</li>
                  <li><b className="text-white/70">Nombre visible</b> — sólo para la UI.</li>
                  <li><b className="text-white/70">Contexto</b> — tokens de entrada máximos; también decide cuándo se compacta la conversación.</li>
                  <li><b className="text-white/70">Costo</b> — USD por millón de tokens.</li>
                  <li><b className="text-white/70">Capacidades</b> — <span className={CODE}>function_calling</span> es la que habilita herramientas.</li>
                </ul>
                <p className={`${P} mt-3`}>
                  Los modelos que agregues a mano sobreviven a las actualizaciones del catálogo: no se borran al
                  actualizar la lista de modelos que trae Hive.
                </p>
              </div>
            )}

            {guide === "ollama" && (
              <div>
                <h4 className={H}>Cómo se llaman</h4>
                <p className={P}>
                  Ollama identifica cada modelo como <span className={CODE}>nombre:tag</span>, donde el tag es la
                  variante o el tamaño. Ejemplos: <span className={CODE}>llama3.3:8b</span>,{" "}
                  <span className={CODE}>qwen3:14b</span>, <span className={CODE}>mistral:7b</span>. Sin tag, Ollama
                  asume <span className={CODE}>:latest</span>.
                </p>
                <h4 className={H}>No los escribas a mano</h4>
                <p className={P}>
                  El botón de sincronizar de la tarjeta lee los modelos que ya tienes instalados y los carga solo. Si
                  un modelo no aparece, primero bajalo en tu máquina con{" "}
                  <span className={CODE}>ollama pull llama3.3:8b</span> y volvé a sincronizar.
                </p>
                <h4 className={H}>Contexto</h4>
                <p className={P}>
                  Los modelos descubiertos entran con contexto 0 porque Ollama no lo reporta en el listado. Editalo
                  con el valor real del modelo: si queda en 0, Hive usa un valor por defecto que puede no
                  corresponder al que tienes cargado.
                </p>
                <h4 className={H}>Costo</h4>
                <p className={P}>
                  Corren en tu máquina, así que entran en <span className={CODE}>0</span>. No consumen presupuesto.
                </p>
              </div>
            )}

            {guide === "modelscope" && (
              <div>
                <h4 className={H}>El error que casi nadie encuentra: .ai vs .cn</h4>
                <p className={P}>
                  ModelScope tiene dos endpoints con <b className="text-white/70">cuentas y tokens separados</b>:{" "}
                  <span className={CODE}>api-inference.modelscope.ai</span> (internacional) y{" "}
                  <span className={CODE}>api-inference.modelscope.cn</span> (China). Un token de uno responde{" "}
                  <span className={CODE}>401</span> en el otro.
                </p>
                <p className={`${P} mt-2`}>
                  Lo confuso: <b className="text-white/70">el listado de modelos responde 200 en los dos</b>, porque es
                  público y no valida la key. El 401 aparece recién al invocar un modelo. Si te pasa eso, no es la key
                  — es el dominio. Hive viene apuntando al internacional (<span className={CODE}>.ai</span>); cámbialo
                  desde CONFIG si tu cuenta es la china.
                </p>
                <h4 className={H}>ModelScope no es DashScope</h4>
                <p className={P}>
                  Son plataformas distintas de Alibaba, con cuentas y créditos separados. El provider{" "}
                  <span className={CODE}>ModelScope Qwen</span> usa un token de modelscope.cn → Access Tokens. El
                  provider <span className={CODE}>Qwen (Alibaba)</span> usa una API key de Model Studio / DashScope.
                  Una no sirve para el otro.
                </p>
                <h4 className={H}>Cuota</h4>
                <p className={P}>
                  El endpoint es gratuito dentro de límite: 2000 llamadas por día y hasta 500 por modelo. Por eso sus
                  modelos figuran con costo <span className={CODE}>0</span>.
                </p>
                <h4 className={H}>Modelos de embajador</h4>
                <p className={P}>
                  Los <span className={CODE}>Qwen-Ambassador/*</span> (3.7-Plus, 3.7-Max, 3.8-Max) aparecen en el
                  listado para todo el mundo, pero sólo los puede invocar una cuenta del programa de embajadores. Si
                  no eres parte, el provider devuelve un error de autorización al usarlos.
                </p>
              </div>
            )}

            {guide === "costos" && (
              <div>
                <h4 className={H}>De dónde sale el número</h4>
                <p className={P}>
                  Cada modelo guarda su precio de entrada y de salida en USD por millón de tokens. Cuando un agente
                  responde, se registran los tokens reales de esa llamada y se multiplican por el precio de ese
                  modelo. No hay tabla de precios aparte: lo que ves en la tarjeta es lo mismo que factura el
                  dashboard.
                </p>
                <h4 className={H}>Entrada y salida no valen igual</h4>
                <p className={P}>
                  La salida suele costar entre 3 y 6 veces más que la entrada. Por eso se muestran los dos números:{" "}
                  <span className={CODE}>$3 / $15</span> es entrada / salida.
                </p>
                <h4 className={H}>«Sin tarifa» vs. 0</h4>
                <p className={P}>
                  Dejar el precio vacío marca el modelo como sin tarifa y su consumo se cuenta como $0 — lo cual
                  ensucia el total sin avisar. Si el endpoint es realmente gratuito, pon{" "}
                  <span className={CODE}>0</span> explícito.
                </p>
                <h4 className={H}>Gasto por provider</h4>
                <p className={P}>
                  El pie de cada tarjeta muestra el gasto y los tokens de los últimos 30 días de ese provider. Un{" "}
                  <span className={CODE}>—</span> significa que todavía no hay registros de uso.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 px-3.5 rounded-md bg-white/5 border border-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
