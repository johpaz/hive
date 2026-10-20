from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.opc.packuri import PackURI

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SOURCE = Path('/home/johnpaez/Descargas/DevOpsDays-Bogota-2026-Plantilla-Speaker (2).pptx')
PHOTO = Path('/home/johnpaez/Descargas/Imagen de ChatGPT 8 oct 2026, 15_42_34.png')
P = Presentation(SOURCE)
INK, PURPLE, BLUE, MUTED, PALE = '071329', '6D28D9', '2563EB', '475569', 'F3F5FD'
records = []
durations = {
    'Responder es solo una parte del trabajo':45,
    'La arquitectura, de extremo a extremo':90,
    'El harness convierte intención en ejecución':75,
    'Un lease identifica al dueño temporal':90,
    'Una caída deja una pregunta pendiente':75,
    'El loop decide, actúa y vuelve a observar':90,
    'Cargar capacidades cuando hacen falta':60,
    'Delegar también exige un contrato':75,
    'La evidencia acompaña al resultado':75,
    'HiveDB conserva el estado del sistema':90,
    'Un motor, varias formas de consultar':75,
    'Una versión protege la transición del job':75,
    'Observar causas, además de mensajes':60,
    'Una tarea, varias entregas verificables':150,
    'Qué debemos seguir midiendo y cuidando':45,
}

def text(s, value, x, y, w, h, size=22, color=INK, bold=False, font='Calibri', align=None):
    sh = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = sh.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(.02)
    tf.margin_top = tf.margin_bottom = 0
    for i, line in enumerate(value.split('\n')):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.name, p.font.size = font, Pt(size)
        p.font.bold, p.font.color.rgb = bold, RGBColor.from_string(color)
        p.space_after = Pt(8)
        if align is not None:
            p.alignment = align
    return sh

def box(s, x, y, w, h, fill=PALE, line='E1E6F4', rounded=True):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE,
                            Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor.from_string(fill)
    sh.line.color.rgb = RGBColor.from_string(line)
    if rounded:
        sh.adjustments[0] = .08
    return sh

def arrow(s,x,y,w=.35,h=.3,color=PURPLE):
    sh=s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW,Inches(x),Inches(y),Inches(w),Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb=RGBColor.from_string(color); sh.line.fill.background()
    return sh

def card(s, x, y, w, h, title, body, accent=PURPLE, size=22):
    box(s,x,y,w,h)
    text(s,title,x+.22,y+.2,w-.44,.55,23,accent,True)
    text(s,body,x+.22,y+.92,w-.44,h-1.02,size)

def note(s,title,seconds,body,sources=''):
    seconds=durations.get(title,seconds)
    records.append({'title':title,'seconds':seconds,'notes':body,'sources':sources})
    s.notes_slide.notes_text_frame.text=f'{title}\nDuración: {seconds} segundos.\n\n{body}\n\nFuentes del contenido: {sources}'

def new(title,eyebrow,seconds,notes,sources=''):
    s=P.slides.add_slide(P.slide_layouts[4])
    for sh in list(s.shapes):
        s.shapes._spTree.remove(sh._element)
    text(s,eyebrow.upper(),1.22,.49,10,.3,12,PURPLE,True)
    text(s,title,.7,.92,11.93,.88,32,INK,True)
    text(s,f'{len(records)+1:02d}',2.05,6.93,.6,.28,11,MUTED)
    if sources:
        short=sources.replace('packages/core/src/','core/').replace('node_modules/@johpaz/hive-db/','@johpaz/hive-db/')
        text(s,short,.72,6.32,11.9,.18,8.5,MUTED)
    note(s,title,seconds,notes,sources)
    return s

# Conservar la portada seleccionada y un cierre de la plantilla.
cover=P.slides[0]
closing=next(s for s in P.slides if any(sh.has_text_frame and sh.text=='Gracias' for sh in s.shapes))
for sid in list(P.slides._sldIdLst):
    if P.part.related_slide(sid.rId) not in [cover,closing]:
        P.part.drop_rel(sid.rId); P.slides._sldIdLst.remove(sid)
# python-pptx asigna nuevas partes por cantidad de slides; normalizar las
# conservadas impide colisiones con el antiguo número de parte del cierre.
cover.part._partname=PackURI('/ppt/slides/slide1.xml')
closing.part._partname=PackURI('/ppt/slides/slide2.xml')
for sh in list(cover.shapes):
    if sh.has_text_frame:
        cover.shapes._spTree.remove(sh._element)
