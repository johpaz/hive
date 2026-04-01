# CAPTCHA Self-Solve

Hive incluye un sistema de resolución automática de CAPTCHAs usando **Gemini 2.5 Flash** para análisis de imágenes.

---

## Uso Automático

Cuando navegas a una URL con `browser_navigate`, Hive automáticamente:

1. **Detecta** el tipo de CAPTCHA presente
2. **Resuelve** usando el modelo de visión
3. **Retorna** el resultado junto con la página

```typescript
// Ejemplo - Navegar a Airbnb
browser_navigate(url="https://airbnb.com")
// Retorna: { ok: true, content: "...", captcha: { type: "hcaptcha", solved: true } }
```

---

## Uso Manual

Si el CAPTCHA aparece después de interactuar con la página, usa el tool `captcha_solve`:

```typescript
// Resolver CAPTCHA manualmente
captcha_solve()
// O especificar el tipo
captcha_solve(type="hcaptcha")
```

---

## Configuración

### Requisitos

1. **Proveedor Gemini configurado**: El sistema obtiene la API key desde la tabla `providers` de la base de datos (la misma API key usada para el agente LLM)

2. **Proveedor habilitado**: Asegúrate de que el provider "gemini" esté habilitado en Hive

### Fallback

Si no hay un provider configurado, el sistema intentará usar la variable de entorno `GEMINI_API_KEY` como alternativa.

### Configuración en Hive

El sistema se configura automáticamente con valores por defecto:

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `enabled` | `false` | Habilitar resolución automática |
| `autoSolve` | `true` | Resolver después de `browser_navigate` |
| `visionProvider` | `gemini` | Proveedor de visión |
| `visionModel` | `gemini-2.0-flash-exp` | Modelo de visión |
| `maxAttempts` | `3` | Intentos por CAPTCHA |
| `maxRounds` | `5` | Rondas por challenge |

---

## Tipos Soportados

| Tipo | Descripción | Sitio Ejemplo |
|------|-------------|---------------|
| `hcaptcha` | Grid de selección de imágenes | Airbnb |
| `recaptcha-v2-grid` | reCAPTCHA visual con grid | Google |
| `turnstile` | Cloudflare Turnstile | Cloudflare |
| `text-simple` | Texto distorsionado | Sitios varios |

---

## Arquitectura

```
packages/core/src/tools/web/captcha/
├── types.ts       # Tipos e interfaces
├── detector.ts    # Detección por selectores CSS
├── vision.ts      # Integración con Gemini
├── solver.ts      # Lógica de resolución
└── index.ts       # Exports
```

---

## Limitaciones

- **Rate limiting**: Si fallan muchos intentos, el sitio puede bloquearte temporalmente
- **Slider/Puzzle**: No soportado (requiere coordenadas precisas)
- **Managed Challenge**: Turnstile en modo "Just a moment..." no se puede resolver con visión
- **Audio**: Requiere modelo con soporte de audio

---

## Errores Comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `No API key configured for CAPTCHA solver` | No hay provider gemini configurado | Configura un provider gemini en Hive |
| `CAPTCHA not found` | No hay CAPTCHA | Verificar que el CAPTCHA sea visible |
| `Max rounds exceeded` | Demasiados intentos | Esperar e intentar de nuevo |
