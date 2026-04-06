import { useEffect, useState } from "react";
import {
  RefreshCw, BookOpen, CheckCircle2, Clock, Zap, Star,
  Trash2, Play, Trophy, Target, TrendingUp, Award,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface HLSession {
  session_id: string;
  alumno_id: string;
  curriculo_id: number;
  meta: string;
  nombre: string;
  rango_edad: string;
  total_nodos: number;
  nodos_completados: number;
  xp_total: number;
  nivel_alcanzado: string;
  evaluacion_puntaje: number | null;
  completada: number;
  created_at: number;
}

interface HLMetrics {
  total_xp: number;
  avg_score: number;
  completion_rate: number;
  total_sessions: number;
  completed_sessions: number;
}

const RANGO_LABEL: Record<string, string> = {
  nino: 'Niño', adolescente: 'Adolescente', adulto: 'Adulto',
};

const NIVEL_EMOJI: Record<string, string> = {
  principiante: '🌱', intermedio: '⚡', avanzado: '🔥', experto: '💎',
};

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({
  icon: Icon, value, label, color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className={`flex-1 rounded-xl border p-4 flex flex-col gap-1 ${color}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 opacity-70" />
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</span>
      </div>
      <span className="text-xl font-black">{value}</span>
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────
function SessionCard({
  session,
  onDelete,
  onResume,
}: {
  session: HLSession;
  onDelete: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progress = session.total_nodos > 0
    ? Math.round((session.nodos_completados / session.total_nodos) * 100)
    : 0;

  const date = new Date((session.created_at || 0) * 1000).toLocaleDateString('es', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const nivelEmoji = NIVEL_EMOJI[session.nivel_alcanzado] ?? '📚';
  const isComplete = Boolean(session.completada);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await fetch(`/api/hivelearn/sessions/${session.session_id}`, { method: 'DELETE' });
      onDelete(session.session_id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border transition-all duration-300 group flex flex-col
      ${isComplete
        ? 'bg-green-500/[0.03] border-green-500/20 hover:border-green-500/40 hover:shadow-[0_0_20px_rgba(34,197,94,0.08)]'
        : 'bg-white/[0.02] border-white/8 hover:border-blue-500/30 hover:shadow-[0_0_20px_rgba(59,130,246,0.08)]'
      }`}>

      {/* Top accent */}
      <div className={`h-px w-full ${isComplete
        ? 'bg-gradient-to-r from-transparent via-green-500/50 to-transparent'
        : 'bg-gradient-to-r from-transparent via-blue-500/40 to-transparent'}`} />

      {/* Left accent bar */}
      <div className={`absolute top-0 left-0 w-0.5 h-full
        ${isComplete
          ? 'bg-gradient-to-b from-green-400/60 to-transparent'
          : 'bg-gradient-to-b from-blue-400/60 to-transparent'}`} />

      <div className="p-5 flex flex-col flex-1 gap-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{nivelEmoji}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border
                ${isComplete
                  ? 'bg-green-500/15 border-green-500/25 text-green-400'
                  : 'bg-blue-500/15 border-blue-500/25 text-blue-400'}`}>
                {isComplete ? 'Completada' : 'En progreso'}
              </span>
            </div>
            <p className="text-white font-bold text-sm leading-snug line-clamp-2 group-hover:text-white transition-colors">
              {session.meta || 'Sesión sin título'}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-white/40 text-xs">{session.nombre}</span>
              {session.rango_edad && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 uppercase tracking-wider font-medium">
                  {RANGO_LABEL[session.rango_edad] ?? session.rango_edad}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-[11px] text-white/30 mb-1.5">
            <span>{session.nodos_completados} / {session.total_nodos} nodos</span>
            <span className={`font-bold ${isComplete ? 'text-green-400' : 'text-blue-400'}`}>{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isComplete ? 'bg-green-500/60' : 'bg-gradient-to-r from-blue-500/70 to-blue-400/70'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* XP + score row */}
        <div className="flex items-center gap-3 text-xs">
          {session.xp_total > 0 && (
            <div className="flex items-center gap-1 text-blue-400/80 font-semibold">
              <Zap className="h-3 w-3" />
              {session.xp_total} XP
            </div>
          )}
          {session.evaluacion_puntaje != null && (
            <div className="flex items-center gap-1 text-purple-400/80 font-semibold">
              <Star className="h-3 w-3" />
              {session.evaluacion_puntaje}%
            </div>
          )}
          {session.nivel_alcanzado && (
            <div className="flex items-center gap-1 text-blue-400/60 font-medium capitalize">
              <Award className="h-3 w-3" />
              {session.nivel_alcanzado}
            </div>
          )}
          <span className="ml-auto text-white/20">{date}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-1 border-t border-white/5">
          {!isComplete && (
            <button
              onClick={() => onResume(session.session_id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 text-xs font-bold transition-all"
            >
              <Play className="h-3.5 w-3.5" />
              Continuar
            </button>
          )}
          {isComplete && (
            <button
              onClick={() => onResume(session.session_id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 hover:border-green-500/30 text-green-400 text-xs font-bold transition-all"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Revisar
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            onBlur={() => setConfirmDelete(false)}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-bold transition-all
              ${confirmDelete
                ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30'
                : 'bg-white/[0.02] border-white/8 text-white/30 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/8'
              }`}
          >
            {deleting ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {confirmDelete && !deleting && <span>¿Eliminar?</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="h-52 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function HiveLearnSessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<HLSession[]>([]);
  const [metrics, setMetrics] = useState<HLMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const [sessRes, metRes] = await Promise.all([
        fetch("/api/hivelearn/sessions"),
        fetch("/api/hivelearn/metrics").catch(() => null),
      ]);
      const sessData = await sessRes.json();
      setSessions(sessData.sessions ?? []);
      if (metRes?.ok) {
        const metData = await metRes.json();
        setMetrics(metData);
      }
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleDelete = (id: string) => {
    setSessions(prev => prev.filter(s => s.session_id !== id));
  };

  const handleResume = (id: string) => {
    navigate(`/hivelearn?session=${id}`);
  };

  const filteredSessions = sessions.filter(s => {
    if (filter === 'active') return !s.completada;
    if (filter === 'completed') return Boolean(s.completada);
    return true;
  });

  const completed = sessions.filter(s => s.completada).length;
  const inProgress = sessions.filter(s => !s.completada).length;
  const totalXp = metrics?.total_xp ?? sessions.reduce((acc, s) => acc + (s.xp_total || 0), 0);
  const avgScore = metrics?.avg_score
    ?? (sessions.filter(s => s.evaluacion_puntaje != null).length > 0
      ? Math.round(sessions.reduce((a, s) => a + (s.evaluacion_puntaje ?? 0), 0) / sessions.filter(s => s.evaluacion_puntaje != null).length)
      : null);

  return (
    <div className="hive-page mt-10 animate-in fade-in duration-700">
      <div className="hive-page-container">

        {/* Ambient glows */}
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] bg-blue-600/8 rounded-full blur-[120px] pointer-events-none opacity-60" />
        <div className="absolute top-20 -right-40 h-[400px] w-[400px] bg-indigo-600/6 rounded-full blur-[100px] pointer-events-none opacity-50" />

        {/* ── Header ── */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-8">
          <div className="animate-in slide-in-from-left-8 duration-700">
            <div className="hive-page-header__eyebrow mb-3 opacity-80">
              <div className="hive-page-header__dot animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
              <span className="hive-page-header__label tracking-widest font-semibold text-blue-400">HIVELEARN</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white drop-shadow-lg mb-2">
              Mis <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600">Sesiones</span>
            </h2>
            <p className="text-white/50 text-sm font-light">
              {isLoading ? 'Cargando...' : sessions.length === 0
                ? '¡Empieza tu primera lección!'
                : `${sessions.length} sesión${sessions.length !== 1 ? 'es' : ''} · ${completed} completada${completed !== 1 ? 's' : ''} · ${inProgress} en progreso`}
            </p>
          </div>

          <div className="flex items-center gap-3 animate-in slide-in-from-right-8 duration-700">
            <button
              onClick={() => navigate("/hivelearn")}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] flex items-center gap-2"
            >
              <Zap className="h-4 w-4" />
              Nueva lección
            </button>
            <button
              onClick={fetchAll}
              disabled={isLoading}
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all group"
              title="Refrescar"
            >
              <RefreshCw className={`h-4 w-4 text-blue-400/70 transition-transform group-hover:rotate-180 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Stats bar ── */}
        {!isLoading && sessions.length > 0 && (
          <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 animate-in slide-in-from-bottom-4 duration-700">
            <StatChip
              icon={Trophy}
              value={completed}
              label="Completadas"
              color="bg-green-500/5 border-green-500/20 text-green-400"
            />
            <StatChip
              icon={Target}
              value={inProgress}
              label="En progreso"
              color="bg-blue-500/5 border-blue-500/20 text-blue-400"
            />
            <StatChip
              icon={Zap}
              value={`${totalXp} XP`}
              label="XP total"
              color="bg-cyan-500/5 border-cyan-500/20 text-cyan-400"
            />
            <StatChip
              icon={TrendingUp}
              value={avgScore != null ? `${avgScore}%` : '—'}
              label="Puntaje medio"
              color="bg-purple-500/5 border-purple-500/20 text-purple-400"
            />
          </div>
        )}

        {/* ── Filter tabs ── */}
        {!isLoading && sessions.length > 0 && (
          <div className="relative z-10 flex items-center gap-1 mb-6 p-1 bg-white/[0.02] rounded-xl border border-white/5 w-fit">
            {(['all', 'active', 'completed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                  ${filter === f
                    ? 'bg-blue-500/20 border border-blue-500/30 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                    : 'text-white/30 hover:text-white/60 border border-transparent'}`}
              >
                {f === 'all' ? 'Todas' : f === 'active' ? 'En progreso' : 'Completadas'}
              </button>
            ))}
          </div>
        )}

        {/* ── Content ── */}
        <div className="relative z-10">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : filteredSessions.length === 0 && sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center border border-white/5 rounded-3xl bg-black/20 backdrop-blur-sm">
              <div className="text-6xl mb-4 animate-bounce">🐝</div>
              <h3 className="text-xl font-bold text-white mb-2">Sin sesiones todavía</h3>
              <p className="text-white/40 mb-6 text-sm max-w-xs leading-relaxed">
                Completa tu primera lección para ver tu historial, XP ganado y estadísticas de aprendizaje.
              </p>
              <button
                onClick={() => navigate("/hivelearn")}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)]"
              >
                Empezar a aprender
              </button>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-50">
                {filter === 'active' ? '✅' : '⏳'}
              </div>
              <p className="text-white/30 text-sm">
                {filter === 'active' ? '¡Has completado todas tus sesiones!' : 'Todavía no has completado ninguna sesión.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-in slide-in-from-bottom-8 duration-700">
              {filteredSessions.map(session => (
                <SessionCard
                  key={session.session_id}
                  session={session}
                  onDelete={handleDelete}
                  onResume={handleResume}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Bottom CTA if has completed sessions ── */}
        {!isLoading && completed > 0 && (
          <div className="relative z-10 mt-8 text-center">
            <p className="text-[11px] text-white/25 font-mono tracking-wider">
              🏆 {completed} lección{completed !== 1 ? 'es' : ''} completada{completed !== 1 ? 's' : ''} &nbsp;·&nbsp;
              ⚡ {totalXp} XP ganados &nbsp;·&nbsp;
              {avgScore != null ? `📊 ${avgScore}% promedio` : '🐝 Sigue aprendiendo'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