text(cover,'Por dentro de\nun enjambre',.7,1.95,3.95,1.3,33,INK,True)
text(cover,'Harness, agent loop\ny el motor de datos\nde Hive',.7,3.4,3.95,1.25,22,PURPLE)
text(cover,'John Alexander\nPáez Arias · Hive',.7,4.83,3.95,.78,18,INK,True)
text(cover,'23 · 10 · 2026\nCompensar Av. 68 · Bogotá',.7,5.88,3.95,.6,14)
text(cover,'#DevOpsDaysBogota',.7,6.65,3.95,.28,11,PURPLE,font='Courier New')
note(cover,'Por dentro de un enjambre',30,'Abrir con una pregunta: ¿qué pasa cuando un agente dice “listo”, pero el proceso se cayó antes de confirmar el resultado? La charla muestra cómo Hive conecta ejecución, recuperación y evidencia. No presentar cifras de rendimiento ni resultados de demo sin haberlos medido.','Título del programa del evento; plantilla del organizador')

s=new('John Alexander Páez Arias','Quién soy',30,'Presentarme desde el proyecto: trabajo en Hive, un runtime de agentes local-first. Completar oralmente mi experiencia personal sin añadir cargos o credenciales no confirmados. Explicar que hoy vamos a abrir el runtime, no recorrer todas las funciones de la interfaz.','README.md')
s.shapes.add_picture(str(PHOTO),Inches(.7),Inches(1.94),width=Inches(3.36),height=Inches(4.2))
text(s,'Hive · Runtime de agentes local-first',4.65,2.08,7.6,.8,28,PURPLE,True)
text(s,'Construir agentes que ejecuten,\nrecuperen su trabajo y entreguen\nevidencia verificable.',4.65,3.2,7.5,1.65,28)
text(s,'linkedin.com/in/john-alexander-paez-arias',4.65,5.35,7.45,.45,16,BLUE)
s.shapes.add_picture(str(ROOT/'packages/hive-ui/public/logocolor-dark.png'),Inches(10.4),Inches(4.62),width=Inches(1.65))

s=new('Responder es solo una parte del trabajo','El problema',75,'Plantear un caso hipotético: “analiza este archivo y genera un reporte”. El modelo puede emitir una respuesta válida sin que el archivo exista o esté correcto. La dificultad operativa aparece con fallos, contexto incompleto y efectos externos. Estas son motivaciones de diseño, no resultados históricos medidos.','docs/architecture/runtime.md')
card(s,.7,2.12,3.78,3.55,'Ejecución','¿La acción ocurrió?\n¿Quién tenía permiso?\n¿Con qué límites?')
card(s,4.77,2.12,3.78,3.55,'Recuperación','¿Qué quedó guardado?\n¿Qué quedó incierto?\n¿Se puede reintentar?')
card(s,8.84,2.12,3.78,3.55,'Verificación','¿Qué se comprobó?\n¿Dónde está la evidencia?\n¿Quién acepta el resultado?')

s=new('Tres piezas para operar un enjambre','Mapa de la charla',30,'Dar el mapa mental: harness es el marco operativo; loop es el ciclo de decisión y acción; datos conservan estado, capacidades y evidencia. La demo unirá las tres piezas. Evitar presentar “enjambre” como una topología distribuida con garantías no implementadas.','docs/architecture/overview.md')
for y,n,t,b in [(2.15,'01','Harness','Jobs, leases, checkpoints y presupuestos'),(3.33,'02','Agent loop','Contexto → modelo → herramientas → resultados'),(4.51,'03','HiveDB','Estado persistente, búsqueda y eventos causales')]:
    text(s,n,.75,y,.8,.65,30,PURPLE,True); text(s,t,1.8,y,3.25,.65,27,INK,True); text(s,b,5.2,y+.05,7.1,.8,23,MUTED)

s=new('La arquitectura, de extremo a extremo','Arquitectura',105,'Leer de izquierda a derecha: canal, gateway y coordinador. El coordinador descubre capacidades y delega en especialistas. Los especialistas usan herramientas nativas o MCP. El harness organiza la ejecución y HiveDB conserva estado y evidencia. Las flechas son relaciones lógicas simplificadas; no implican que cada escritura pase por una transacción común.','docs/architecture/overview.md')
box(s,6.25,1.87,6.35,.45,fill='EDE9FE')
text(s,'JEV · plano de decisión opcional para los agentes',6.42,1.96,5.95,.3,17,PURPLE,True)
for x,w,t,b in [(.7,2.3,'Canales','Web · CLI\nMensajería'),(3.4,2.45,'Gateway','HTTP + WebSocket\nEntrada de turnos'),(6.25,2.65,'Coordinador','Descubre capacidades\nDelega y evalúa'),(9.3,3.3,'Especialistas','Tools nativas + MCP\nEntregan evidencia')]:
    card(s,x,2.48,w,2.15,t,b,size=19)
    if x<9: arrow(s,x+w+.04,3.48,.32,.27)
box(s,.7,4.94,5.72,.91,fill='EDE9FE'); text(s,'HARNESS  ·  jobs / leases / checkpoints',.95,5.15,5.22,.53,22,PURPLE,True)
box(s,6.75,4.94,5.85,.91,fill='E8F0FE'); text(s,'HIVEDB  ·  estado / búsqueda / evidencia',6.97,5.15,5.42,.53,22,BLUE,True)

