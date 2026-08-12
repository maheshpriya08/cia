/**
 * QuestionBox — the question input, with dictation and LaTeX in one control.
 *
 *   <QuestionBox
 *     value={question}
 *     onChange={setQuestion}
 *     label="Question"
 *     placeholder="Type or dictate the question. Wrap maths in $…$"
 *   />
 *
 * Drop-in replacement for a plain <textarea>: same value/onChange contract.
 */
import React, { useCallback, useRef, useState } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  SNIPPETS,
  hasBalancedFences,
  insertSnippet,
  speechToLatex,
  wrapMath,
} from '../lib/latex';
import MathText from './MathText';
import './QuestionBox.css';

const DICTATION_LANGUAGES = [
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'ta-IN', name: 'Tamil' },
  { code: 'te-IN', name: 'Telugu' },
  { code: 'hi-IN', name: 'Hindi' },
];

interface QuestionBoxProps {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export const QuestionBox: React.FC<QuestionBoxProps> = ({
  value,
  onChange,
  label = 'Question',
  placeholder = 'Type or dictate the question. Wrap maths in $…$, e.g. $e^{i\\pi}+1=0$',
  rows = 5,
  disabled = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lang, setLang] = useState('en-IN');
  const [mathDictation, setMathDictation] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  // Keep the newest props in a ref so the speech callback never goes stale.
  const stateRef = useRef({ value, onChange, mathDictation });
  stateRef.current = { value, onChange, mathDictation };

  const appendTranscript = useCallback((text: string) => {
    if (!text) return;
    const { value: current, onChange: emit, mathDictation: asMath } = stateRef.current;
    const phrase = asMath ? `$${speechToLatex(text)}$` : text;
    const needsSpace = current.length > 0 && !/\s$/.test(current);
    emit(current + (needsSpace ? ' ' : '') + phrase);
  }, []);

  const { isSupported, isListening, interim, error, toggle } = useSpeechRecognition({
    lang,
    continuous: true,
    onFinalTranscript: appendTranscript,
  });

  const applyToTextarea = useCallback(
    (result: { value: string; caret: number }) => {
      onChange(result.value);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(result.caret, result.caret);
      });
    },
    [onChange]
  );

  const handleSnippet = useCallback(
    (insert: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;

      // If the caret is outside any $…$, open a fence so the snippet renders.
      const before = value.slice(0, start);
      const insideMath = ((before.replace(/\$\$/g, '').match(/\$/g) || []).length % 2) === 1;
      const payload = insideMath ? insert : `$${insert}$`;

      applyToTextarea(insertSnippet(value, start, end, payload));
    },
    [applyToTextarea, value]
  );

  const handleWrap = useCallback(
    (display: boolean) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      applyToTextarea(wrapMath(value, start, end, display));
    },
    [applyToTextarea, value]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      handleWrap(event.shiftKey);
    }
  };

  const balanced = hasBalancedFences(value);

  return (
    <div className="qb">
      <div className="qb-head">
        <label className="qb-label" htmlFor="qb-textarea">
          {label}
        </label>

        <div className="qb-head-actions">
          {isSupported && (
            <>
              <select
                className="qb-select"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={isListening}
                aria-label="Dictation language"
              >
                {DICTATION_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>

              <label className="qb-toggle" title="Convert spoken maths into LaTeX">
                <input
                  type="checkbox"
                  checked={mathDictation}
                  onChange={(e) => setMathDictation(e.target.checked)}
                />
                Maths dictation
              </label>

              <button
                type="button"
                className={`qb-mic${isListening ? ' qb-mic-on' : ''}`}
                onClick={toggle}
                disabled={disabled}
                aria-pressed={isListening}
              >
                <span className="qb-mic-dot" aria-hidden="true" />
                {isListening ? 'Stop dictation' : 'Dictate'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="qb-toolbar" role="toolbar" aria-label="Insert maths">
        <button type="button" className="qb-chip qb-chip-wide" onClick={() => handleWrap(false)}>
          $ inline $
        </button>
        <button type="button" className="qb-chip qb-chip-wide" onClick={() => handleWrap(true)}>
          $$ display $$
        </button>
        <span className="qb-divider" aria-hidden="true" />
        {SNIPPETS.map((group) => (
          <span className="qb-group" key={group.group} title={group.group}>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.label}
                className="qb-chip"
                title={`${item.title} — ${item.insert.replace('|', '')}`}
                onClick={() => handleSnippet(item.insert)}
              >
                {item.label}
              </button>
            ))}
          </span>
        ))}
      </div>

      <textarea
        id="qb-textarea"
        ref={textareaRef}
        className="qb-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="qb-status">
        <span>
          {isListening ? (
            <span className="qb-hearing">
              Listening{interim ? `: ${interim}` : '…'}
            </span>
          ) : (
            <span className="qb-hint">Ctrl+M wraps the selection in maths. Ctrl+Shift+M for a display block.</span>
          )}
        </span>
        <button type="button" className="qb-link" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>

      {error && <p className="qb-error">{error}</p>}
      {!isSupported && (
        <p className="qb-hint">
          Dictation needs Chrome, Edge or Android Chrome on an https address.
        </p>
      )}
      {!balanced && value.includes('$') && (
        <p className="qb-warn">A $ fence is still open — the preview stops rendering until it's closed.</p>
      )}

      {showPreview && (
        <div className="qb-preview">
          <span className="qb-preview-tag">Preview</span>
          {value.trim() ? (
            <MathText value={value} />
          ) : (
            <span className="qb-hint">Your question appears here as students will see it.</span>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionBox;
