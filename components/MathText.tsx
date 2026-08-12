/**
 * MathText — renders a string that mixes prose and LaTeX.
 *
 * Use it everywhere a question, option or answer is displayed, so the same
 * source text reads correctly in the editor preview and in the exam view.
 *
 *   <MathText value="Evaluate $\int_0^1 x^2\,dx$ and state the units." />
 */
import React, { useMemo } from 'react';
import katex from 'katex';
import { parseMathSegments } from '../lib/latex';

interface MathTextProps {
  value: string;
  className?: string;
}

export const MathText: React.FC<MathTextProps> = ({ value, className = '' }) => {
  const segments = useMemo(() => parseMathSegments(value ?? ''), [value]);

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          // Preserve author line breaks without needing a markdown pass.
          return (
            <span key={index} style={{ whiteSpace: 'pre-wrap' }}>
              {segment.content}
            </span>
          );
        }

        let html: string;
        let failed = false;
        try {
          html = katex.renderToString(segment.content, {
            displayMode: segment.display,
            throwOnError: true,
            strict: 'ignore',
            trust: false,
            output: 'html',
          });
        } catch (err) {
          failed = true;
          html = '';
        }

        if (failed) {
          // Show the raw source rather than a blank space — the author needs
          // to see what didn't compile.
          return (
            <code
              key={index}
              title="This expression could not be rendered"
              style={{
                background: 'rgba(220, 38, 38, 0.1)',
                color: '#b91c1c',
                padding: '0 4px',
                borderRadius: 4,
                fontSize: '0.9em',
              }}
            >
              {segment.display ? `$$${segment.content}$$` : `$${segment.content}$`}
            </code>
          );
        }

        return (
          <span
            key={index}
            style={segment.display ? { display: 'block', margin: '0.6em 0' } : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
};

export default MathText;
