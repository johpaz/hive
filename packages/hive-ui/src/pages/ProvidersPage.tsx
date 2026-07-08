import { Plus, Eye, Mic, Server, type LucideProps } from "lucide-react";
import { ProviderList } from "@/modules/providers";
import { NewProviderForm } from "@/modules/providers/NewProviderForm";
import { VisionModelsTab } from "@/modules/providers/tabs/VisionModelsTab";
import { VoiceProvidersTab } from "@/modules/providers/tabs/VoiceProvidersTab";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useProviders } from "@/hooks/useProviders";
import { useState } from "react";
import type React from "react";

const PlusIcon = Plus as React.ComponentType<LucideProps>;
const EyeIcon = Eye as React.ComponentType<LucideProps>;
const MicIcon = Mic as React.ComponentType<LucideProps>;
const ServerIcon = Server as React.ComponentType<LucideProps>;

export function ProvidersPage() {
  const { providers, createProvider } = useProviders();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("providers");

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
          <DialogContent className="max-w-md">
            <DialogHeader className="p-6 border-b border-white/5 bg-white/5 relative overflow-hidden">
              <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-20" />
              <DialogTitle className="text-xl font-black text-white uppercase tracking-tighter">Añadir Provider</DialogTitle>
              <DialogDescription className="text-xs text-white/40 font-medium mt-1">
                Crea un nuevo provider de IA para tu infraestructura.
              </DialogDescription>
            </DialogHeader>
            <div className="p-6">
              <NewProviderForm
                onSave={handleAdd}
                onCancel={() => setOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-10">
          <TabsTrigger value="providers" className="gap-1.5 text-xs">
            <ServerIcon className="h-3.5 w-3.5" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="vision" className="gap-1.5 text-xs">
            <EyeIcon className="h-3.5 w-3.5" />
            Imagen
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-1.5 text-xs">
            <MicIcon className="h-3.5 w-3.5" />
            Voz
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-4">
          <ProviderList />
        </TabsContent>
        <TabsContent value="vision" className="mt-4">
          <VisionModelsTab />
        </TabsContent>
        <TabsContent value="voice" className="mt-4">
          <VoiceProvidersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