s=new('El harness convierte intención en ejecución','01 · Harness',90,'Definir harness como los mecanismos que rodean la llamada al modelo. Distinguir Job: unidad programada en una cola; Run: ciclo de un agente con su checkpoint. La conversación define una lane para ordenar turnos. Los presupuestos de iteraciones, tokens y turnos dependen del tipo de ejecución y configuración.','packages/core/src/gateway/job-store.ts; packages/core/src/agent/run-store.ts')
card(s,.7,2.1,5.72,3.65,'Planificar y acotar','Jobs persistentes y lanes\nObjetivo y criterios de aceptación\nPresupuestos de ejecución',size=24)
card(s,6.91,2.1,5.72,3.65,'Conservar y recuperar','Runs con checkpoints\nLeases y renovación\nReintentos con backoff y jitter',size=24)

s=new('Un lease identifica al dueño temporal','Durabilidad',120,'Explicar lease como un permiso temporal de propiedad del trabajo. claimJob usa expectedVersion para ganar una transición pending→running; boot_id identifica al proceso propietario. La renovación mantiene el lease. Si el gateway cae, el arranque recupera trabajos según estado, lease y política. La cola ordena los turnos del mismo lane. Eso no garantiza exactamente una ejecución de cada efecto externo.','packages/core/src/gateway/job-store.ts; docs/architecture/runtime.md')
for x,t,b in [(.7,'PENDING','Trabajo persistido\nEspera su turno'),(4.75,'RUNNING','Claim con versión\nLease renovable'),(8.8,'COMPLETED','Resultado persistido\nPropiedad liberada')]:
    card(s,x,2.25,3.82,2.6,t,b,size=23)
    if x<8: arrow(s,x+3.9,3.4,.32,.3)
box(s,.7,5.15,11.92,.72,fill='EDE9FE'); text(s,'Caída → vencimiento / recuperación → política de continuación',.94,5.33,11.4,.46,23,PURPLE,True)

s=new('Una caída deja una pregunta pendiente','Recuperación',90,'Recorrer la ventana crítica: el checkpoint se guarda antes de la llamada a la herramienta; el efecto puede haber ocurrido antes de que se guarde el resultado. En resume, agent-loop inyecta un resultado sintético [interrupted] para las llamadas pendientes. No reproduce automáticamente esa llamada en ese bloque de recuperación: el modelo decide si reintenta o continúa. Para efectos externos se requiere readback, idempotencia o política explícita; no prometer exactly-once.','packages/core/src/agent/agent-loop.ts')
for x,n,t,b in [(.7,'1','Checkpoint','Guardar tool calls\npendientes'),(4.75,'2','Herramienta','El efecto puede\nhaber ocurrido'),(8.8,'3','Resultado','Guardar respuesta\ny limpiar pendientes')]:
    card(s,x,2.15,3.82,2.6,f'{n} · {t}',b,size=23)
    if x<8: arrow(s,x+3.9,3.35,.32,.3)
text(s,'Si cae entre 2 y 3: resultado desconocido.',.92,5,11.6,.63,30,PURPLE,True)
text(s,'La recuperación informa [interrupted]; el siguiente paso debe resolver la incertidumbre.',.92,5.7,11.6,.47,19,MUTED)

s=new('El loop decide, actúa y vuelve a observar','02 · Agent loop',105,'Narrar una iteración: construir contexto, invocar proveedor, interpretar texto y llamadas, ejecutar herramientas, agregar resultados al siguiente paso. Para runs durables hay checkpoints antes y después de herramientas. Las herramientas independientes pueden paralelizarse según el runtime y sus políticas. Se termina al responder, delegar, agotar límites, abortar o fallar. Existen detección de loops y falta de progreso.','packages/core/src/agent/agent-loop.ts; docs/architecture/runtime.md')
for x,t,b in [(.7,'Contexto','Historial + reglas\nTools disponibles'),(3.74,'Modelo','Texto o\ntool calls'),(6.78,'Herramientas','Acción acotada\nResultado normalizado'),(9.82,'Observación','Resultado entra\nal siguiente paso')]:
    card(s,x,2.28,2.8,2.7,t,b,size=21)
    if x<9: arrow(s,x+2.85,3.5,.15,.26)
box(s,.7,5.3,11.93,.63,fill='EDE9FE'); text(s,'Repetir con límites de iteración, tiempo, contexto y progreso.',.96,5.44,11.4,.4,23,PURPLE,True)

s=new('Cargar capacidades cuando hacen falta','Contexto y descubrimiento',90,'Explicar el costo de cargar el catálogo completo: ruido y espacio ocupado en el contexto. Hive arranca con herramientas esenciales y search_knowledge consulta el catálogo de tools, skills, MCP y reglas. capability-search usa queryHybrid. No fijar el número de herramientas esenciales: hay diferencias entre README y docs/runtime. Introducir las siguientes dos láminas: Jev asesora esa selección y las decisiones del loop.','packages/core/src/agent/capability-search.ts; docs/architecture/runtime.md')
card(s,.7,2.1,5.72,3.6,'Inicio del turno','Identidad y contexto reciente\nHerramientas esenciales\nPresupuesto de ventana',size=24)
card(s,6.91,2.1,5.72,3.6,'Descubrimiento','search_knowledge busca capacidades\nSe amplía el loadout del turno\nLa skill acompaña a la herramienta',size=23)

