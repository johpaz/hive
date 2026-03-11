import { Badge } from "@/components/ui/badge";
import { AgentStatusBadge } from "./AgentStatusBadge";
import type { Agent } from "@/types";
import { Cpu, Shield, Calendar, Fingerprint, Activity, Zap } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useProviders, useModels } from "@/stores/useGlobalConfigStore";

interface AgentInternalCardProps {
    agent: Agent;
}

export function AgentInternalCard({ agent }: AgentInternalCardProps) {
    const { providers } = useProviders();
    const { models } = useModels();

    const isCoordinator = agent.role === 'coordinator';
    const providerId = agent.provider_id || agent.providerId;
    const modelId = agent.model_id || agent.modelId;
    const createdAt = agent.created_at || agent.createdAt;

    const formattedDate = createdAt
        ? format(typeof createdAt === "string" ? new Date(createdAt) : new Date(createdAt * 1000), "PPP", { locale: es })
        : "Fecha desconocida";

    const providerName = providers.find(p => p.id === providerId)?.name || providerId;
    const modelName = models.find(m => m.id === modelId)?.name || modelId;

    return (
        <div
            className={`hive-card--internal group ${agent.enabled ? "hive-card--internal-active" : "hive-card--internal-disabled"
                }`}
        >
            {/* Ambient Glows */}
            {agent.enabled && (
                <>
                    <div className="absolute -top-24 -right-24 h-64 w-64 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none group-hover:bg-blue-600/20 transition-all duration-700" />
                    <div className="absolute -bottom-24 -left-24 h-64 w-64 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none group-hover:bg-purple-600/20 transition-all duration-700" />
                </>
            )}

            <div className="relative flex flex-col md:flex-row gap-8 items-start justify-between">
                <div className="flex-1 space-y-6">
                    <div className="flex flex-col gap-4">
                        {/* Icon + Title */}
                        <div className="flex items-center gap-3">
                            <div className={`hive-icon-wrap--internal ${agent.enabled ? "hive-icon-wrap--internal-active" : "hive-icon-wrap--internal-disabled"}`}>
                                <Fingerprint className={`h-6 w-6 ${agent.enabled ? "text-blue-400" : "text-white/20"}`} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`hive-page-header__label ${!agent.enabled && "text-white/20"}`}>
                                        Identidad de Nodo
                                    </span>
                                    {isCoordinator && (
                                        <Badge className={`hive-tag--coordinator ${!agent.enabled && "bg-white/5 text-white/20 border-white/10"}`}>
                                            Coordinador
                                        </Badge>
                                    )}
                                </div>
                                <h1 className={`text-4xl font-black tracking-tighter ${agent.enabled ? "text-white" : "text-white/40"}`}>
                                    {agent.name}
                                </h1>
                            </div>
                        </div>
                        <p className={`text-lg leading-relaxed max-w-2xl font-light italic ${agent.enabled ? "text-white/60" : "text-white/20"}`}>
                            "{agent.description || "Este agente no tiene una descripción definida aún."}"
                        </p>
                    </div>

                    {/* Info Cards Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <InfoCard
                            icon={Cpu}
                            label="Infraestructura"
                            value={providerName}
                            subValue={modelName}
                            color={agent.enabled ? "text-blue-400" : "text-white/20"}
                            enabled={agent.enabled}
                        />
                        <InfoCard
                            icon={Zap}
                            label="Personalidad"
                            value={agent.tone || "Neutral"}
                            color={agent.enabled ? "text-purple-400" : "text-white/20"}
                            enabled={agent.enabled}
                        />
                        <InfoCard
                            icon={Calendar}
                            label="Desplegado el"
                            value={formattedDate}
                            color={agent.enabled ? "text-emerald-400" : "text-white/20"}
                            enabled={agent.enabled}
                        />
                    </div>
                </div>

                {/* Right: Status + Network load */}
                <div className="flex flex-col items-center md:items-end gap-6 min-w-[200px]">
                    <div className="text-center md:text-right space-y-2">
                        <span className="hive-label block">Estado Operativo</span>
                        <AgentStatusBadge
                            status={agent.enabled ? agent.status : "hibernated"}
                            className="px-6 py-2 text-sm border-2"
                        />
                    </div>

                    <div className="hive-network-panel md:w-auto">
                        <div className="flex-1">
                            <p className="hive-label mb-1">Carga de Red</p>
                            <div className="hive-network-track">
                                {agent.enabled && <div className="hive-network-fill" />}
                            </div>
                        </div>
                        <Activity className={`h-5 w-5 ${agent.enabled ? "text-blue-400 animate-pulse" : "text-white/10"}`} />
                    </div>
                </div>
            </div>

            {/* Decorative Strip */}
            <div className={`hive-strip--bottom ${!agent.enabled && "opacity-20"}`} />
            <div className="absolute top-4 right-8 hive-mono hidden md:block">
                NODE_UID: {agent.id}
            </div>
        </div>
    );
}

function InfoCard({
    icon: IconComponent,
    label,
    value,
    subValue,
    color,
    enabled,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    subValue?: string;
    color: string;
    enabled: boolean;
}) {
    return (
        <div className={`hive-info-card ${enabled ? "hive-info-card--active" : "hive-info-card--disabled"}`}>
            <div className="flex items-center gap-2 mb-2">
                <IconComponent className={`h-3.5 w-3.5 ${color}`} />
                <span className="hive-info-card__label">{label}</span>
            </div>
            <div className="space-y-0.5">
                <p className={`hive-info-card__value ${enabled ? "text-white/80 group-hover/item:text-white" : "text-white/20"}`}>
                    {value}
                </p>
                {subValue && (
                    <p className={`hive-info-card__sub ${enabled ? "text-white/40" : "text-white/10"}`}>
                        {subValue}
                    </p>
                )}
            </div>
        </div>
    );
}
