import React from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Edit2, Settings, MessageSquare, Mic, Volume2 } from "lucide-react";
import type { ConnectedChannel } from "@/types";

interface ChannelCardProps {
    channel: ConnectedChannel;
    onEdit: (channel: ConnectedChannel) => void;
    onToggle: (id: string, active: boolean) => void;
}

export function ChannelCard({ channel, onEdit, onToggle }: ChannelCardProps) {
    const isConnected = channel.status === "connected";
    const isUnconfigured = channel.isConfigured === false;

    return (
        <div
            onClick={() => onEdit(channel)}
            className={`hive-card group transition-all duration-500 cursor-pointer ${isConnected
                    ? 'hive-card--active border-emerald-500/20'
                    : isUnconfigured
                        ? 'opacity-50 border-dashed hover:opacity-80 hover:border-blue-500/30'
                        : 'opacity-60 grayscale-[0.8] hover:opacity-100 hover:grayscale-0'
                }`}
        >
            <div className="hive-card-body relative overflow-hidden">
                <div className="flex items-start justify-between mb-8">
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-500 ${isConnected
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                            : isUnconfigured
                                ? 'bg-blue-500/5 border-blue-500/20 text-blue-400/40'
                                : 'bg-white/5 border-white/10 text-white/30'
                        }`}>
                        <MessageSquare className="h-6 w-6" />
                    </div>

                    <div className="flex items-center gap-2">
                        {isConnected && (
                            <span className="text-[9px] font-black tracking-widest text-emerald-500 shadow-emerald-glow">
                                CONECTADO
                            </span>
                        )}
                        {isUnconfigured ? (
                            <span className="text-[9px] font-black tracking-widest text-blue-400/60 uppercase">
                                DISPONIBLE
                            </span>
                        ) : (
                            <Switch
                                checked={channel.active}
                                onCheckedChange={(checked) => onToggle(channel.id, checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="data-[state=checked]:bg-emerald-500 scale-75 origin-right"
                            />
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter mb-1 line-clamp-1 group-hover:text-emerald-400 transition-colors">
                            {channel.type}
                        </h3>
                        <p className="text-[10px] text-white/20 font-black tracking-[0.2em] mb-4">
                            {isUnconfigured ? "CLICK PARA CONFIGURAR" : `ID: ${channel.id.substring(0, 12).toUpperCase()}`}
                        </p>
                    </div>

                    <div className="pt-4 border-t border-white/5 flex items-center gap-6">
                        <div className="hive-stat">
                            <span className="hive-stat__label">VOZ</span>
                            <span className={`hive-stat__value ${channel.voice_enabled ? 'text-emerald-500' : 'text-white/20'}`}>
                                {channel.voice_enabled ? "ON" : "OFF"}
                            </span>
                        </div>
                        <div className="hive-stat">
                            <span className="hive-stat__label">SÍNTESIS</span>
                            <span className={`hive-stat__value ${channel.tts_enabled ? 'text-emerald-500' : 'text-white/20'}`}>
                                {channel.tts_enabled ? "ON" : "OFF"}
                            </span>
                        </div>
                    </div>
                </div>

                {isConnected && (
                    <div className="hive-glow-blob hive-glow-blob--emerald -bottom-10 -right-10 h-24 w-24 opacity-20" />
                )}
            </div>

            <div className={`hive-strip--bottom ${isConnected ? 'bg-emerald-500' : isUnconfigured ? 'bg-blue-500/30' : 'bg-white/10'}`} />
        </div>
    );
}