s=new('Jev decide qué necesita cada paso','El oráculo · Plano de decisión',90,'Definir Jev como plano de decisión opcional sobre OpenRouter Decisions. Responde preguntas cerradas con probabilidades y opciones; el modelo de texto del agente redacta y ejecuta. Tres puntos: planJevContext selecciona historial, herramientas, skills, notas y reglas y recomienda especialista; planJevIteration poda resultados viejos y orienta continue/delegate/discover/finish; jevWantsParallel decide solo sobre lotes candidatos previamente seguros. El último resultado, el contexto reciente y herramientas esenciales tienen protecciones del runtime. Sin clave o ante fallo se conserva el flujo clásico. Timeout: tres segundos por decisión; cooldown: sesenta segundos después de tres fallos consecutivos. Los extractos de contexto viajan a OpenRouter; no describir Jev como inferencia local. En resume se omite Jev.','docs/internals/jev.md; packages/core/src/agent/jev-planner.ts')
card(s,.7,2.1,3.82,3.3,'Antes del turno','Seleccionar contexto\nTools, skills, notas y reglas\nRecomendar especialista',size=23)
card(s,4.75,2.1,3.82,3.3,'Entre iteraciones','Podar resultados viejos\nOrientar el siguiente paso\nConservar el resultado reciente',size=23)
card(s,8.8,2.1,3.82,3.3,'Antes del lote','Evaluar independencia\nLecturas o delegaciones seguras\nDecidir paralelismo',size=23)
text(s,'Opcional · OpenRouter Decisions · fallo o timeout → flujo clásico',.92,5.7,11.4,.47,23,PURPLE,True)

s=new('El oráculo hace visibles las decisiones','Jev en Office3D',90,'El esquema de esta lámina representa el componente JevOracle; no es una captura de una decisión real. En Office3D el cristal violeta flota sobre el coordinador y un rayo señala al agente asesorado por cada nueva decisión. El chip muestra tipo de decisión, tokens estimados y latencia. JevPanel enseña estado, última decisión, costo y aporte por agente; el dashboard ofrece rollups. El ahorro de tokens es una estimación contra el contexto clásico (caracteres divididos por cuatro), y puede resultar negativo; no afirmar una reducción medida ni ahorro neto garantizado. Un estado fallback se muestra con otro color y el runtime sigue por la vía clásica. En la demo mostrar el oráculo solo si Jev está activo y se generan decisiones nuevas.','docs/internals/jev.md; packages/hive-ui/src/modules/office3d/scene/JevOracle.tsx')
box(s,.7,2.1,5.72,3.7,fill=INK,line=INK)
diamond=s.shapes.add_shape(MSO_SHAPE.DIAMOND,Inches(2.62),Inches(2.5),Inches(1.72),Inches(1.32))
diamond.fill.solid(); diamond.fill.fore_color.rgb=RGBColor.from_string('A78BFA'); diamond.line.color.rgb=RGBColor.from_string('C4B5FD')
text(s,'JEV',2.96,2.92,1.05,.4,24,INK,True)
text(s,'↓ decisiones',2.33,3.98,2.4,.45,22,'C4B5FD',align=PP_ALIGN.CENTER)
text(s,'Coordinador / especialista',1.25,4.65,4.6,.6,25,'FFFFFF',True,align=PP_ALIGN.CENTER)
text(s,'Esquema del oráculo en Office3D',1.03,5.43,5.1,.32,15,'CBD5E1',align=PP_ALIGN.CENTER)
card(s,6.91,2.1,5.72,3.7,'Qué podemos observar','Agente asesorado y última decisión\nLatencia de la decisión\nCosto de Jev\nTokens evitados o añadidos (estimación)',size=22)


s=new('Delegar también exige un contrato','El enjambre',90,'El coordinador elige un agente de catálogo; el runtime fija objetivo, aceptación, herramientas, skills, workspace, recursos, proveedor y IDs. Delegaciones hermanas pueden agruparse. El gateway continúa los jobs y un turno de fan-in evalúa entregas. task_revise devuelve feedback al mismo worker. Explicar que especializar también reduce herramientas y recursos disponibles.','docs/architecture/runtime.md; packages/core/src/agent/delegation-runtime.ts')
for x,t,b in [(.7,'Contrato','Objetivo\nCriterios de aceptación\nTools y workspace'),(4.75,'Worker','Modelo y capacidades\nEjecución acotada\nResultado + evidencia'),(8.8,'Coordinador','Evalúa los checks\nAcepta o pide revisión\nSintetiza la entrega')]:
    card(s,x,2.2,3.82,3.35,t,b,size=22)
    if x<8: arrow(s,x+3.9,3.7,.32,.3)
