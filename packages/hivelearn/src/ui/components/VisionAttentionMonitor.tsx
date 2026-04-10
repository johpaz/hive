/**
 * VisionAttentionMonitor — captura frames de webcam y los envía a Gemma 4
 * para detectar si el alumno está atento. Muestra un indicador sutil en la UI.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchWithAuth } from '../lib/fetchWithAuth'

type AttentionStatus = 'focused' | 'distracted' | 'away' | 'idle' | 'error'

interface Props {
  sessionId: string
  onAttentionLost?: () => void
  enabled?: boolean
}

const STATUS_CONFIG: Record<AttentionStatus, { color: string; label: string }> = {
  focused:    { color: '#22c55e', label: 'Atento' },
  distracted: { color: '#f59e0b', label: 'Distraído' },
  away:       { color: '#ef4444', label: 'Ausente' },
  idle:       { color: 'rgba(255,255,255,0.2)', label: 'Cámara' },
  error:      { color: 'rgba(255,255,255,0.2)', label: '' },
}

const CAPTURE_INTERVAL_MS = 10_000  // cada 10 segundos
const LOW_ATTENTION_THRESHOLD = 40
const LOW_ATTENTION_STRIKES = 2     // 2 ciclos seguidos bajo threshold → alert

export function VisionAttentionMonitor({ sessionId, onAttentionLost, enabled = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const strikeCountRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [status, setStatus] = useState<AttentionStatus>('idle')
  const [permissionDenied, setPermissionDenied] = useState(false)

  const captureAndAnalyze = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    // Capturar frame del video
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = 320
    canvas.height = 240
    ctx.drawImage(video, 0, 0, 320, 240)
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]

    try {
      const res = await fetchWithAuth('/api/hivelearn/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, imageBase64 }),
      })
      if (!res.ok) { setStatus('error'); return }

      const data: { attention: AttentionStatus; score: number } = await res.json()
      setStatus(data.attention)

      if (data.score < LOW_ATTENTION_THRESHOLD) {
        strikeCountRef.current++
        if (strikeCountRef.current >= LOW_ATTENTION_STRIKES) {
          strikeCountRef.current = 0
          onAttentionLost?.()
        }
      } else {
        strikeCountRef.current = 0
      }
    } catch {
      setStatus('error')
    }
  }, [sessionId, onAttentionLost])

  // Iniciar webcam
  useEffect(() => {
    if (!enabled) return

    navigator.mediaDevices?.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        // Iniciar captura periódica
        intervalRef.current = setInterval(captureAndAnalyze, CAPTURE_INTERVAL_MS)
      })
      .catch(() => {
        setPermissionDenied(true)
      })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [enabled, captureAndAnalyze])

  if (permissionDenied || !enabled) return null

  const cfg = STATUS_CONFIG[status]

  return (
    <>
      {/* Video oculto para captura */}
      <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Indicador sutil — dot de color en esquina */}
      <div
        title={`Gemma te observa: ${cfg.label}`}
        className="flex items-center gap-1.5 select-none"
        style={{ opacity: 0.6 }}
      >
        <div
          className={`w-2 h-2 rounded-full ${status === 'focused' ? 'animate-pulse' : ''}`}
          style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}80` }}
        />
        {cfg.label && (
          <span className="text-[9px] font-medium" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
        )}
      </div>
    </>
  )
}
