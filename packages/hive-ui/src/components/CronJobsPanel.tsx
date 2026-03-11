import React, { useEffect } from 'react';
import { useNotesAndCronsStore } from '../stores/useNotesAndCronsStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Clock, Loader2, Calendar, Activity, MessageCircle, Send } from 'lucide-react';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// ── Channel icon helper ────────────────────────────────────────────────────────
function ChannelBadge({ channelId }: { channelId?: string | null }) {
    if (!channelId || channelId === 'webchat') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <MessageCircle className="w-2.5 h-2.5" />
                Web
            </span>
        );
    }
    if (channelId === 'telegram') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Send className="w-2.5 h-2.5" />
                Telegram
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-white/10">
            {channelId}
        </span>
    );
}

// ── Expiry label ───────────────────────────────────────────────────────────────
function ExpiryLabel({ expiresAt }: { expiresAt?: number | null }) {
    if (!expiresAt) return null;
    const date = new Date(expiresAt * 1000);
    const now = Date.now();
    const diffDays = Math.ceil((date.getTime() - now) / 86400000);
    const label = diffDays <= 0
        ? 'Expirado'
        : diffDays === 1
        ? 'Expira mañana'
        : `Expira en ${diffDays}d`;
    const urgent = diffDays <= 3;
    return (
        <span className={`text-[9px] font-mono ${urgent ? 'text-amber-400' : 'text-muted-foreground'}`}>
            {label}
        </span>
    );
}

// ── Max runs label ─────────────────────────────────────────────────────────────
function MaxRunsLabel({ maxRuns }: { maxRuns?: number | null }) {
    if (!maxRuns) return null;
    return (
        <span className="text-[9px] font-mono text-muted-foreground">
            {maxRuns} {maxRuns === 1 ? 'vez' : 'veces'}
        </span>
    );
}

// ── Channel option label ───────────────────────────────────────────────────────
function channelLabel(id: string, recommended: string) {
    const base = id === 'telegram' ? 'Telegram' : id === 'webchat' ? 'Web Chat' : id;
    return id === recommended ? `${base} (recomendado)` : base;
}

// ── Main component ─────────────────────────────────────────────────────────────
export const CronJobsPanel: React.FC = () => {
    const {
        cronJobs,
        cronChannels,
        cronRecommended,
        cronUserPreference,
        isLoading,
        fetchCronJobs,
        fetchCronChannels,
        toggleCronJobActive,
        saveCronChannelPreference,
    } = useNotesAndCronsStore();

    useEffect(() => {
        fetchCronJobs();
        fetchCronChannels();
    }, [fetchCronJobs, fetchCronChannels]);

    const activeJobs = (cronJobs ?? []).filter(j => Number(j.enabled) === 1);
    const activeChannels = (cronChannels ?? []).filter(c => c.active);

    console.log("[CronPanel] cronJobs:", cronJobs);
    console.log("[CronPanel] activeJobs:", activeJobs);
    console.log("[CronPanel] cronChannels:", cronChannels);
    console.log("[CronPanel] activeChannels:", activeChannels);

    return (
        <Card className="border-none bg-background/50 backdrop-blur-xl shadow-2xl overflow-hidden group border border-white/10">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <Clock className="w-5 h-5" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold tracking-tight">Cron Jobs</CardTitle>
                            <CardDescription>Tareas programadas activas</CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                        {/* Global channel preference picker */}
                        {activeChannels.length > 1 && (
                            <Select
                                value={cronUserPreference}
                                onValueChange={saveCronChannelPreference}
                            >
                                <SelectTrigger className="h-7 text-[10px] w-[130px] border-white/10 bg-card/40">
                                    <SelectValue placeholder="Canal" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto" className="text-xs">
                                        Auto (recomendado)
                                    </SelectItem>
                                    {activeChannels.map(ch => (
                                        <SelectItem key={ch.id} value={ch.id} className="text-xs">
                                            {channelLabel(ch.id, cronRecommended)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[350px] pr-4">
                    <div className="space-y-4">
                        {activeJobs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground space-y-2">
                                <Clock className="w-12 h-12 opacity-20" />
                                <p className="text-sm">No hay tareas activas</p>
                                <p className="text-[10px] opacity-70">Define nuevas tareas cron desde el bot</p>
                            </div>
                        ) : (
                            activeJobs.map((job) => {
                                console.log("[CronPanel] Rendering job:", job);
                                return (
                                <div
                                    key={job.id}
                                    className="p-4 rounded-2xl border border-white/5 bg-card/40 hover:bg-card/60 transition-all duration-300 group/item relative overflow-hidden"
                                >
                                    {/* Stop toggle */}
                                    <div className="absolute top-0 right-0 p-3 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Detener</span>
                                            <Switch
                                                checked={true}
                                                onCheckedChange={() => toggleCronJobActive(job.id, false)}
                                                className="scale-75 data-[state=checked]:bg-primary"
                                            />
                                        </div>
                                    </div>

                                    <h4 className="font-semibold text-sm mb-1.5 pr-16 truncate">{job.name}</h4>

                                    {/* Schedule expression */}
                                    <div className="flex items-center gap-1.5 text-[10px] text-primary font-bold uppercase tracking-wider mb-2 bg-primary/5 w-fit px-2 py-0.5 rounded-full">
                                        <Calendar className="w-3 h-3" />
                                        {job.cron_expression}
                                    </div>

                                    {/* Meta row: channel + limits */}
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <ChannelBadge channelId={job.notify_channel_id} />
                                        <MaxRunsLabel maxRuns={job.max_runs} />
                                        <ExpiryLabel expiresAt={job.expires_at} />
                                    </div>

                                    {/* Footer: status + last run */}
                                    <div className="mt-2 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
                                            <Activity className="w-3 h-3" />
                                            <span className="text-[10px] uppercase tracking-tighter">Running</span>
                                        </div>
                                        {job.last_run && (
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                {new Date(job.last_run * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};