text(s,'task_delegate → ejecución → evaluación → task_revise si hace falta',.86,5.78,11.6,.4,20,PURPLE,True)

s=new('La evidencia acompaña al resultado','Aceptación',90,'Describir proof packet como un paquete de evidencia, no una prueba formal de corrección. Incluye intención, criterios, checks ejecutados, evidencia y límites conocidos. buildProofPacket rechaza marcar éxito sin al menos un check y evidencia no vacía. Eso valida estructura mínima, no la verdad universal del resultado. Los criterios con checkTool tienen verificación determinista; los otros requieren juicio del coordinador.','packages/core/src/agent/proof-packet.ts; docs/architecture/runtime.md')
card(s,.7,2.1,5.72,3.65,'Qué se conserva','Resultado esperado\nVeredicto por criterio\nChecks y evidencia\nLímites conocidos',size=24)
card(s,6.91,2.1,5.72,3.65,'Cómo se acepta','Checks determinísticos cuando existen\nInspección de artefactos y readbacks\nEvaluación del coordinador\nRevisión si no cumple',size=22)

s=new('HiveDB conserva el estado del sistema','03 · Motor de datos',105,'Presentar HiveDB como motor embebido en Rust expuesto por N-API a Bun/Node. En Hive es la única base persistente. Conserva configuración, agentes, conversación, runs, jobs y evidencia en documentos y eventos; los binarios de artefactos viven en filesystem y sus metadatos en HiveDB. La ruta deriva de HIVE_HOME. No prometer que todos los documentos de Hive se reconstruyen del event log.','packages/core/src/storage/hivedb.ts; docs/architecture/overview.md')
for x,t,b in [(.7,'Identidad y contexto','Agentes y modelos\nConversación y memoria\nCatálogo de capacidades'),(4.75,'Ejecución','agentRuns y jobQueue\nVersiones y leases\nCheckpoints'),(8.8,'Evidencia','Eventos causales\nProof packets\nMetadatos de artefactos')]:
    card(s,x,2.1,3.82,3.45,t,b,size=23)
text(s,'Rust → N-API → Bun / TypeScript   ·   HIVE_HOME/data/hivedb',.94,5.88,11.4,.36,20,BLUE,True)

s=new('Un motor, varias formas de consultar','Dentro de HiveDB',90,'Distinguir capas: redb para documentos y event log; tantivy para búsqueda lexical BM25; HNSW para búsqueda vectorial aproximada; RRF para combinar rankings. La API queryHybrid no implica que cada instalación tenga vectores: en el accessor de Hive se usa HiveDB.open sin configuración explícita de embedder. Las capacidades vectoriales necesitan configuración o vectores. No usar benchmarks del README como mediciones de la charla.','node_modules/@johpaz/hive-db/README.md; packages/core/src/storage/hivedb.ts')
card(s,.7,2.1,3.82,3.65,'Persistencia · redb','Colecciones mutables\nVersiones optimistas\nEvent log append-only',size=23)
card(s,4.75,2.1,3.82,3.65,'Texto · tantivy','Búsqueda BM25\nÍndice de capacidades\nRelevancia por consulta',size=23)
card(s,8.8,2.1,3.82,3.65,'Vectores · HNSW','Búsqueda aproximada\nFusión híbrida con RRF\nVectores / embedder configurados',size=22)

s=new('Una versión protege la transición del job','Código · Control de concurrencia',90,'Mostrar el extracto real de claimJob. Dos competidores pueden leer la misma versión; expectedVersion permite que solo uno gane la escritura para ese job. El otro vuelve a leer o sale. La protección es por documento y transición; no es una transacción distribuida ni asegura exactly-once de llamadas externas. El fragmento se recortó para enfocarse en las líneas decisivas.','packages/core/src/gateway/job-store.ts · extracto de claimJob')
box(s,.7,2.05,11.92,3.65,fill=INK,line=INK)
code='const entry = await c.get(jobId);\nif (!entry) return null;\nconst doc = entry.doc;\nif (doc.status !== "pending") return null;\n// ... construir estado running y lease ...\nawait c.put(jobId, updated, {\n  expectedVersion: entry.version\n});'
code_shape=text(s,code,1,2.32,11.3,3.12,22,'D4E2FF',font='Courier New')
for paragraph in code_shape.text_frame.paragraphs:
    paragraph.space_after=Pt(0)
    paragraph.line_spacing=1.1
text(s,'La escritura solo prospera si la versión leída sigue vigente.',.93,5.84,11.4,.4,22,PURPLE,True)

