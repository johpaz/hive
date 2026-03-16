import React, { useEffect, useState } from 'react';
import { useNotesAndCronsStore } from '../stores/useNotesAndCronsStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import {
    Clock,
    Loader2,
    Calendar,
    Activity,
    MessageCircle,
    Send,
    Pause,
    Play,
    Zap,
    Trash2,
    History,
    ChevronDown,
    ChevronUp,
    AlertCircle,
    RefreshCw,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { ScheduledTask, TaskRun, TaskStatus, TaskType } from '../types/notes-crons';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString([], {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function StatusBadge({ status }: { status: TaskStatus }) {
    const cfg: Record<TaskStatus, { label: string; className: string }> = {
        active:    { label: 'Activa',     className: 'bg-green-500/10  text-green-400  border-green-500/20'  },
        paused:    { label: 'Pausada',    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
        completed: { label: 'Completada', className: 'bg-blue-500/10   text-blue-400   border-blue-500/20'   },
        failed:    { label: 'Fallida',    className: 'bg-red-500/10    text-red-400    border-red-500/20'     },
        cancelled: { label: 'Cancelada',  className: 'bg-muted/30      text-muted-foreground border-white/10' },
    };
    const { label, className } = cfg[status] ?? cfg.cancelled;
    return (
        <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${className}`}>
            {label}
        </span>
    );
}

function TypeBadge({ type }: { type: TaskType }) {
    const isRecurring = type === 'recurring';
    return (
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
            isRecurring
                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                : 'bg-teal-500/10 text-teal-400 border-teal-500/20'
        }`}>
            {isRecurring ? <RefreshCw className="w-2.5 h-2.5" /> : <Calendar className="w-2.5 h-2.5" />}
            {isRecurring ? 'Recurrente' : 'Una vez'}
        </span>
    );
}

function ChannelBadge({ channel }: { channel: string }) {
    if (!channel || channel === 'system') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-white/10">
                System
            </span>
        );
    }
    if (channel === 'webchat') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <MessageCircle className="w-2.5 h-2.5" />
                Web
            </span>
        );
    }
    if (channel === 'telegram') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Send className="w-2.5 h-2.5" />
                Telegram
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-white/10">
            {channel}
        </span>
    );
}

