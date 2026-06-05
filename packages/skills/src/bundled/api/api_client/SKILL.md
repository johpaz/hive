---
name: api_client
description: "Make HTTP requests to REST APIs using curl-like methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)"
version: 1.0.0
author: Hive Team
icon: "🌐"
category: api
permissions:
  - internet_access
dependencies: []
tools: [api_request]

# Structured skill fields
triggers:
  - "llama a la api"
  - "llama al api"
  - "consume la api"
  - "haz una petición"
  - "haz un request"
  - "envía un post"
  - "envía un put"
  - "envía un delete"
  - "curl"
  - "api request"
  - "rest api"
  - "endpoint"
  - "webhook"
  - "integrar con api"
  - "conectar con api"
  - "obtener datos de api"
  - "enviar datos a api"

preferred_agents: []

steps:
  - step: 1
    action: api_request
    instruction: "Call the API endpoint with the correct HTTP method, headers, and body. Always include Content-Type and Authorization if required by the API."
    params:
      method: "GET | POST | PUT | DELETE | PATCH"
      url: "https://api.example.com/endpoint"
      headers:
        Content-Type: "application/json"
        Authorization: "Bearer TOKEN_IF_NEEDED"
      body: '{"key":"value"}'
    output: api_response

  - step: 2
    action: validate
    instruction: "Check the response status. If 2xx, extract and present the data. If 4xx/5xx, analyze the error and suggest fixes (missing auth, wrong payload, rate limit)."
    output: validated_result

rules:
  - "Always use api_request instead of web_fetch when you need custom headers, body, or non-GET methods"
  - "Never expose API keys or tokens in the final response to the user — mention they are handled securely"
  - "If the API returns JSON, parse and present it in a readable format (tables, lists, markdown)"
  - "For paginated APIs, indicate if more pages exist and offer to fetch them"
  - "Respect rate limits — if a 429 is returned, wait and retry or inform the user"
  - "Always include the Content-Type header when sending a body (usually application/json)"
  - "Use query_params object instead of manually appending to the URL"
  - "If the user provides a curl command, translate it into api_request parameters"

output_format:
  structure: markdown
  sections:
    - "summary"
    - "request_details"
    - "response_data"
    - "next_steps"
  max_length: "800 words unless user requests full raw response"

examples:
  - user_input: "haz un get a https://api.github.com/users/octocat"
    expected_behavior: "api_request({ method: 'GET', url: 'https://api.github.com/users/octocat' }) → parse JSON → show key fields"

  - user_input: "envía un post a https://httpbin.org/post con {nombre: 'Juan'}"
    expected_behavior: "api_request({ method: 'POST', url: 'https://httpbin.org/post', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({nombre:'Juan'}) }) → show response"

  - user_input: "actualiza el recurso 123 en la API con {status: 'active'}"
    expected_behavior: "api_request({ method: 'PUT', url: '.../123', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' }, body: JSON.stringify({status:'active'}) }) → confirm update"

  - user_input: "curl -X DELETE https://api.example.com/items/456 -H 'Authorization: Bearer token123'"
    expected_behavior: "Translate curl to api_request({ method: 'DELETE', url: 'https://api.example.com/items/456', headers: { 'Authorization': 'Bearer token123' } }) → confirm deletion"
---

# API Client Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita interactuar con una API REST: consultar datos, crear recursos, actualizar, eliminar, o cualquier operación HTTP.

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `api_request` | Realiza peticiones HTTP completas (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) con headers, body, query params y timeout | Siempre que necesites llamar un endpoint REST, webhook, o servicio externo |

## Parámetros de api_request

- `method` (requerido): GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- `url` (requerido): URL completa del endpoint
- `headers` (opcional): objeto con headers HTTP. Ej: `{ "Authorization": "Bearer TOKEN", "Content-Type": "application/json" }`
- `body` (opcional): cuerpo de la petición como string. Para JSON, enviar JSON.stringify(objeto)
- `query_params` (opcional): parámetros de query que se codificarán automáticamente en la URL
- `timeout_ms` (opcional): timeout en ms. Default: 30000. Máx: 120000

## Diferencia con web_fetch

- `web_fetch`: solo GET, sin headers custom, ideal para scraping de páginas web
- `api_request`: cualquier método HTTP, headers custom, body, query params — ideal para APIs REST

## Workflow

1. **Identificar endpoint y método** → Determinar URL, método, headers necesarios
2. **Construir request** → `api_request({ method, url, headers, body })`
3. **Validar respuesta** → Si 2xx: extraer datos. Si error: analizar y sugerir fix
4. **Presentar resultados** → JSON parseado en formato legible, no crudo a menos que se pida

## Mejores Prácticas

- Siempre enviar `Content-Type: application/json` cuando el body es JSON
- Usar `query_params` en lugar de append manual a la URL
- No exponer tokens/secrets en la respuesta final al usuario
- Si la API requiere auth, pedirla al usuario o usar variables de entorno
- Para errores 4xx, revisar: auth, formato del body, campos requeridos, rate limits

## Errores a Evitar

- ❌ Usar web_fetch para POST/PUT/DELETE con headers
- ❌ Enviar objetos directamente en body (debe ser string)
- ❌ Olvidar Content-Type al enviar JSON
- ❌ Exponer API keys en la respuesta visible