s=new('Observar causas, además de mensajes','Observabilidad',90,'Separar memoria de conversación y registro de ejecución. Los IDs permiten asociar turno, run, tarea, agente y artefactos. El log causal conserva intención, cambios de estado y llamadas. Las suscripciones de HiveDB son en proceso y solo entregan eventos nuevos; no hacen replay histórico automáticamente. Usar causalThread/read para histórico cuando se necesite. Office3D es una superficie de actividad, no una prueba suficiente de éxito.','packages/core/src/storage/causal-events.ts; docs/architecture/runtime.md')
for x,t,b in [(.7,'Intención','Qué se pidió\nQuién lo pidió\nEn qué ejecución'),(4.75,'Acciones','Qué herramienta corrió\nCuánto tardó\nQué resultado devolvió'),(8.8,'Evidencia','Qué se verificó\nQué artefacto quedó\nQué limitación persiste')]:
    card(s,x,2.1,3.82,3.55,t,b,size=23)
text(s,'IDs de thread / run / task conectan el recorrido.',.94,5.93,11.4,.36,22,BLUE,True)

s=new('Una tarea, varias entregas verificables','Demo guiada · Caso propuesto',180,'Demo sugerida, NO ejecutada durante la preparación. Preparar un CSV sintético de 5 servicios con estado y latencia (ver servicios-demo.csv). Pedir: “Lee servicios-demo.csv. Genera reporte-devops.md con la tabla completa, los servicios degradados, el criterio de degradación y recomendaciones. Verifica leyendo el archivo final. No inventes datos.” Mostrar descubrimiento/delegación si ocurre, ejecución, artefacto y readback. El resultado esperado es un reporte que conserve las 5 filas y marque pagos y notificaciones como degradados por estado != ok o latencia > 500 ms. No forzar una topología de agentes: el coordinador puede resolver directamente. Tener un reporte de respaldo preparado y claramente identificado. La captura de la slide es ilustrativa de la interfaz, no evidencia de esta demo. Evitar reiniciar el gateway en vivo en estos tres minutos; usar el diagrama de recuperación para explicar esa parte.','docs/assets/office3d-screenshot.jpg · captura ilustrativa; caso de demo propuesto')
s.shapes.add_picture(str(ROOT/'docs/assets/office3d-screenshot.jpg'),Inches(.7),Inches(2.12),width=Inches(7.15))
text(s,'Office3D · actividad del enjambre',.85,5.56,6.8,.4,16,MUTED)
for y,n,t,b in [(2.12,'1','Entrada','CSV sintético de cinco servicios'),(3.43,'2','Acción','Generar reporte y leerlo de nuevo'),(4.74,'3','Aceptación','Filas completas + criterio explícito')]:
    text(s,n,8.1,y,.55,.55,27,PURPLE,True); text(s,t,8.78,y,3.6,.5,23,INK,True); text(s,b,8.78,y+.58,3.67,.7,20,MUTED)

s=new('Qué debemos seguir midiendo y cuidando','Límites y decisiones',60,'Exponer límites como decisiones de ingeniería. Un proveedor local o remoto afecta latencia, calidad y disponibilidad. Los reintentos necesitan idempotencia y políticas ante efectos externos. La recuperación depende de checkpoints y política de resume; no todo turno corto de chat comienza durable. HiveDB embebido se abre de forma exclusiva: evitar procesos separados accediendo al mismo directorio. Para producción probar recuperación, backup/restore y retención. No afirmar HA horizontal ni garantías que el código no ofrece.','docs/architecture/runtime.md; packages/core/src/storage/causal-events.ts')
card(s,.7,2.12,5.72,3.6,'Ejecución','Reintentos y efectos externos\nPresupuestos de tiempo y tokens\nLatencia y calidad del modelo',size=24)
card(s,6.91,2.12,5.72,3.6,'Operación','Apertura exclusiva del motor\nBackups y recuperación probada\nRetención de artefactos y evidencia',size=24)

s=new('Tres prácticas para llevar a tu plataforma','Qué te llevas',45,'Cerrar con tres acciones aplicables aunque no usen Hive: definir aceptación antes de ejecutar; conservar checkpoints y resolver incertidumbre de efectos; entregar evidencia enlazada al resultado. El punto central es operar el ciclo completo, no confiar en una frase del modelo.','Síntesis de la charla')
for y,n,t,b in [(2.15,'01','Define qué significa “listo”.','Objetivo y criterios verificables antes de delegar.'),(3.43,'02','Diseña la recuperación.','Estado durable y política para efectos inciertos.'),(4.71,'03','Entrega evidencia.','Checks, artefactos y límites junto al resultado.')]:
    text(s,n,.75,y,.8,.65,30,PURPLE,True); text(s,t,1.85,y,10.6,.6,28,INK,True); text(s,b,1.85,y+.62,10.6,.6,22,MUTED)

