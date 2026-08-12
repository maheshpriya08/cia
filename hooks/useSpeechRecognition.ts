/**
 * useSpeechRecognition — thin wrapper over the Web Speech API.
 *
 * Works in Chrome, Edge and Android Chrome. Safari/iOS support is partial.
 * Requires an https origin (or localhost) — file:// will not get mic access.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// The DOM lib does not ship these types in every TS version, so declare the
// minimum surface we actually touch.
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResult };
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export interface UseSpeechRecognitionOptions {
  /** BCP-47 tag. 'en-IN' handles Indian-accented English well. */
  lang?: string;
  /** Keep listening through pauses instead of stopping after one phrase. */
  continuous?: boolean;
  /** Called once per finalised phrase — append this to your textarea. */
  onFinalTranscript?: (text: string) => void;
}

export function useSpeechRecognition({
  lang = 'en-IN',
  continuous = true,
  onFinalTranscript,
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRestartRef = useRef(false);
  const finalCbRef = useRef(onFinalTranscript);
  finalCbRef.current = onFinalTranscript;

  const isSupported = getRecognitionCtor() !== null;

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalCbRef.current?.(text.trim());
        } else {
          interimText += text;
        }
      }
      setInterim(interimText);
    };

    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are routine; don't shout about them.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(
        event.error === 'not-allowed'
          ? 'Microphone access is blocked. Allow it in the browser address bar.'
          : `Speech recognition stopped: ${event.error}`
      );
      shouldRestartRef.current = false;
      setIsListening(false);
    };

    // Chrome ends the session on long silence even in continuous mode.
    recognition.onend = () => {
      if (shouldRestartRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through to stopping */
        }
      }
      setIsListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;

    return () => {
      shouldRestartRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [lang, continuous]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || isListening) return;
    setError(null);
    shouldRestartRef.current = continuous;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // start() throws if already running — ignore.
    }
  }, [continuous, isListening]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterim('');
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { isSupported, isListening, interim, error, start, stop, toggle };
}
