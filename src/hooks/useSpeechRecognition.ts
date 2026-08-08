import { useCallback, useEffect, useRef, useState } from 'react';

/* The Web Speech API is not in the standard TS DOM lib, so we type loosely. */
type AnyRecognition = any;

function getRecognitionCtor(): any | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const isSpeechSupported = (): boolean => getRecognitionCtor() !== null;

export interface UseSpeechOptions {
  /** BCP-47 tag, e.g. 'en-IN', 'en-GB', 'ta-IN'. */
  lang?: string;
  /** Called once for every finalised chunk of speech. */
  onFinal: (transcript: string) => void;
  /** Called continuously with the in-progress guess. */
  onInterim?: (transcript: string) => void;
}

/**
 * Thin wrapper around SpeechRecognition that keeps listening until the user
 * stops it, and survives the automatic timeouts Chrome applies after silence.
 */
export function useSpeechRecognition({ lang = 'en-IN', onFinal, onInterim }: UseSpeechOptions) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<AnyRecognition>(null);
  const wantListeningRef = useRef(false);
  const finalRef = useRef(onFinal);
  const interimRef = useRef(onInterim);

  finalRef.current = onFinal;
  interimRef.current = onInterim;

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setListening(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser. Use Chrome, Edge or Android Chrome.');
      return;
    }
    setError(null);

    const recognition: AnyRecognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (text.trim()) finalRef.current(text.trim());
        } else {
          interim += text;
        }
      }
      interimRef.current?.(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission was denied. Allow it in the address-bar icon and try again.');
        wantListeningRef.current = false;
        setListening(false);
        return;
      }
      setError(`Speech error: ${event.error}`);
    };

    recognition.onend = () => {
      interimRef.current?.('');
      // Chrome ends the session after a few seconds of silence - restart it.
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Could not start the microphone. Close other tabs that may be using it.');
      wantListeningRef.current = false;
      setListening(false);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop();
    else start();
  }, [start, stop]);

  // Stop cleanly when the component unmounts.
  useEffect(() => () => {
    wantListeningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  return { listening, error, start, stop, toggle, supported: isSpeechSupported() };
}
