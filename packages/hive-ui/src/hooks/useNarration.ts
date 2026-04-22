import { useState, useEffect, useCallback, useRef } from "react";

interface NarrationPreferences {
  enabled: boolean;
  rate: number;
  pitch: number;
  voiceName: string | null;
}

const STORAGE_KEY = "hive-narration-prefs";

function loadPrefs(): NarrationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, rate: 1.0, pitch: 1.0, voiceName: null };
}

function savePrefs(prefs: NarrationPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function useNarration() {
  const [prefs, setPrefs] = useState<NarrationPreferences>(loadPrefs);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const getVoice = useCallback((voiceName: string | null): SpeechSynthesisVoice | null => {
    if (!voiceName) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.name === voiceName) || null;
  }, []);

  const narrate = useCallback(
    (text: string) => {
      if (!prefs.enabled || !window.speechSynthesis) return;

      window.speechSynthesis.cancel();

      const cleaned = text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]+`/g, "")
        .replace(/[#*_~\[\]()]/g, "")
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .trim();

      if (!cleaned) return;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = prefs.rate;
      utterance.pitch = prefs.pitch;

      const voice = getVoice(prefs.voiceName);
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        setIsSpeaking(true);
        setCurrentText(cleaned.slice(0, 50));
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        setCurrentText(null);
        utteranceRef.current = null;
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setCurrentText(null);
        utteranceRef.current = null;
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [prefs, getVoice]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setCurrentText(null);
    utteranceRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    setPrefs((prev) => {
      const next = { ...prev, enabled: !prev.enabled };
      savePrefs(next);
      if (!next.enabled) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        setCurrentText(null);
      }
      return next;
    });
  }, []);

  const updatePrefs = useCallback((partial: Partial<NarrationPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      savePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  return {
    isEnabled: prefs.enabled,
    isSpeaking,
    currentText,
    rate: prefs.rate,
    pitch: prefs.pitch,
    narrate,
    stop,
    toggle,
    updatePrefs,
  };
}