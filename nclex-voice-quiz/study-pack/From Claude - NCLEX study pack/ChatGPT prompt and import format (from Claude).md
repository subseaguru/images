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

- A bare array `[ {...}, {...} ]`, `{ "questions": [...] }`, or the full `{ "version": 1, ... }` form.
- Field aliases: `question` → `stem`; `answer`, `correctAnswer`, `correct_option`, `key` → `correct`;
  `explanation` → `teachingPoint`; `choices` → `options`.
- Options given as plain strings (`"options": ["...", "...", "..."]`) or as an object
  (`{"A": "...", "B": "...", "C": "..."}`); labels are assigned in order. `correct` may be a label,
  an index (`0`-based or `1`-based when unambiguous) or the full text of the right option.
- Per-option explanations given separately (`"rationales": { "A": "...", ... }` or an array in
  option order) are attached to the options.
- Four or more options: the correct option is kept together with the first two distractors, so the
  question becomes A/B/C (the dropped options are listed in the import report).
- Missing `difficulty` → `medium`; missing `references`/`tags` → `[]`.
- Missing `category`, `subtopic`, `clinicalJudgmentStep`, `teachingPoint` or any `rationale`: the
  question is still imported and flagged `needsReview` so you can fill it in by hand in Bank or
  let Claude do it (section 3). Questions whose stem, options or correct answer cannot be
  recovered are rejected with a reason in the import report.
- Duplicates (same stem as a question already in the bank, ignoring case and spacing) are skipped.

## 3. Let Claude finish the job (enrich)

In **Bank**, filter by "needs review" and choose **Enrich with Claude** (or enrich a single
question). Claude reads each question and fills in what is missing without changing the stem or
the correct answer: the NCLEX category and activity statement, the clinical-judgment step, the
difficulty, a rationale for every option (why it is right or wrong) and a teaching point. It also
flags any question whose keyed answer it believes is wrong instead of silently "fixing" it, so you
can decide. Enrichment needs an API key (Settings) and costs roughly the same per question as
generating one.

Large sets: enrich runs in batches of 10 questions; several hundred questions take a few minutes
and you can leave the page open while it works.
