import { useLessonStore } from '../store/lessonStore'
import { useGamification } from '../hooks/useGamification'

export function GamificationHUD({ tema }: { tema: string }) {
  const { vidas, racha } = useLessonStore()
  const { xpTotal, nivelActual, formatXP } = useGamification()

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900/90 border-b border-gray-800 backdrop-blur z-20 min-h-[48px]">
      {/* Tema */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-amber-400 text-base">🐝</span>
        <span className="text-white font-bold text-sm truncate max-w-[200px]">{tema}</span>
      </div>

      {/* Centro — vidas y racha */}
      <div className="flex items-center gap-4">
        {/* Vidas */}
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <span
              key={i}
              className={`text-lg transition-all duration-300 ${i < vidas ? 'opacity-100' : 'opacity-20 grayscale'}`}
            >
              ❤️
            </span>
          ))}
        </div>

        {/* Racha */}
        {racha >= 2 && (
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold
            ${racha >= 5 ? 'bg-red-500/20 border border-red-500/40 text-red-300' :
              racha >= 3 ? 'bg-orange-500/20 border border-orange-500/40 text-orange-300' :
              'bg-amber-500/20 border border-amber-500/40 text-amber-300'}
          `}>
            <span className={racha >= 3 ? 'animate-bounce' : ''}>🔥</span>
            <span>{racha}</span>
          </div>
        )}
      </div>

      {/* XP y nivel */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-amber-400 font-bold text-xs tabular-nums">{formatXP(xpTotal)}</span>
          <div className="w-24 h-1 rounded-full bg-gray-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-600 to-yellow-400 transition-all duration-700"
              style={{ width: `${Math.min((xpTotal % 100), 100)}%` }}
            />
          </div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold whitespace-nowrap">
          {nivelActual}
        </span>
      </div>
    </div>
  )
}
