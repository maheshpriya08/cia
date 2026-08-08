import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Mic, MicOff, Sigma, Type, HelpCircle, X } from 'lucide-react';
import { useSpeechRecognition, isSpeechSupported } from '../hooks/useSpeechRecognition';
import { speechToQuestionText, VOICE_EXAMPLES } from '../lib/mathSpeech';
import { MathText } from './MathText';
import { cn } from '../utils';

/* ------------------------------------------------------------------ */
/* Global voice settings (dictation language + math mode)              */
/* ------------------------------------------------------------------ */

export const VOICE_LANGS: Array<{ code: string; label: string }> = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'kn-IN', label: 'Kannada' },
];

interface VoiceSettings {
  lang: string;
  setLang: (v: string) => void;
  mathMode: boolean;
  setMathMode: (v: boolean) => void;
}

const VoiceContext = createContext<VoiceSettings>({
  lang: 'en-IN',
  setLang: () => {},
  mathMode: false,
  setMathMode: () => {},
});

export const useVoiceSettings = () => useContext(VoiceContext);

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<string>(
    () => localStorage.getItem('cia-voice-lang') || 'en-IN',
  );
  const [mathMode, setMathModeState] = useState<boolean>(
    () => localStorage.getItem('cia-voice-math') === '1',
  );

  const setLang = useCallback((v: string) => {
    setLangState(v);
    localStorage.setItem('cia-voice-lang', v);
  }, []);

  const setMathMode = useCallback((v: boolean) => {
    setMathModeState(v);
    localStorage.setItem('cia-voice-math', v ? '1' : '0');
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, mathMode, setMathMode }),
    [lang, mathMode, setLang, setMathMode],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
};

/* ------------------------------------------------------------------ */
/* Settings bar shown once, near the top of the editor                 */
/* ------------------------------------------------------------------ */

export const VoiceSettingsBar: React.FC = () => {
  const { lang, setLang, mathMode, setMathMode } = useVoiceSettings();
  const [showHelp, setShowHelp] = useState(false);
  const supported = isSpeechSupported();

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 no-print">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
          <Mic size={16} className="text-indigo-600" />
          Voice typing
        </div>

        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="px-3 py-1.5 bg-white border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
          title="Dictation language"
        >
          {VOICE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setMathMode(!mathMode)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
            mathMode
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-slate-600 border-indigo-200 hover:bg-indigo-50',
          )}
          title="When on, everything you dictate is converted to LaTeX maths"
        >
          {mathMode ? <Sigma size={15} /> : <Type size={15} />}
          {mathMode ? 'Maths mode: ON' : 'Maths mode: OFF'}
        </button>

        <button
          type="button"
          onClick={() => setShowHelp((s) => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-slate-600 border border-indigo-200 hover:bg-indigo-50"
        >
          <HelpCircle size={15} />
          What can I say?
        </button>

        {!supported && (
          <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg">
            Not supported in this browser — use Chrome or Edge.
          </span>
        )}
      </div>

      {showHelp && (
        <div className="mt-4 bg-white rounded-xl border border-indigo-100 p-4 text-sm">
          <div className="flex items-start justify-between gap-4 mb-3">
            <p className="text-slate-600">
              Press the microphone next to any question box and speak. Say
              {' '}<b>“equation”</b> to start dictating a formula and <b>“end equation”</b> to go
              back to normal text — or leave <b>Maths mode</b> on to treat everything as maths.
              Punctuation words like <b>comma</b>, <b>full stop</b> and <b>new line</b> work in
              normal text.
            </p>
            <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {VOICE_EXAMPLES.map((ex) => (
              <div key={ex.say} className="flex items-start gap-2 py-1 border-b border-slate-100 last:border-0">
                <span className="text-slate-500 flex-1">“{ex.say}”</span>
                <span className="text-slate-900 font-mono text-xs flex-1 break-all">{ex.get}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Mic button                                                          */
/* ------------------------------------------------------------------ */

interface MicButtonProps {
  onText: (text: string) => void;
  onInterim?: (text: string) => void;
  size?: 'sm' | 'md';
  title?: string;
}

export const MicButton: React.FC<MicButtonProps> = ({ onText, onInterim, size = 'md', title }) => {
  const { lang, mathMode } = useVoiceSettings();

  const handleFinal = useCallback(
    (raw: string) => {
      const converted = speechToQuestionText(raw, mathMode);
      if (converted) onText(converted);
    },
    [mathMode, onText],
  );

  const { listening, toggle, error, supported } = useSpeechRecognition({
    lang,
    onFinal: handleFinal,
    onInterim,
  });

  const dim = size === 'sm' ? 14 : 18;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!supported}
      title={
        title ||
        (!supported
          ? 'Voice typing needs Chrome or Edge'
          : listening
            ? 'Stop dictation'
            : `Dictate (${mathMode ? 'maths' : 'text'} mode)`)
      }
      className={cn(
        'shrink-0 flex items-center justify-center rounded-lg border transition-all',
        size === 'sm' ? 'w-8 h-8' : 'w-10 h-10',
        !supported && 'opacity-40 cursor-not-allowed border-slate-200 bg-white text-slate-400',
        supported && listening && 'bg-red-500 border-red-500 text-white animate-pulse',
        supported && !listening && 'bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300',
        error && 'border-amber-400',
      )}
    >
      {listening ? <MicOff size={dim} /> : <Mic size={dim} />}
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* Voice-enabled textarea                                              */
/* ------------------------------------------------------------------ */

interface VoiceTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Render a live KaTeX preview of the current value below the box. */
  showPreview?: boolean;
}

export const VoiceTextArea: React.FC<VoiceTextAreaProps> = ({
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
  showPreview = true,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [interim, setInterim] = useState('');
  const { mathMode } = useVoiceSettings();

  const insert = useCallback(
    (text: string) => {
      const el = ref.current;
      const current = value || '';
      if (!el || el.selectionStart == null) {
        onChange((current ? `${current} ` : '') + text);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const spacer = before && !/\s$/.test(before) ? ' ' : '';
      const next = `${before}${spacer}${text}${after}`;
      onChange(next);
      requestAnimationFrame(() => {
        const pos = before.length + spacer.length + text.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [onChange, value],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <textarea
          ref={ref}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={cn(
            'w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-y transition-all',
            className,
          )}
        />
        <MicButton onText={insert} onInterim={setInterim} />
      </div>

      {interim && (
        <p className="text-xs text-indigo-500 italic px-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />
          {interim}
          {mathMode && <span className="ml-2 text-slate-400">(maths mode)</span>}
        </p>
      )}

      {showPreview && value && /\$/.test(value) && (
        <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-700 overflow-x-auto">
          <MathText text={value} />
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Voice-enabled single-line input                                     */
/* ------------------------------------------------------------------ */

interface VoiceFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  micSize?: 'sm' | 'md';
}

export const VoiceField: React.FC<VoiceFieldProps> = ({
  value,
  onChange,
  placeholder,
  className,
  micSize = 'sm',
}) => {
  const ref = useRef<HTMLInputElement>(null);

  const insert = useCallback(
    (text: string) => {
      const el = ref.current;
      const current = value || '';
      if (!el || el.selectionStart == null) {
        onChange((current ? `${current} ` : '') + text);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const spacer = before && !/\s$/.test(before) ? ' ' : '';
      onChange(`${before}${spacer}${text}${after}`);
    },
    [onChange, value],
  );

  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        ref={ref}
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none',
          className,
        )}
      />
      <MicButton onText={insert} size={micSize} />
    </div>
  );
};
