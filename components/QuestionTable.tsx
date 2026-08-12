/**
 * QuestionTable — the review screen before the paper is generated.
 *
 * The author sets CO. RBT arrives pre-filled from classifyRbt but is a
 * dropdown, not a label: low-confidence rows are flagged, and the reasoning
 * is shown so the choice can be checked rather than trusted.
 *
 *   <QuestionTable
 *     part="A"
 *     questions={partA}
 *     onChange={setPartA}
 *     courseOutcomes={['CO1','CO2','CO3','CO4','CO5']}
 *   />
 */
import React, { useEffect, useMemo } from 'react';
import { classifyRbt, analysePaper, RBT_LABELS, RbtLevel } from '../lib/bloom';
import MathText from './MathText';
import './QuestionTable.css';

export interface TableQuestion {
  id: string;
  text: string;
  co?: string;
  /** "L4". Undefined until the suggestion is applied. */
  rbt?: string;
  /** Set once the author has explicitly chosen, so re-suggesting won't override. */
  rbtConfirmed?: boolean;
}

interface QuestionTableProps {
  part: string;
  questions: TableQuestion[];
  onChange: (next: TableQuestion[]) => void;
  courseOutcomes?: string[];
  startNumber?: number;
}

const RBT_OPTIONS: RbtLevel[] = [1, 2, 3, 4, 5, 6];

export const QuestionTable: React.FC<QuestionTableProps> = ({
  part,
  questions,
  onChange,
  courseOutcomes = ['CO1', 'CO2', 'CO3', 'CO4', 'CO5'],
  startNumber = 1,
}) => {
  // Classify once per text change, not on every render.
  const suggestions = useMemo(
    () => questions.map((q) => classifyRbt(q.text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions.map((q) => q.text).join('\u0000')]
  );

  // Pre-fill RBT for any row the author hasn't set by hand.
  useEffect(() => {
    let changed = false;
    const next = questions.map((question, index) => {
      if (question.rbtConfirmed || question.rbt) return question;
      changed = true;
      return { ...question, rbt: suggestions[index].code };
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  const update = (index: number, patch: Partial<TableQuestion>) => {
    onChange(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const balance = useMemo(
    () =>
      analysePaper(
        questions
          .map((q) => Number((q.rbt ?? '').replace('L', '')) as RbtLevel)
          .filter((l) => l >= 1 && l <= 6)
      ),
    [questions]
  );

  const unsetCo = questions.filter((q) => !q.co).length;

  return (
    <section className="qt">
      <header className="qt-head">
        <h3 className="qt-title">Part {part}</h3>
        <span className="qt-count">
          {questions.length} question{questions.length === 1 ? '' : 's'}
        </span>
      </header>

      <table className="qt-table">
        <thead>
          <tr>
            <th className="qt-num">Q. No</th>
            <th>Questions</th>
            <th className="qt-co">CO</th>
            <th className="qt-rbt">RBT Level</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((question, index) => {
            const suggestion = suggestions[index];
            const overridden =
              question.rbtConfirmed && question.rbt !== suggestion.code;

            return (
              <tr key={question.id} className={suggestion.needsReview && !question.rbtConfirmed ? 'qt-review' : ''}>
                <td className="qt-num">{startNumber + index}</td>

                <td className="qt-question">
                  <MathText value={question.text} />
                  <p className="qt-why">
                    {suggestion.reasoning}
                    {suggestion.alternative && (
                      <>
                        {' — or '}
                        <button
                          type="button"
                          className="qt-alt"
                          onClick={() =>
                            update(index, {
                              rbt: suggestion.alternative!.code,
                              rbtConfirmed: true,
                            })
                          }
                        >
                          {suggestion.alternative.code}
                        </button>
                        {`, since ${suggestion.alternative.reason}`}
                      </>
                    )}
                  </p>
                </td>

                <td className="qt-co">
                  <select
                    className={`qt-select${question.co ? '' : ' qt-empty'}`}
                    value={question.co ?? ''}
                    onChange={(e) => update(index, { co: e.target.value })}
                    aria-label={`Course outcome for question ${startNumber + index}`}
                  >
                    <option value="">—</option>
                    {courseOutcomes.map((co) => (
                      <option key={co} value={co}>
                        {co}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="qt-rbt">
                  <select
                    className="qt-select"
                    value={question.rbt ?? suggestion.code}
                    onChange={(e) => update(index, { rbt: e.target.value, rbtConfirmed: true })}
                    aria-label={`RBT level for question ${startNumber + index}`}
                  >
                    {RBT_OPTIONS.map((level) => (
                      <option key={level} value={`L${level}`}>
                        L{level} · {RBT_LABELS[level]}
                      </option>
                    ))}
                  </select>
                  <span className="qt-flag">
                    {overridden
                      ? 'set by you'
                      : suggestion.needsReview
                        ? 'check this'
                        : `${Math.round(suggestion.confidence * 100)}% match`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="qt-foot">
        {unsetCo > 0 && (
          <p className="qt-todo">
            {unsetCo} question{unsetCo === 1 ? '' : 's'} still {unsetCo === 1 ? 'needs' : 'need'} a CO.
          </p>
        )}
        {balance.warnings.map((warning) => (
          <p className="qt-todo" key={warning}>
            {warning}
          </p>
        ))}
        <p className="qt-spread">
          Spread:{' '}
          {Object.keys(balance.counts).length
            ? Object.entries(balance.counts)
                .sort()
                .map(([code, n]) => `${code}×${n}`)
                .join('  ')
            : '—'}
        </p>
      </footer>
    </section>
  );
};

export default QuestionTable;
