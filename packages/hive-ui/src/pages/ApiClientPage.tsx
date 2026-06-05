import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Plus,
  Trash2,
  Globe,
  Clock,
  History,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface HistoryItem {
  id: string;
  method: string;
  url: string;
  timestamp: number;
  status?: number;
  ok?: boolean;
}

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function createEmptyPair(): KeyValuePair {
  return { id: generateId(), key: "", value: "", enabled: true };
}

export function ApiClientPage() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<KeyValuePair[]>([createEmptyPair()]);
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([createEmptyPair()]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [responseTab, setResponseTab] = useState("body");

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hive-api-client-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const saveHistory = useCallback((items: HistoryItem[]) => {
    localStorage.setItem("hive-api-client-history", JSON.stringify(items.slice(0, 50)));
  }, []);

  const updatePair = (
    list: KeyValuePair[],
    setList: React.Dispatch<React.SetStateAction<KeyValuePair[]>>,
    id: string,
    field: "key" | "value" | "enabled",
    value: string | boolean
  ) => {
    setList(
      list.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, [field]: value };
        return updated;
      })
    );
  };

  const addPair = (list: KeyValuePair[], setList: React.Dispatch<React.SetStateAction<KeyValuePair[]>>) => {
    setList([...list, createEmptyPair()]);
  };

  const removePair = (
    list: KeyValuePair[],
    setList: React.Dispatch<React.SetStateAction<KeyValuePair[]>>,
    id: string
  ) => {
    if (list.length === 1) {
      setList([createEmptyPair()]);
    } else {
      setList(list.filter((p) => p.id !== id));
    }
  };

  const buildHeadersObject = (): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const h of headers) {
      if (h.enabled && h.key.trim()) obj[h.key.trim()] = h.value;
    }
    return obj;
  };

  const buildQueryParamsObject = (): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const q of queryParams) {
      if (q.enabled && q.key.trim()) obj[q.key.trim()] = q.value;
    }
    return obj;
  };

  const handleSend = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResponse(null);
    const t0 = performance.now();

    try {
      const payload: any = {
        method,
        url: url.trim(),
        headers: buildHeadersObject(),
        query_params: buildQueryParamsObject(),
      };
      if (body.trim() && method !== "GET" && method !== "HEAD") {
        payload.body = body.trim();
      }

      const result = await apiClient<any>("/api/http-request", {
        method: "POST",
        body: payload,
        showError: false,
      });

      setDuration(Math.round(performance.now() - t0));
      setResponse(result);

      const newItem: HistoryItem = {
        id: generateId(),
        method,
        url: url.trim(),
        timestamp: Date.now(),
        status: result.status,
        ok: result.ok,
      };
      const updated = [newItem, ...history];
      setHistory(updated);
      saveHistory(updated);
    } catch (error: any) {
      setDuration(Math.round(performance.now() - t0));
      setResponse({
        ok: false,
        error: error.message || "Request failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setMethod(item.method);
    setUrl(item.url);
    setResponse(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatBody = (body: any): string => {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return body;
      }
    }
    return JSON.stringify(body, null, 2);
  };

  const getStatusColor = (status?: number) => {
    if (!status) return "bg-gray-500";
    if (status >= 200 && status < 300) return "bg-green-500";
    if (status >= 300 && status < 400) return "bg-yellow-500";
    if (status >= 400 && status < 500) return "bg-orange-500";
    return "bg-red-500";
  };

  const renderPairs = (
    list: KeyValuePair[],
    setList: React.Dispatch<React.SetStateAction<KeyValuePair[]>>,
    placeholderKey: string,
    placeholderValue: string
  ) => (
    <div className="space-y-2">
      {list.map((pair) => (
        <div key={pair.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => updatePair(list, setList, pair.id, "enabled", e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-background"
          />
          <Input
            placeholder={placeholderKey}
            value={pair.key}
            onChange={(e) => updatePair(list, setList, pair.id, "key", e.target.value)}
            className="h-8 text-xs bg-background/50"
          />
          <Input
            placeholder={placeholderValue}
            value={pair.value}
            onChange={(e) => updatePair(list, setList, pair.id, "value", e.target.value)}
            className="h-8 text-xs bg-background/50"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-400"
            onClick={() => removePair(list, setList, pair.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground hover:text-primary"
        onClick={() => addPair(list, setList)}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Agregar
      </Button>
    </div>
  );

  return (
    <div className="hive-page-container animate-fade-in mt-10">
      {/* Header */}
      <div className="hive-page-header mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-tighter">API Client</h1>
            <p className="hive-subtitle">Cliente HTTP para probar endpoints REST directamente desde Hive.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main Content */}
        <div className="space-y-4">
          {/* Request Bar */}
          <Card className="border-white/10 bg-card/50">
            <CardContent className="p-4">
              <div className="flex gap-2">
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-[110px] h-10 text-xs font-bold tracking-wider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs font-bold">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="https://api.example.com/endpoint"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  className="h-10 text-sm bg-background/50 font-mono"
                />
                <Button
                  onClick={handleSend}
                  disabled={loading || !url.trim()}
                  className="h-10 px-6 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs tracking-wider"
                >
                  {loading ? (
                    <Clock className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  ENVIAR
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Request Config */}
          <Card className="border-white/10 bg-card/50">
            <CardContent className="p-4">
              <Tabs defaultValue="headers" className="w-full">
                <TabsList className="bg-background/50 h-8">
                  <TabsTrigger value="headers" className="text-xs h-7">
                    Headers ({headers.filter((h) => h.enabled && h.key.trim()).length})
                  </TabsTrigger>
                  <TabsTrigger value="query" className="text-xs h-7">
                    Query Params ({queryParams.filter((q) => q.enabled && q.key.trim()).length})
                  </TabsTrigger>
                  <TabsTrigger value="body" className="text-xs h-7">
                    Body
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="headers" className="mt-3">
                  {renderPairs(headers, setHeaders, "Header", "Value")}
                </TabsContent>
                <TabsContent value="query" className="mt-3">
                  {renderPairs(queryParams, setQueryParams, "Key", "Value")}
                </TabsContent>
                <TabsContent value="body" className="mt-3">
                  <Textarea
                    placeholder={`{\n  "key": "value"\n}`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="min-h-[140px] font-mono text-xs bg-background/50"
                  />
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Se enviará como string crudo. Para JSON, asegurate de que sea válido.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Response */}
          {response && (
            <Card className={cn("border-white/10", response.ok ? "bg-green-500/[0.02]" : "bg-red-500/[0.02]")}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-sm font-bold tracking-wider">RESPUESTA</CardTitle>
                    {response.status !== undefined && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-bold border-none",
                          getStatusColor(response.status),
                          "text-white"
                        )}
                      >
                        {response.status} {response.statusText || ""}
                      </Badge>
                    )}
                    {response.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {duration}ms
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyToClipboard(JSON.stringify(response, null, 2))}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copiar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Tabs value={responseTab} onValueChange={setResponseTab}>
                  <TabsList className="bg-background/50 h-8">
                    <TabsTrigger value="body" className="text-xs h-7">Body</TabsTrigger>
                    <TabsTrigger value="headers" className="text-xs h-7">Headers</TabsTrigger>
                    <TabsTrigger value="raw" className="text-xs h-7">Raw</TabsTrigger>
                  </TabsList>
                  <TabsContent value="body" className="mt-3">
                    <ScrollArea className="h-[300px] w-full rounded-md border bg-black/40 p-3">
                      <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap">
                        {formatBody(response.body ?? response)}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="headers" className="mt-3">
                    <ScrollArea className="h-[300px] w-full rounded-md border bg-black/40 p-3">
                      {response.headers ? (
                        <div className="space-y-1">
                          {Object.entries(response.headers).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs font-mono">
                              <span className="text-purple-400 shrink-0">{k}:</span>
                              <span className="text-white/70">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No headers disponibles</p>
                      )}
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="raw" className="mt-3">
                    <ScrollArea className="h-[300px] w-full rounded-md border bg-black/40 p-3">
                      <pre className="font-mono text-xs text-white/60 whitespace-pre-wrap">
                        {JSON.stringify(response, null, 2)}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: History */}
        <div>
          <Card className="border-white/10 bg-card/50">
            <CardHeader className="pb-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center justify-between w-full"
              >
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-xs font-bold tracking-wider">HISTORIAL</CardTitle>
                </div>
                {showHistory ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {showHistory && (
              <CardContent className="pt-0">
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No hay requests en el historial
                  </p>
                ) : (
                  <ScrollArea className="h-[calc(100vh-300px)]">
                    <div className="space-y-1">
                      {history.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => loadFromHistory(item)}
                          className="w-full text-left p-2 rounded-lg hover:bg-white/5 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                item.ok ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                              )}
                            >
                              {item.method}
                            </span>
                            {item.status && (
                              <span className="text-[10px] text-muted-foreground">
                                {item.status}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-white/50 truncate mt-1 font-mono">
                            {item.url}
                          </p>
                          <p className="text-[9px] text-white/30 mt-0.5">
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2 text-[10px] text-muted-foreground hover:text-red-400"
                    onClick={() => {
                      setHistory([]);
                      localStorage.removeItem("hive-api-client-history");
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Limpiar historial
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
