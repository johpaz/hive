import React from "react";
import { useLoaderStore } from "@/stores/useLoaderStore";
import { cn } from "@/lib/utils";

export const BeeLoader: React.FC = () => {
    const { isLoading, message } = useLoaderStore();

    if (!isLoading) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="relative h-32 w-32 animate-bounce duration-[2000ms]">
                {/* SVG Bee */}
                <svg
                    viewBox="0 0 100 100"
                    className="h-full w-full drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]"
                >
                    {/* Wings */}
                    <g className="animate-[wing-flap_0.1s_infinite]">
                        <path
                            d="M50 40 C30 20 10 30 20 50 C30 70 50 60 50 40"
                            fill="rgba(255,255,255,0.7)"
                            stroke="white"
                            strokeWidth="1"
                        />
                        <path
                            d="M50 40 C70 20 90 30 80 50 C70 70 50 60 50 40"
                            fill="rgba(255,255,255,0.7)"
                            stroke="white"
                            strokeWidth="1"
                        />
                    </g>

                    {/* Body */}
                    <ellipse cx="50" cy="55" rx="20" ry="15" fill="#F59E0B" />
                    <path d="M40 45 Q50 40 60 45" fill="none" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
                    <path d="M35 55 Q50 50 65 55" fill="none" stroke="#1F2937" strokeWidth="3" />
                    <path d="M40 65 Q50 60 60 65" fill="none" stroke="#1F2937" strokeWidth="2" />

                    {/* Head */}
                    <circle cx="68" cy="50" r="8" fill="#F59E0B" />
                    <circle cx="72" cy="48" r="1.5" fill="#1F2937" />

                    {/* Antennae */}
                    <path d="M70 42 Q75 35 80 38" fill="none" stroke="#1F2937" strokeWidth="1" />
                    <path d="M68 42 Q65 35 60 38" fill="none" stroke="#1F2937" strokeWidth="1" />

                    {/* Stinger */}
                    <path d="M30 55 L20 55" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
                </svg>
            </div>

            {message && (
                <p className="mt-8 text-lg font-medium tracking-wide text-primary animate-pulse italic">
                    {message}
                </p>
            )}

            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes wing-flap {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.5); }
        }
      `}} />
        </div>
    );
};