function RunStatusDot({ status }: { status: TaskRun['status'] }) {
    const cls: Record<string, string> = {
        running: 'bg-blue-400 animate-pulse',
        success: 'bg-green-400',
        failed:  'bg-red-400',
        timeout: 'bg-amber-400',
    };
    return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls[status] ?? 'bg-muted-foreground'}`} />;
}

function channelLabel(id: string, recommended: string) {
    const base = id === 'telegram' ? 'Telegram' : id === 'webchat' ? 'Web Chat' : id;
    return id === recommended ? `${base} (recomendado)` : base;
}

// ── History sub-panel ──────────────────────────────────────────────────────────

function TaskHistoryPanel({ taskId, history }: { taskId: string; history: TaskRun[] | undefined }) {
    if (!history) return <p className="text-[10px] text-muted-foreground px-1">Cargando historial…</p>;
    if (history.length === 0) return <p className="text-[10px] text-muted-foreground px-1">Sin ejecuciones registradas.</p>;

    return (
        <div className="mt-2 space-y-1">
            {history.map((run) => (
                <div key={run.id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <RunStatusDot status={run.status} />
                    <span className="font-mono">{formatDate(run.started_at)}</span>
                    {run.duration_ms != null && (
                        <span className="text-primary/70">{run.duration_ms}ms</span>
                    )}
                    {run.error_message && (
                        <span className="text-red-400 truncate max-w-[160px]">{run.error_message}</span>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Task card ──────────────────────────────────────────────────────────────────

interface TaskCardProps {
    task: ScheduledTask;
    onPause: (id: string) => void;
    onResume: (id: string) => void;
    onDelete: (id: string) => void;
    onTrigger: (id: string) => void;
    onLoadHistory: (id: string) => void;
    history: TaskRun[] | undefined;
}

function TaskCard({ task, onPause, onResume, onDelete, onTrigger, onLoadHistory, history }: TaskCardProps) {
    const [showHistory, setShowHistory] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const isActive = task.status === 'active';
    const canControl = task.status === 'active' || task.status === 'paused';

    function handleHistoryToggle() {
        if (!showHistory && !history) {
            onLoadHistory(task.id);
        }
        setShowHistory((v) => !v);
    }

    function handleDeleteClick() {
        if (confirmDelete) {
            onDelete(task.id);
        } else {
            setConfirmDelete(true);
            setTimeout(() => setConfirmDelete(false), 3000);
        }
    }

    return (
        <div className="p-4 rounded-2xl border border-white/5 bg-card/40 hover:bg-card/60 transition-all duration-200">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-sm truncate">{task.name}</h4>
                    {task.description && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{task.description}</p>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge status={task.status} />
                </div>
            </div>

            {/* Type + schedule expression */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <TypeBadge type={task.task_type} />
                <div className="flex items-center gap-1 text-[10px] text-primary font-bold uppercase tracking-wider bg-primary/5 px-2 py-0.5 rounded-full">
                    <Calendar className="w-3 h-3" />
                    {task.task_type === 'recurring'
                        ? (task.cron_expression ?? '—')
                        : (task.fire_at ? formatDate(task.fire_at) : '—')}
                </div>
                <ChannelBadge channel={task.channel} />
            </div>

            {/* Run stats */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    {task.run_count} runs
                </span>
                {task.error_count > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                        <AlertCircle className="w-3 h-3" />
                        {task.error_count} errores
                    </span>
                )}
                {task.timezone && task.timezone !== 'UTC' && (
                    <span className="font-mono">{task.timezone}</span>
                )}
            </div>

            {/* Timestamps */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-3">
                {task.last_run_at && (
                    <span>Último: {formatDate(task.last_run_at)}</span>
                )}
                {task.next_run_at && task.status === 'active' && (
                    <span className="text-primary/70">Próximo: {formatDate(task.next_run_at)}</span>
                )}
            </div>

            {/* Last error */}
            {task.last_error && (
                <div className="mb-2 text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2 py-1 truncate">
                    {task.last_error}
                </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {canControl && (
                    isActive ? (
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 border-white/10 hover:bg-yellow-500/10 hover:text-yellow-400 hover:border-yellow-500/20"
                            onClick={() => onPause(task.id)}
                        >
                            <Pause className="w-3 h-3 mr-1" />
                            Pausar
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 border-white/10 hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/20"
                            onClick={() => onResume(task.id)}
                        >
                            <Play className="w-3 h-3 mr-1" />
                            Reanudar
                        </Button>
                    )
                )}

                {isActive && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/20"
                        onClick={() => onTrigger(task.id)}
                        title="Ejecutar ahora (sin afectar el schedule)"
                    >
                        <Zap className="w-3 h-3 mr-1" />
                        Ejecutar
                    </Button>
                )}

                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                    onClick={handleHistoryToggle}
                >
                    <History className="w-3 h-3 mr-1" />
                    Historial
                    {showHistory
                        ? <ChevronUp className="w-3 h-3 ml-1" />
                        : <ChevronDown className="w-3 h-3 ml-1" />}
                </Button>

                <Button
                    size="sm"
                    variant="ghost"
                    className={`h-6 text-[10px] px-2 ml-auto ${
                        confirmDelete
                            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
                            : 'text-muted-foreground hover:text-red-400'
                    }`}
                    onClick={handleDeleteClick}
                    title={confirmDelete ? 'Confirmar eliminación' : 'Eliminar tarea'}
                >
                    <Trash2 className="w-3 h-3 mr-1" />
                    {confirmDelete ? 'Confirmar' : 'Eliminar'}
                </Button>
            </div>

            {/* History panel */}
            {showHistory && (
                <div className="mt-2 pt-2 border-t border-white/5">
                    <TaskHistoryPanel taskId={task.id} history={history} />
                </div>
            )}
        </div>
    );
}

// ── Main panel ──────────────────────────────────────────────────────────────────

export const CronJobsPanel: React.FC = () => {
    const {
        scheduledTasks,
        taskHistory,
        cronChannels,
        cronRecommended,
        cronUserPreference,
        isLoading,
        fetchScheduledTasks,
        fetchCronChannels,
        pauseTask,
        resumeTask,
        deleteTask,
        triggerTask,
        fetchTaskHistory,
        saveCronChannelPreference,
    } = useNotesAndCronsStore();

    const [statusFilter, setStatusFilter] = useState<string>('all');

    useEffect(() => {
        fetchScheduledTasks();
        fetchCronChannels();
    }, [fetchScheduledTasks, fetchCronChannels]);

    const filtered = statusFilter === 'all'
        ? scheduledTasks
        : scheduledTasks.filter((t) => t.status === statusFilter);

    const activeChannels = (cronChannels ?? []).filter((c) => c.active);

    // Hide internal cleanup task from UI
    const visible = filtered.filter((t) => !t.name.startsWith('_hive_'));

    return (
        <Card className="border-none bg-background/50 backdrop-blur-xl shadow-2xl overflow-hidden border border-white/10">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <Clock className="w-5 h-5" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold tracking-tight">Tareas Programadas</CardTitle>
                            <CardDescription>Scheduler basado en Croner</CardDescription>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}

                        {/* Status filter */}
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-7 text-[10px] w-[110px] border-white/10 bg-card/40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                                <SelectItem value="active" className="text-xs">Activas</SelectItem>
                                <SelectItem value="paused" className="text-xs">Pausadas</SelectItem>
                                <SelectItem value="completed" className="text-xs">Completadas</SelectItem>
                                <SelectItem value="failed" className="text-xs">Fallidas</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Global channel preference */}
                        {activeChannels.length > 1 && (
                            <Select value={cronUserPreference} onValueChange={saveCronChannelPreference}>
                                <SelectTrigger className="h-7 text-[10px] w-[130px] border-white/10 bg-card/40">
                                    <SelectValue placeholder="Canal" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto" className="text-xs">Auto</SelectItem>
                                    {activeChannels.map((ch) => (
                                        <SelectItem key={ch.id} value={ch.id} className="text-xs">
                                            {channelLabel(ch.id, cronRecommended)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}

                        {/* Refresh */}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => fetchScheduledTasks(statusFilter === 'all' ? undefined : statusFilter)}
                            disabled={isLoading}
                            title="Refrescar"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <ScrollArea className="h-[420px] pr-4">
                    <div className="space-y-3">
                        {visible.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[280px] text-muted-foreground space-y-2">
                                <Clock className="w-12 h-12 opacity-20" />
                                <p className="text-sm">Sin tareas programadas</p>
                                <p className="text-[10px] opacity-70">
                                    Crea tareas desde el chat o con <code className="font-mono">hive cron add</code>
                                </p>
                            </div>
                        ) : (
                            visible.map((task) => (
                                <TaskCard
                                    key={task.id}
                                    task={task}
                                    onPause={pauseTask}
                                    onResume={resumeTask}
                                    onDelete={deleteTask}
                                    onTrigger={triggerTask}
                                    onLoadHistory={fetchTaskHistory}
                                    history={taskHistory[task.id]}
                                />
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};
