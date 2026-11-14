import { useCallback } from "react";

export type SpeechLang = "en-US" | "es-ES" | "ru-RU";

export function useSpeechSynthesis() {
  const speak = useCallback(
    /**
     * Speak `text`. `onEnd` (optional) runs once when the speech finishes:
     * `true` if it played to the end, `false` if it failed or was cut off by
     * another speak/cancel. Returns false when the browser has no speech
     * support (then `onEnd` is never called).
     */
    (
      text: string,
      lang: SpeechLang,
      rate: number = 1,
      pitch: number = 1,
      onEnd?: (finished: boolean) => void,
    ): boolean => {
      if (typeof window === "undefined" || !window.speechSynthesis) return false;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      if (onEnd) {
        let done = false;
        const finish = (ok: boolean) => { if (!done) { done = true; onEnd(ok); } };
        utterance.onend   = () => finish(true);
        utterance.onerror = () => finish(false);
      }

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return true;
    },
    []
  );

  const cancel = useCallback(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
  }, []);

  return { speak, cancel };
}