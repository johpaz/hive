import { Button } from "@/components/ui/button";
import { Plus, type LucideProps } from "lucide-react";
import { ProviderList } from "@/modules/providers";
import { ProviderFailoverConfig } from "@/modules/providers";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";
import { ProviderConfigForm } from "@/modules/providers/ProviderConfigForm";
import { useProviders } from "@/hooks/useProviders";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Provider } from "@/types";
import type React from "react";

// Type assertion to fix React 19 @types/react + lucide-react incompatibility
const PlusIcon = Plus as React.ComponentType<LucideProps>;

export function ProvidersPage() {
  const { providers, updateProvider } = useProviders();
  const [open, setOpen] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Provider | null>(null);

  // Providers that exist but are fully inactive (not yet configured/activated)
  const inactiveProviders = providers.filter((p) => !p.active);

  const handleAdd = (config: Record<string, any>) => {
    if (selectedToAdd) {
      updateProvider(selectedToAdd.id, {
        active: true,
        config: { ...selectedToAdd.config, ...config }
      });
      setOpen(false);
      setSelectedToAdd(null);
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
        <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) setSelectedToAdd(null); }}>
          <DialogTrigger asChild>
            <button className="hive-btn hive-btn--primary" disabled={inactiveProviders.length === 0}>
              <PlusIcon className="mr-1 h-4 w-4" />
              Añadir Provider
            </button>
          </DialogTrigger>
          <DialogContent className="hive-card border-white/10 p-0 overflow-hidden max-w-md bg-[#09090b]">
            <div className="p-6 border-b border-white/5 bg-white/5 relative overflow-hidden">
              <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-20" />
              <DialogTitle className="text-xl font-black text-white uppercase tracking-tighter">Añadir Provider</DialogTitle>
              <DialogDescription className="text-xs text-white/40 font-medium mt-1">
                Selecciona un provider inactivo para configurarlo y activarlo.
              </DialogDescription>
            </div>
            <div className="space-y-4 p-6">
              <Select
                value={selectedToAdd?.id || ""}
                onValueChange={(val) => setSelectedToAdd(inactiveProviders.find(p => p.id === val) || null)}
              >
                <SelectTrigger className="hive-select-trigger">
                  <SelectValue placeholder="Selecciona un provider" />
                </SelectTrigger>
                <SelectContent className="hive-select-content">
                  {inactiveProviders.length === 0 && (
                    <SelectItem value="none" disabled className="hive-select-item">Todos los providers están activos</SelectItem>
                  )}
                  {inactiveProviders.map(p => (
                    <SelectItem key={p.id} value={p.id} className="hive-select-item">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedToAdd && (
                <div className="pt-2 border-t border-white/5 mt-4">
                  <ProviderConfigForm
                  provider={selectedToAdd}
                  onSave={handleAdd}
                  onCancel={() => { setOpen(false); setSelectedToAdd(null); }}
                />
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="available" className="w-full">
        <TabsList className="hive-tabs-list mb-8">
          <TabsTrigger value="available" className="hive-tabs-trigger">
            Proveedores Disponibles
          </TabsTrigger>
          <TabsTrigger value="configured" className="hive-tabs-trigger">
            Configurados
          </TabsTrigger>
        </TabsList>
        <TabsContent value="available">
          <ProviderList />
        </TabsContent>
        <TabsContent value="configured">
          <ProviderFailoverConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}
