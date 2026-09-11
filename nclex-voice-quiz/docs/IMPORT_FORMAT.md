# Importing questions from ChatGPT or any other source

The Bank page (**Bank → Import JSON**) and the command line (`npm run import -- path/to/file.json`)
accept question sets written by other tools. The safest path is to ask the other tool for the
app's own format (section 1). If you already have questions in a different shape, section 2 lists
what the importer accepts and fixes automatically, and section 3 explains how Claude can fill in
whatever is missing (NCLEX category, rationales, teaching point).

## 1. The native format

```json
{
  "version": 1,
  "questions": [
    {
      "stem": "A nurse is caring for a client who received regular insulin 30 minutes ago and is now sweating, shaky and confused. Which action should the nurse take first?",
      "options": [
        { "label": "A", "text": "Give 15 grams of a fast-acting carbohydrate and recheck the blood glucose in 15 minutes.", "rationale": "Correct. These are signs of hypoglycemia; treating with 15 grams of fast-acting carbohydrate and rechecking in 15 minutes is the standard first response for a client who can swallow safely." },
        { "label": "B", "text": "Administer the scheduled dose of long-acting insulin.", "rationale": "Giving more insulin would lower the blood glucose further and worsen the hypoglycemia." },
        { "label": "C", "text": "Notify the provider and wait for orders before treating.", "rationale": "Hypoglycemia is an emergency the nurse treats immediately under standing protocols; waiting delays care." }
      ],
      "correct": "A",
      "category": "pharmacological_and_parenteral_therapies",
      "subtopic": "Adverse Effects/Contraindications/Side Effects/Interactions",
      "clinicalJudgmentStep": "take_action",
      "difficulty": "medium",
      "teachingPoint": "Treat symptomatic hypoglycemia first (15 grams of carbohydrate, recheck in 15 minutes), then look for the cause.",
      "references": ["YouTube: RegisteredNurseRN - Insulin types"],
      "tags": ["insulin", "hypoglycemia", "diabetes"]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `stem` | yes | The question, plain text (it is read aloud). At least 20 characters. |
| `options` | yes | Exactly three, labels `A`, `B`, `C` in order. Each needs `text`; `rationale` is strongly recommended (why it is right or wrong). |
| `correct` | yes | `"A"`, `"B"` or `"C"`. |
| `category` | recommended | One of the eight ids below. Missing or unknown categories can be filled by Claude (section 3). |
| `subtopic` | recommended | One of the category's activity statements (see `src/shared/blueprint.ts` or the Home page). |
| `clinicalJudgmentStep` | optional | `recognize_cues`, `analyze_cues`, `prioritize_hypotheses`, `generate_solutions`, `take_action`, `evaluate_outcomes`. |
| `difficulty` | optional | `easy`, `medium`, `hard` (default `medium`). |
| `teachingPoint` | optional | One or two sentences with the takeaway. |
| `references`, `tags` | optional | Free text; put the episode or video title in `references`. |
| `id`, `source`, `createdAt` | no | Assigned by the app on import (`source` becomes `imported`). |

Category ids: `management_of_care`, `safety_and_infection_control`,
`health_promotion_and_maintenance`, `psychosocial_integrity`, `basic_care_and_comfort`,
`pharmacological_and_parenteral_therapies`, `reduction_of_risk_potential`,
`physiological_adaptation`.

### Prompt to paste into ChatGPT

> You are an NCLEX-RN item writer. Turn the material I give you into practice questions and answer with **one JSON document only** (no markdown fences, no commentary) in exactly this shape:
>
> `{"version":1,"questions":[{"stem":"...","options":[{"label":"A","text":"...","rationale":"..."},{"label":"B","text":"...","rationale":"..."},{"label":"C","text":"...","rationale":"..."}],"correct":"A","category":"...","subtopic":"...","clinicalJudgmentStep":"...","difficulty":"...","teachingPoint":"...","references":["..."],"tags":["..."]}]}`
>
> Rules: exactly three options labelled A, B, C; exactly one is correct and the others are plausible but clearly inferior; every option has a rationale of one to three sentences that explains why it is right or wrong; the stem is a realistic client scenario ending in one clear question; everything is plain text that reads well aloud (expand abbreviations on first use, write numbers and units naturally, no lists, tables or markdown); `category` is one of: management_of_care, safety_and_infection_control, health_promotion_and_maintenance, psychosocial_integrity, basic_care_and_comfort, pharmacological_and_parenteral_therapies, reduction_of_risk_potential, physiological_adaptation; `subtopic` is the NCLEX-RN activity statement the question tests (for example "Establishing Priorities", "Medication Administration", "Laboratory Values"); `clinicalJudgmentStep` is one of recognize_cues, analyze_cues, prioritize_hypotheses, generate_solutions, take_action, evaluate_outcomes; `difficulty` is easy, medium or hard; `teachingPoint` is the one-sentence takeaway; put the episode or video title in `references`. Balance the correct answers across A, B and C. Use current United States evidence-based practice and do not copy questions from published question banks.
>
> Material: …

Ask for 20-30 questions per reply so the JSON stays complete; save each reply as a `.json` file and
import them one after another (duplicate stems are skipped).

## 2. What the importer accepts and repairs

The importer normalises common variations before validating, so hand-made or ChatGPT-made files
usually import without editing:

- A bare array `[ {...}, {...} ]`, `{ "questions": [...] }`, `{ "items": [...] }`, or the full
  `{ "version": 1, ... }` form.
- Field aliases: `question`, `prompt`, `text` → `stem`; `answer`, `correctAnswer`, `correct_option`,
  `key`, `answerIndex` → `correct`; `explanation`, `takeaway`, `notes` → `teachingPoint`;
  `choices`, `answers` → `options`; `sources` → `references`; `keywords` → `tags`.
- Options given as plain strings (`"options": ["...", "...", "..."]`), as objects
  (`{ "text": "...", "rationale": "..." }`), or as a label map (`{"A": "...", "B": "...", "C": "..."}`);
  the writer's order is kept and labels are reassigned A, B, C in that order.
- `correct` may be a label with any decoration (`"B"`, `"b."`, `"Option B)"`, `"answer: b"`), a
  number (`0` means the first option; `1`, `2`, `3` mean the first, second and third), or the exact
  text of the correct option.
- Per-option explanations given separately (`"rationales": { "A": "..." }` or an array in option
  order) are attached to the options.
- Four or more options: the correct option is kept together with the first two distractors, in
  their original order, so the question becomes A/B/C. The dropped options are listed in the report.
- Markdown emphasis around the stem or options is stripped (`**bold**` → `bold`), since everything
  is read aloud.
- Missing `difficulty` → `medium`; missing `references`/`tags` → `[]`; a valid `createdAt` is kept,
  anything else is stamped at import time. `id` and `source` are always assigned by the app.
- Missing `category` → guessed from the wording by a keyword classifier, and the question is flagged
  **needs review**. Missing activity statement or a missing rationale for any option → also flagged
  (the rationale reads "Rationale not provided yet." until it is filled in). A question missing only
  a teaching point or a clinical-judgment step studies correctly and is **not** flagged; enrichment
  fills those in too when it runs.
- Questions whose stem already exists in the bank (ignoring case, spacing and punctuation) are
  skipped and counted separately from rejections.
- Only a question whose stem, three usable options or correct answer cannot be recovered is
  rejected, with the reason in the import report.

The import report shows: how many were imported, how many were skipped as duplicates, how many need
review, which options were dropped from over-long questions, and why anything was rejected.

### Importing a folder of files from the command line

```bash
npm run import -- "path/to/file1.json" "path/to/file2.json"
```

It writes into the same bank the app reads (`DATA_DIR`, default `./data`) and prints a report per
file. Handy for a few hundred questions arriving in many files; the Bank page's Import button does
exactly the same thing for one file at a time.

## 3. Let Claude finish the job (enrich)

In **Bank**, tick "Needs review only" and press **Enrich with Claude** (or expand a single question
and use its own button). Claude reads each question and fills in what is missing: the NCLEX category
and activity statement, the clinical-judgment step, the difficulty, a rationale for every option and
a teaching point.

What it will not do:

- It never changes the stem, the option texts or the keyed answer. Those are copied from the stored
  question when the answer comes back, so enrichment can only add explanation.
- It never silently re-keys a question. If Claude thinks the keyed answer is wrong, that more than
  one option is defensible, or the question cannot be answered as written, it returns a **concern**:
  that question is left exactly as it was and the concern is shown against it in the Bank page for
  you to judge.
- Rationales you (or the other tool) already wrote are kept; only blanks are filled.

The "needs review" flag clears once nothing is missing. Enrichment needs an API key (Settings) and
runs in batches of ten questions, so several hundred questions take a few minutes; leave the page
open while it works. Token usage is reported when it finishes.