s=new('Hive: app de escritorio o instalación con Bun','Primeros pasos · Hive',60,'Presentar dos rutas con la misma importancia. App de escritorio: descargar el instalador de Windows, macOS o Linux desde https://github.com/johpaz/hive/releases/latest; instalar y abrir la app, que trae el gateway embebido. No requiere instalar Bun, Docker ni Git. Configurar proveedor y modelo en el asistente. Para terminal: Bun >= 1.4.2 según package.json; instalar Hive 1.1.0, hive start y hive doctor. El gateway usa 127.0.0.1:18790 por defecto. Instaladores documentados: Windows .exe o .msi; macOS .dmg; Linux .deb, .rpm o Flatpak. La instalación no se ejecutó durante la preparación. Versiones verificadas el 8 de octubre de 2026 mediante bun pm view.','docs/guides/instalacion.md; package.json; github.com/johpaz/hive/releases/latest')
box(s,.7,2.1,5.72,3.98)
text(s,'App de escritorio',.94,2.35,5.2,.6,28,PURPLE,True)
text(s,'Windows · macOS · Linux',.94,3.16,5.2,.58,26,INK,True)
text(s,'Descarga el instalador de tu sistema.\nAbre la app y configura tu modelo.',.94,3.95,5.2,1.15,23)
text(s,'Incluye el runtime · Sin Bun, Docker ni Git',.94,5.13,5.2,.4,17,MUTED)
sh=text(s,'github.com/johpaz/hive/releases/latest',.94,5.68,5.2,.4,16,BLUE)
sh.text_frame.paragraphs[0].runs[0].hyperlink.address='https://github.com/johpaz/hive/releases/latest'
box(s,6.91,2.1,5.72,2.7,fill=INK,line=INK)
text(s,'Instalación con Bun',7.16,2.34,5.2,.5,25,'C4B5FD',True)
text(s,'bun add --global @johpaz/hive-agents@1.1.0\nhive start\nhive doctor',7.16,3.21,5.2,1.3,14,'D4E2FF',font='Courier New')
text(s,'Bun ≥ 1.4.2',7.16,5.04,5.2,.45,24,PURPLE,True)
text(s,'Configura proveedor y modelo.\nExplora chat y Office3D.',7.16,5.62,5.2,.57,19,MUTED)

s=new('Construir tu aplicación con Hive SDK','Alternativa · Hive SDK',60,'Elegir el SDK para integrar el harness en una app propia con herramientas, agentes e interfaz de negocio. La vía rápida usa hives create-app, comprobada en el CLI y README del SDK local. Instalar el CLI global, crear proyecto, instalar dependencias, copiar .env.example y configurar allí el proveedor antes de ejecutar bun run dev. Si ya existe una app Bun, usar bun add @johpaz/hive-sdk@0.7.2 e importar createAgent/defineTool según README. El SDK publicado es TypeScript y usa APIs de Bun: no anunciar compatibilidad directa con Node. Bun >= 1.4.2. Los comandos se verificaron en documentación y código, no se instalaron ni ejecutaron durante la preparación. Versión 0.7.2 verificada en npm el 8 de octubre de 2026.','hive-sdk/README.md; hive-sdk/package.json; npm @johpaz/hive-sdk')
box(s,.7,2.08,7.25,3.55,fill=INK,line=INK)
sh=text(s,'bun add --global @johpaz/hive-sdk@0.7.2\nhives create-app mi-enjambre\ncd mi-enjambre\nbun install\ncp .env.example .env\n# Configura el proveedor en .env\nbun run dev',.94,2.4,6.78,2.95,19,'D4E2FF',font='Courier New')
for pp in sh.text_frame.paragraphs:
    pp.space_after=Pt(0); pp.line_spacing=1.3
card(s,8.31,2.08,4.3,3.55,'En tu proyecto Bun','Instala el paquete local\nDefine agentes y tools\nReutiliza el harness\nConserva tu propia interfaz',size=22)
text(s,'Bun ≥ 1.4.2 · Ejemplo completo: github.com/johpaz/hive-sdk',.94,5.92,11.5,.4,21,PURPLE,True)

s=new('Código y documentación para continuar','Recursos',15,'Mostrar repositorios de Hive, Hive SDK y HiveDB y la documentación de Jev. Las URLs se tomaron de los repositorios locales; no se inventó un enlace público a esta presentación. Compartir los slides después de decidir dónde publicarlos.','README.md; hive-sdk/README.md; docs/internals/jev.md')
for y,t,url in [(2.08,'Hive','github.com/johpaz/hive'),(2.89,'Hive SDK','github.com/johpaz/hive-sdk'),(3.7,'HiveDB','github.com/johpaz/hive-db'),(4.51,'Jev · El oráculo','github.com/johpaz/hive/blob/main/docs/internals/jev.md'),(5.32,'Contacto','linkedin.com/in/john-alexander-paez-arias')]:
    text(s,t,.95,y,3.5,.55,24,PURPLE,True)
    sh=text(s,url,4.6,y+.02,7.75,.55,20,BLUE)
    sh.text_frame.paragraphs[0].runs[0].hyperlink.address='https://'+url

# El cierre reutiliza la ilustración elegida entre las opciones del organizador.
for sh in list(closing.shapes):
    if sh.has_text_frame:
        closing.shapes._spTree.remove(sh._element)
