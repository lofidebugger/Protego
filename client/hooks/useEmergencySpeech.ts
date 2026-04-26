import { useState, useEffect } from "react";

interface SpeechOptions {
  text: string;
  rate?: number;
  pitch?: number;
  voice?: SpeechSynthesisVoice;
}

export function useEmergencySpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const handleVoicesChanged = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    handleVoicesChanged(); // Initial load
    return () => {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        handleVoicesChanged
      );
    };
  }, []);

  const speak = (options: SpeechOptions): boolean => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;

    const { text, rate = 0.9, pitch = 1 } = options;
    if (!text || !text.trim()) return false;

    const synth = window.speechSynthesis;

    const runSpeak = (voicePool: SpeechSynthesisVoice[]) => {
      // Stop any currently queued/stuck utterances before speaking the new emergency message.
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text.trim());

      let selectedVoice = options.voice;
      if (!selectedVoice) {
        selectedVoice =
          voicePool.find((v) => v.name.includes("Google") && v.lang.startsWith("en")) ||
          voicePool.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")) ||
          voicePool.find((v) => v.lang.startsWith("en-US")) ||
          voicePool.find((v) => v.lang.startsWith("en")) ||
          voicePool[0];
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.rate = rate;
      utterance.pitch = pitch;

      // In some browsers, speaking right away after socket events can fail unless queued in next tick.
      window.setTimeout(() => {
        synth.speak(utterance);
      }, 200);
    };

    const voicePool = synth.getVoices();
    if (voicePool.length > 0) {
      runSpeak(voicePool);
      return true;
    }

    const onVoicesReady = () => {
      synth.removeEventListener("voiceschanged", onVoicesReady);
      runSpeak(synth.getVoices());
    };

    synth.addEventListener("voiceschanged", onVoicesReady);

    // Safety timeout: if voiceschanged never fires, still attempt with default voice.
    window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", onVoicesReady);
      runSpeak(synth.getVoices());
    }, 1200);

    return true;
  };

  return { speak, voices };
}
