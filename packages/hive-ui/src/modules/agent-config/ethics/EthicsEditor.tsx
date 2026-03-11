import { ShieldAlert } from "lucide-react";
import { ConfigEditorLayout } from "../shared/ConfigEditorLayout";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useState } from "react";

interface EthicsEditorProps {
  agentId: string;
}

export function EthicsEditor({ agentId }: EthicsEditorProps) {
  const [content, setContent] = useState("");

  return (
    <ConfigEditorLayout title="ETHICS.md — Límites éticos" icon={<ShieldAlert className="h-4 w-4 text-destructive" />}>
      <MarkdownEditor value={content} onChange={setContent} placeholder="Define los límites éticos del agente..." />
      <p className="mt-2 text-xs text-muted-foreground">Agent: {agentId}</p>
    </ConfigEditorLayout>
  );
}
