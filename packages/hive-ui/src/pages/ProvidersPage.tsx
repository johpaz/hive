import { Plus, type LucideProps } from "lucide-react";
import { ProviderList } from "@/modules/providers";
import { NewProviderForm } from "@/modules/providers/NewProviderForm";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useProviders } from "@/hooks/useProviders";
import { useState } from "react";
import type React from "react";

// Type assertion to fix React 19 @types/react + lucide-react incompatibility
const PlusIcon = Plus as React.ComponentType<LucideProps>;

export function ProvidersPage() {
  const { providers, createProvider } = useProviders();
  const [open, setOpen] = useState(false);

  const handleAdd = async (data: {
    id: string;
    name: string;
    type: string;
    apiKey: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    numCtx?: number | null;
  }) => {
    try {
      await createProvider({
        id: data.id,
        name: data.name,
        base_url: data.baseUrl,
        api_key: data.apiKey,
        headers: data.headers,
        num_ctx: data.numCtx,
      });
      setOpen(false);
    } catch (error) {
      console.error("Error creating provider:", error);
      // Error is already handled by apiClient with swal
    }
  };

  return (
    <div className="space-y-4 mt-6 sm:mt-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="hive-page-header__dot" />
            <span className="hive-page-header__label">INFRAESTRUCTURA</span>
          </div>
          <h2 className="hive-title-page">Providers de IA<span className="hive-title-page__accent">.</span></h2>
        </div>
        <Dialog open={open} onOpenChange={(val) => { setOpen(val); }}>
          <DialogTrigger asChild>
            <button className="hive-btn hive-btn--primary">
              <PlusIcon className="mr-1 h-4 w-4" />
              Añadir Provider
            </button>
          </DialogTrigger>
          <DialogContent className="hive-card border-white/10 p-0 overflow-hidden max-w-md bg-[#09090b]">
            <div className="p-6 border-b border-white/5 bg-white/5 relative overflow-hidden">
              <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-20" />
              <DialogTitle className="text-xl font-black text-white uppercase tracking-tighter">Añadir Provider</DialogTitle>
              <DialogDescription className="text-xs text-white/40 font-medium mt-1">
                Crea un nuevo provider de IA para tu infraestructura.
              </DialogDescription>
            </div>
            <div className="p-6">
              <NewProviderForm
                onSave={handleAdd}
                onCancel={() => setOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ProviderList />
    </div>
  );
}
