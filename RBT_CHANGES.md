# RBT tab — what changed

Added a third tab beside Edit and Preview: **RBT**. The author sets CO; the RBT
level is suggested from the question text and stays editable; the sheet
downloads as a PDF laid out like `RBT_Template.docx`.

## Files added

| File | Purpose |
|---|---|
| `src/lib/bloom.ts` | Revised Bloom's Taxonomy classifier — verb analysis, confidence, alternatives, paper-level balance check |
| `src/lib/page.ts` | Page geometry (A4 landscape, two columns), extracted from `App.tsx` |
| `src/components/RbtTab.tsx` | The tab: mapping editor, printable sheet, PDF export |

## Files changed

**`src/types.ts`** — one optional field on `ExamData`, plus an `RbtMeta` type:

```ts
rbtMap?: Record<string, RbtMeta>;
```

It is optional, so an existing saved draft loads unchanged — the app's
draft-merge already spreads new fields over `INITIAL_DATA`. CO and RBT choices
persist in the same localStorage draft as everything else, with no new
storage key.

**`src/App.tsx`** — four edits:

1. The page-geometry constants (`MM`, `PAGE`, `USABLE_H`, `COL_W`, `mm`) moved
   to `src/lib/page.ts` and are now imported. Nothing about their values
   changed.
2. `paginate()` now calls the shared `countColumns()` helper — same arithmetic,
   one copy instead of two.
3. `activeTab` widened from `'edit' | 'preview'` to include `'rbt'`, with a
   third tab button.
4. The `<main>` branch renders `<RbtTab />` for that tab and widens the
   container to match Preview.

Why the geometry moved rather than being duplicated: the RBT sheet has to
fragment against exactly the same column box as the exam preview. If the two
copies ever drifted apart, a sheet that looked right on screen would overflow
when printed — and that failure is invisible until someone prints it.

## The CO column

CO is a **free-text field**, typed per question. No dropdown and no fixed list:
departments name outcomes their own way — `CO1`, `CO2.3`, `PO4/CO1` — and a
preset list would just be a cage around whatever scheme yours uses.

Anything already typed on the paper is offered back through an HTML
`<datalist>`, so question 2 onwards can autocomplete instead of retyping. It is
a hint attached to a normal text input, never a restriction: type something new
and it is accepted.

## How the RBT level is decided

`classifyRbt()` reads the question's task verbs. Three refinements matter, and
each came from a real question in your MAT338 paper:

- **Position weighting.** An imperative opening a sentence is the task; a verb
  in a subordinate clause ("…, explaining how…") is the method and scores far
  lower. Without this, Q1's "explaining" would drag it down to L2.
- **Maths-sense disambiguation.** "Evaluate $\int_0^1 x^2\,dx$" means compute —
  L3 Apply, not L5 Evaluate. Same for `determine`, `find`, `verify`, `show`,
  `prove`, `derive`. The classifier checks whether the question contains maths
  and re-scores accordingly, offering the other reading as an alternative.
- **"Evaluate how/why".** *"Evaluate how the chain rule operates"* asks for a
  mechanism, so it returns L4, not the L5 the bare verb implies.

Where published rubrics genuinely disagree — `contrast`, `compare`, `outline`,
`construct` — the row is flagged and the alternative offered as one click.

The level is never locked. It is a dropdown, low-confidence rows are amber, and
the reasoning prints under each question. Since this column feeds NBA/NAAC
attainment reporting, a silent wrong answer is worse than an obvious prompt to
check.

## PDF export

`downloadPdf()` captures from a **hidden 1:1 copy** of the sheet, not the
on-screen one. The visible sheet carries a CSS `transform: scale()` to fit the
viewport, and html2canvas rasterises transformed nodes at their transformed
size — capturing it would produce a PDF whose resolution depended on the
browser window width.

Your existing `exportPDF()` on the Preview tab passes `previewRef`, which does
carry that transform. Worth testing separately; if the output looks soft or
mis-sized, that is the cause.

Output is **A4 landscape**, matching the rest of the app. Note that
`RBT_Template.docx` itself is US Letter — say the word if you want Letter here
instead; it is one line in the `jsPDF` options.

## Two things I could not verify

1. **The build.** `npm install` is blocked in my sandbox (the registry returns
   403 `host_not_allowed`), so I could not compile or run the app. The
   React-free modules (`bloom.ts`, `page.ts`, `types.ts`) pass `tsc --strict`
   cleanly, and `RbtTab.tsx` has no syntax errors, but any error that needs
   React's types present is one I could not rule out. Run `npm run dev` and
   tell me what breaks.

2. **CO suggestion.** Not built. Guessing a CO from question text without the
   course's actual CO statements would be a coin flip presented as an answer.
   If CO statements are ever stored per course, matching questions to them
   becomes a real text-similarity problem worth solving — and the field could
   then autocomplete against the full statement rather than only what has been
   typed on this paper.

## Running it

```bash
npm install
npm run dev
```

Open the RBT tab. Type a CO against each question, adjust any RBT level, then
**Download RBT PDF**.
