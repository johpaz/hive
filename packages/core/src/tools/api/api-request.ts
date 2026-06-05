/**
 * api_request - Make HTTP requests to REST APIs (curl-like)
 *
 * Supports: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
 * Features: custom headers, JSON/form body, query params, timeout
 *
 * @category api
 * @seedId api_request
 * @spanish llamar api, petición http, curl, post a api, put api, delete api
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("api-request");

const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

export const apiRequestTool: Tool = {
  name: "api_request",
  description:
    "Make an HTTP request to a REST API endpoint. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS with custom headers, body, and query parameters. " +
    "Spanish: llamar api, petición http, curl, post a api, put api, delete api, consumir servicio rest",
  parameters: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description: "HTTP method: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
        enum: ALLOWED_METHODS,
      },
      url: {
        type: "string",
        description: "Full URL of the API endpoint (including query string, or use query_params)",
      },
      headers: {
        type: "object",
        description: "Optional HTTP headers as key-value pairs. Example: {\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer token\"}",
        additionalProperties: { type: "string" },
      },
      body: {
        type: "string",
        description: "Optional request body as a string. For JSON APIs, pass a JSON string. For form data, pass URL-encoded string.",
      },
      query_params: {
        type: "object",
        description: "Optional query parameters as key-value pairs. Will be URL-encoded and appended to the URL.",
        additionalProperties: { type: "string" },
      },
      timeout_ms: {
        type: "number",
        description: "Request timeout in milliseconds. Default: 30000 (30s). Max: 120000 (2 min).",
        minimum: 1000,
        maximum: 120000,
      },
    },
    required: ["method", "url"],
  },
  execute: async (params: Record<string, unknown>) => {
    const method = (params.method as string)?.toUpperCase().trim() || "GET";
    let url = params.url as string;
    const headers = (params.headers as Record<string, string>) || {};
    const body = params.body as string | undefined;
    const queryParams = (params.query_params as Record<string, string>) || {};
    const timeoutMs = (params.timeout_ms as number) || 30000;

    if (!ALLOWED_METHODS.includes(method)) {
      return {
        ok: false,
        error: `Invalid HTTP method: ${method}. Allowed: ${ALLOWED_METHODS.join(", ")}`,
      };
    }

    if (!url || typeof url !== "string") {
      return {
        ok: false,
        error: "Missing required parameter: url",
      };
    }

    // Append query params to URL
    if (Object.keys(queryParams).length > 0) {
      const urlObj = new URL(url);
      for (const [key, value] of Object.entries(queryParams)) {
        urlObj.searchParams.append(key, value);
      }
      url = urlObj.toString();
    }

    log.info(`[api_request] ${method} ${url}`);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        "User-Agent": "HiveAgent/1.0",
        ...headers,
      },
      // @ts-ignore — Bun supports timeout
      timeout: timeoutMs,
    };

    if (body !== undefined && body !== null && body !== "") {
      // Auto-set Content-Type to application/json if body looks like JSON
      if (
        !headers["Content-Type"] &&
        !headers["content-type"] &&
        typeof body === "string" &&
        (body.trim().startsWith("{") || body.trim().startsWith("["))
      ) {
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
      fetchOptions.body = body;
    }

    try {
      const response = await fetch(url, fetchOptions);

      // For HEAD requests, don't read body
      if (method === "HEAD") {
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          url: response.url,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let responseBody: string | object;
      const rawText = await response.text();

      if (contentType.includes("application/json")) {
        try {
          responseBody = JSON.parse(rawText);
        } catch {
          responseBody = rawText;
        }
      } else {
        responseBody = rawText;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      log.info(`[api_request] ${method} ${url} → ${response.status} ${response.statusText}`);

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        contentType,
        url: response.url,
      };
    } catch (error) {
      const msg = (error as Error).message;
      log.error(`[api_request] ${method} ${url} failed: ${msg}`);
      return {
        ok: false,
        error: `HTTP request failed: ${msg}`,
        url,
        method,
      };
    }
  },
};
