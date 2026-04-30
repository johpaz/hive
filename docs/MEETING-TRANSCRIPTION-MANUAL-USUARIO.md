# Manual de Usuario: Transcripción de Reuniones

## Requisitos

- **Navegador**: Google Chrome o Microsoft Edge (versiones recientes)
- **Sistema operativo**: Windows (recomendado), macOS o Linux

---

## Cómo Usar

### 1. Iniciar una Sesión

1. Abre el módulo de **Transcripción de Reuniones** en Hive
2. Ingresa el **título** de la reunión en el campo de texto
3. Haz clic en **"Iniciar"**

**IMPORTANTE**: El navegador mostrará un diálogo para compartir contenido.

### 2. Seleccionar qué Compartir

En el diálogo de Chrome/Edge:

1. Selecciona la **pestaña del navegador** donde está la reunión (Zoom, Meet, Teams, etc.)
2. **Marca la opción "Compartir audio"** (Importante: si no la marcas, solo se captará tu micrófono)
3. Haz clic en "Compartir"

### 3. Modos de Captura

El sistema detectará automáticamente el modo de captura:

| Indicador | Significado |
|----------|-------------|
| 🔴 REC (sin badge) | Solo micrófono |
| 🔴 REC Mic+Altavoz | Micrófono + Audio del sistema |
| 🔴 REC Altavo | Solo audio del sistema (sin micrófono) |

### 4. Durante la Reunión

- Puedes hablar normalmente
- El audio de los demás participantes se captura si está sonando por los altavoces
- Las transcripciones aparecen en tiempo real en el panel

### 5. Finalizar

1. Haz clic en **"Detener"**
2. El audio deja de captarse
3. Puedes generar un reporte con el botón **"Generar Reporte"**

---

## Solución de Problemas

### "No se pudo acceder al micrófono"

- Verifica que el micrófono esté conectado
- Permite el acceso en la barra deURL (ícono 🔒)
- Asegúrate de usar HTTPS o localhost

### No se transcribe el audio de otros participantes

- Verifica que **"Compartir audio"** esté marcado en el diálogo
- Usa **Chrome o Edge** en Windows
- El audio debe estar sonando por los altavoces (no auricularesBluetooth)

### Solo se captura mi voz

- El módulo captura el audio del sistema (lo que sale por los altavoces)
- Si usas auriculares, el audio no se captura
- Usa altavoces o un cable de audio virtual

---

## Compatibilidad

| Función | Chrome/Edge | Firefox | Safari |
|--------|------------|---------|--------|
| Micrófono | ✅ | ✅ | ✅ |
| Audio del sistema | ✅ (Win) | ⚠️ tabs | ❌ |
| Captura dual | ✅ | ❌ | ❌ |

---

## Tips

1. **Usa Chrome en Windows** para mejor compatibilidad
2. **Aumenta el volumen** del altavoz para mejor captura
3. **Cierra otras aplicaciones** de audio que puedan interferir
4. **使用 altavoces** en lugar de auriculares para capturar audio del sistema