text(closing,'Gracias',.7,2.12,3.95,.7,36,INK,True)
text(closing,'¿Preguntas?',.7,3.02,3.95,.65,29,PURPLE,True)
text(closing,'John Alexander\nPáez Arias',.7,3.99,3.95,.85,22,INK,True)
text(closing,'github.com/johpaz/hive',.7,5.02,3.95,.5,15,BLUE)
text(closing,'#DevOpsDaysBogota',.7,5.83,3.95,.4,13,PURPLE)
note(closing,'Gracias · Preguntas',180,'Reservar tres minutos para preguntas. Preguntas probables: qué garantiza un checkpoint, qué significa un lease, qué se verifica sin LLM y cómo se usa el motor embebido. Responder con el alcance real: recuperar estado no equivale a confirmar un efecto externo; proof packet no sustituye un check; HiveDB requiere respetar propiedad del directorio.','')
closing_id=next(sid for sid in P.slides._sldIdLst if P.part.related_slide(sid.rId) == closing)
P.slides._sldIdLst.remove(closing_id); P.slides._sldIdLst.append(closing_id)

assert len(P.slides)==len(records)==25
assert sum(r['seconds'] for r in records)==1800, sum(r['seconds'] for r in records)
P.core_properties.title='Por dentro de un enjambre: harness, agent loop y el motor de datos de Hive'
P.core_properties.author='John Alexander Páez Arias'
P.core_properties.subject='DevOpsDays Bogotá 2026 · charla de 30 minutos'
target=ROOT/'DevOpsDays-Bogota-2026-Hive-John-Paez.pptx'
P.save(target)
elapsed=0
guide=['# Por dentro de un enjambre', '', 'John Alexander Páez Arias · DevOpsDays Bogotá 2026', '', 'Duración: 30 minutos (27 de contenido + 3 de preguntas).', '', 'Presentación editable basada en la versión de Descargas con una sola portada. Foto proporcionada por John. El original se conserva. Los diagramas son formas y texto editables. Las notas están también dentro del PowerPoint.', '', 'El contenido técnico se contrastó con el código y documentación locales el 8 de octubre de 2026. La demo propuesta todavía requiere ensayo; la captura de Office3D es ilustrativa.', '', '| Lámina | Inicio | Duración | Tema |', '|---|---|---|---|']
for i,r in enumerate(records,1):
    guide.append(f'| {i} | {elapsed//60:02d}:{elapsed%60:02d} | {r["seconds"]//60}:{r["seconds"]%60:02d} | {r["title"]} |')
    elapsed+=r['seconds']
for i,r in enumerate(records,1):
    guide.extend(['',f'## {i}. {r["title"]}', '',r['notes'],'',f'Fuentes: {r["sources"] or "Cierre de la charla"}.'])
guide.extend(['','## Ensayo de la demo','','1. Copiar `servicios-demo.csv` al workspace autorizado de Hive.','2. Enviar el prompt de la lámina 19.','3. Abrir el reporte y verificar las cinco filas, el umbral y los dos servicios degradados.','4. Comprobar qué herramientas y agentes se usaron; no prometer una delegación que no ocurra.','5. Si Jev está activo, mostrar el cristal y el panel de decisiones de Office3D. Comparar costo, latencia y tokens estimados sin anunciar ahorro neto garantizado.','6. Preparar una grabación o reporte de respaldo, identificado como tal, si la red o el modelo fallan.','','## Instalación y versiones','','Comandos de las láminas 22 y 23 contrastados con README, package.json y CLI de los repositorios locales. Versiones npm consultadas mediante `bun pm view` el 8 de octubre de 2026: [Hive 1.1.0](https://www.npmjs.com/package/@johpaz/hive-agents), [Hive SDK 0.7.2](https://www.npmjs.com/package/@johpaz/hive-sdk). No se instalaron paquetes ni se ejecutó la demo durante la preparación.','','## Decisiones editoriales','','- Se conservaron la portada seleccionada, logo, paleta y pie del evento.','- No se añadieron cargos, métricas, benchmarks ni enlaces públicos a slides sin confirmación.','- Jev es opcional y remoto por OpenRouter; el flujo clásico continúa ante un fallo.','- El cristal de Jev se dibujó como esquema editable, no como captura de una ejecución real.','- `queryHybrid` es una API: los vectores y el embedder son capacidades que requieren configuración.','- `expectedVersion` protege una escritura por documento; no implica transacción distribuida.','- Reanudación de una llamada interrumpida: resultado desconocido, no replay automático garantizado.'])
(OUT/'Guion-y-fuentes.md').write_text('\n'.join(guide)+'\n')
(OUT/'servicios-demo.csv').write_text('servicio,estado,latencia_ms\nautenticacion,ok,120\npagos,degradado,850\ninventario,ok,180\nnotificaciones,ok,620\ncatalogo,ok,95\n')
print(f'Creado: {target}\n25 láminas · 30 minutos · notas integradas')
