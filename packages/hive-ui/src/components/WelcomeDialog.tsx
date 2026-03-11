import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useWelcomeStore, type WelcomeData } from "@/stores/useWelcomeStore";

// Bee SVG Component
function Bee({ delay, startX, startY, duration }: { delay: number; startX: number; startY: number; duration: number }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${startX}%`,
    top: `${startY}%`,
    animation: `flyBee ${duration}s ease-in-out ${delay}s infinite`,
    opacity: 0,
  };

  return (
    <svg
      style={style}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className="drop-shadow-lg"
    >
      <ellipse cx="12" cy="14" rx="6" ry="8" fill="#FBBF24" />
      <ellipse cx="12" cy="14" rx="3" ry="6" fill="#1F2937" />
      <circle cx="8" cy="10" r="2" fill="#1F2937" />
      <circle cx="16" cy="10" r="2" fill="#1F2937" />
      <path
        d="M6 8 Q4 4 8 6"
        stroke="#1F2937"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M18 8 Q20 4 16 6"
        stroke="#1F2937"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M9 18 L6 22 L9 20 Z"
        fill="#1F2937"
      />
      <path
        d="M15 18 L18 22 L15 20 Z"
        fill="#1F2937"
      />
    </svg>
  );
}

// Star sparkle
function Sparkle({ delay, x, y }: { delay: number; x: number; y: number }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${x}%`,
    top: `${y}%`,
    animation: `sparkle 2s ease-in-out ${delay}s infinite`,
  };

  return (
    <svg style={style} width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"
        fill="#FCD34D"
        className="animate-pulse"
      />
    </svg>
  );
}

export function WelcomeDialog() {
  const { isOpen, data, close } = useWelcomeStore();
  const [countdown, setCountdown] = useState(4);

  useEffect(() => {
    if (isOpen) {
      setCountdown(4);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            close();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isOpen, close]);

  if (!isOpen || !data) return null;

  const channelList = data.channels?.length > 0
    ? data.channels.join(", ")
    : "WebChat";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg focus:outline-none">
          <Dialog.Title className="sr-only">Bienvenido al Enjambre</Dialog.Title>
          <div className="relative bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-100 rounded-3xl shadow-2xl overflow-hidden border-4 border-amber-300/50">
            {/* Animated background with bees */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-amber-200/30 to-orange-200/30" />

              {/* Bees */}
              <Bee delay={0} startX={10} startY={20} duration={8} />
              <Bee delay={1} startX={80} startY={30} duration={7} />
              <Bee delay={2} startX={20} startY={60} duration={9} />
              <Bee delay={0.5} startX={70} startY={70} duration={8} />
              <Bee delay={1.5} startX={40} startY={10} duration={10} />
              <Bee delay={2.5} startX={60} startY={50} duration={7} />

              {/* Sparkles */}
              <Sparkle delay={0} x={15} y={15} />
              <Sparkle delay={0.5} x={85} y={25} />
              <Sparkle delay={1} x={25} y={75} />
              <Sparkle delay={1.5} x={75} y={80} />
              <Sparkle delay={2} x={50} y={10} />
            </div>

            {/* Content */}
            <div className="relative p-8 text-center">
              {/* Header */}
              <div className="mb-6">
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 drop-shadow-sm">
                  🐝 BIENVENIDO AL ENJAMBRE 🐝
                </h1>
                <p className="text-lg font-semibold text-amber-800 mt-2">
                  ✦在你的 Hive✦
                </p>
              </div>

              {/* Divider */}
              <div className="w-full h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent mb-6" />

              {/* User Info */}
              <div className="mb-6">
                {data.user && (
                  <p className="text-2xl font-bold text-gray-800 mb-4">
                    👋 Hola, <span className="text-amber-700">{data.user.name}</span>!
                  </p>
                )}

                <div className="flex flex-col gap-2 text-left bg-white/60 rounded-xl p-4 backdrop-blur-sm">
                  {data.agent && (
                    <p className="text-gray-700">
                      <span className="font-semibold">🤖 Tu agente:</span>{" "}
                      <span className="text-amber-700">{data.agent.name}</span>
                    </p>
                  )}
                  {data.agent && (
                    <p className="text-gray-700">
                      <span className="font-semibold">🧠 Provider:</span>{" "}
                      <span className="text-amber-700">{data.agent.provider}/{data.agent.model}</span>
                    </p>
                  )}
                  <p className="text-gray-700">
                    <span className="font-semibold">📡 Canales:</span>{" "}
                    <span className="text-amber-700">{channelList}</span>
                  </p>
                  {data.voice?.enabled && (
                    <p className="text-gray-700">
                      <span className="font-semibold">🎤 Voz:</span>{" "}
                      <span className="text-amber-700">
                        {data.voice.sttProvider} + {data.voice.ttsProvider}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="w-full h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent mb-6" />

              {/* Hive Capabilities */}
              <div className="mb-6 text-left">
                <p className="text-lg font-bold text-gray-800 mb-3 text-center">
                  💡 LO QUE PUEDES HACER CON HIVE:
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Capability icon="🗣️" text="Voz en tiempo real (STT/TTS)" />
                  <Capability icon="🔧" text="Code Bridge (claude-code, gemini)" />
                  <Capability icon="🔌" text="MCP Servers" />
                  <Capability icon="🎨" text="Canvas visual" />
                  <Capability icon="📱" text="Múltiples canales" />
                  <Capability icon="🧠" text="Múltiples agentes" />
                  <Capability icon="💬" text="Memoria conversacional" />
                  <Capability icon="⚡" text="Ejecución de tools" />
                </div>
              </div>

              {/* Footer */}
              <div className="mt-4">
                <p className="text-amber-600 font-medium animate-pulse">
                  🌐 Abriendo Dashboard en {countdown}s...
                </p>
              </div>

              {/* Close button */}
              <Dialog.Close asChild>
                <button
                  className="absolute top-4 right-4 p-2 rounded-full bg-amber-200/80 hover:bg-amber-300 transition-colors"
                  aria-label="Cerrar"
                >
                  <X className="w-5 h-5 text-amber-800" />
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <style>{`
        @keyframes flyBee {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          25% {
            transform: translate(100px, -50px) rotate(15deg);
          }
          50% {
            transform: translate(50px, 50px) rotate(-10deg);
          }
          75% {
            transform: translate(-80px, 20px) rotate(20deg);
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 0;
          }
        }

        @keyframes sparkle {
          0%, 100% {
            opacity: 0;
            transform: scale(0.5);
          }
          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }

        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </Dialog.Root>
  );
}

function Capability({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/50 rounded-lg px-3 py-2">
      <span className="text-lg">{icon}</span>
      <span className="text-gray-700 text-xs">{text}</span>
    </div>
  );
}
