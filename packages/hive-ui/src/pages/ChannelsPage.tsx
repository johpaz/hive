import { useState, useEffect, useMemo } from "react";
import { Plus, RefreshCw, Layers, Zap, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useChannels } from "@/hooks/useChannels";
import { ChannelCard } from "@/modules/channels/shared/ChannelCard";
import { ChannelConfigDialog } from "@/modules/channels/shared/ChannelConfigDialog";
import type { ConnectedChannel } from "@/types";

export function ChannelsPage() {
  const {
    channels,
    activeChannels,
    fetchChannels,
    isLoading,
    toggleChannel,
    updateChannel
  } = useChannels();

  const [activeTab, setActiveTab] = useState("all");
  const [selectedChannel, setSelectedChannel] = useState<ConnectedChannel | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredChannels = useMemo(() => {
    if (activeTab === "all") return channels;
    if (activeTab === "active") return channels.filter(c => c.active);
    if (activeTab === "inactive") return channels.filter(c => !c.active);
    return channels;
  }, [channels, activeTab]);

  const handleEdit = (channel: ConnectedChannel) => {
    setSelectedChannel(channel);
    setIsDialogOpen(true);
  };

  const handleAdd = () => {
    setSelectedChannel(null);
    setIsDialogOpen(true);
  };

  const handleSave = async (id: string, data: Partial<ConnectedChannel>) => {
    if (id === "new") {
      // Logic for adding new channel would go here (API POST)
      console.log("Add new channel", data);
    } else {
      await updateChannel(id, data);
    }
  };

  return (
    <div className="hive-page-container animate-fade-in mt-10">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="hive-page-header">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Layers className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-black text-white uppercase tracking-tighter">Canales</h1>
            </div>
            <p className="hive-subtitle">
              Gestiona tus puntos de entrada y salida de comunicación en la red Hive.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchChannels()}
              disabled={isLoading}
              className="hive-btn hive-btn--ghost px-6 text-[10px]"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              SINCRONIZAR
            </button>
            <button
              onClick={handleAdd}
              className="hive-btn hive-btn--primary px-8 text-[10px]"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              NUEVO CANAL
            </button>
          </div>
        </div>
      </div>

      <div className="hive-card border-blue-500/10 !bg-blue-500/[0.02] mb-8 overflow-hidden relative">
        <div className="hive-card-body py-4 px-6 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] font-black tracking-widest text-blue-500/50 uppercase">Estado Operativo</p>
              <p className="text-xs text-white/60">
                Actualmente tienes <span className="text-blue-400 font-black">{activeChannels.length}</span> canales procesando datos.
              </p>
            </div>
          </div>
          <div className="text-[10px] text-white/20 font-black tracking-widest uppercase">
            HIVE NODE SECURE
          </div>
        </div>
        <div className="hive-glow-blob hive-glow-blob--blue -top-10 -right-10 h-32 w-32 opacity-10" />
      </div>

      <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-2xl w-fit border border-white/5 mb-8">
        {[
          { id: "all", label: `TODOS (${channels.length})` },
          { id: "active", label: "ACTIVOS" },
          { id: "inactive", label: "INACTIVOS" }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-8 py-2.5 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all duration-300 ${activeTab === tab.id
              ? 'bg-blue-500 text-white shadow-blue-glow'
              : 'text-white/20 hover:text-white/40 hover:bg-white/5'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="animate-fade-in">
        {filteredChannels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onEdit={handleEdit}
                onToggle={toggleChannel}
              />
            ))}
          </div>
        ) : (
          <div className="hive-card border-dashed border-white/10 bg-white/[0.02]">
            <div className="hive-card-body flex flex-col items-center justify-center py-20 px-4">
              <div className="h-20 w-20 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
                <Layers className="h-10 w-10 text-white/10" />
              </div>
              <div className="text-center">
                <p className="hive-title-section text-center mb-2">No se detectaron canales</p>
                <p className="text-xs text-white/40 mb-8 max-w-[300px] mx-auto leading-relaxed">
                  Configura tu primer punto de enlace para empezar a recibir datos en tiempo real.
                </p>
                <button
                  onClick={handleAdd}
                  className="hive-btn hive-btn--primary px-10 text-[10px]"
                >
                  ESTABLECER CONEXIÓNHORA
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ChannelConfigDialog
        channel={selectedChannel}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
