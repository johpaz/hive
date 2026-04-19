import { useState } from "react";
import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { RenderComponent } from "../A2UIRenderer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function A2UIModal({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(def.trigger ?? def.entryPointChild) && (
        <DialogTrigger asChild>
          <div className="cursor-pointer">
            <RenderComponent {...ctx} id={def.trigger ?? def.entryPointChild} />
          </div>
        </DialogTrigger>
      )}
      <DialogContent>
        {(def.content ?? def.contentChild) && (
          <RenderComponent {...ctx} id={def.content ?? def.contentChild} />
        )}
      </DialogContent>
    </Dialog>
  );
}