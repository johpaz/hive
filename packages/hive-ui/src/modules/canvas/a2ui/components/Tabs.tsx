import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";
import { RenderComponent } from "../A2UIRenderer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function A2UITabs({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  // spec: "tabs" | ours: "tabItems" (alias)
  const tabItems = def.tabs ?? def.tabItems ?? [];
  const defaultTab = tabItems[0]?.title ? resolveDynamicString(tabItems[0].title, ctx.dataModel, ctx.scopeData) : "";

  return (
    <Tabs defaultValue={defaultTab} style={def.weight ? { flex: def.weight } : undefined}>
      <TabsList className="w-full">
        {tabItems.map((tab, i) => (
          <TabsTrigger key={i} value={resolveDynamicString(tab.title, ctx.dataModel, ctx.scopeData)}>
            {resolveDynamicString(tab.title, ctx.dataModel, ctx.scopeData)}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabItems.map((tab, i) => (
        <TabsContent key={i} value={resolveDynamicString(tab.title, ctx.dataModel, ctx.scopeData)}>
          <RenderComponent {...ctx} id={tab.child} />
        </TabsContent>
      ))}
    </Tabs>
  );
}