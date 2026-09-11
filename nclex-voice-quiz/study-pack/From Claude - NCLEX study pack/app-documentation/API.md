# NCLEX Voice Quiz - HTTP API contract

All endpoints are under `/api`, speak JSON (`Content-Type: application/json`) unless noted, and are
served by the Express app in `src/server/app.ts`. Types referenced below live in
`src/shared/types.ts`. Errors are `{ "error": "<human readable message>", "code"?: "<machine code>" }`
with an appropriate 4xx/5xx status. Unknown `/api/*` paths return 404 JSON; everything else falls
through to the static site in `public/` (single page app: `index.html`).

Storage lives in the data directory (`DATA_DIR` env, default `./data`):

| Path | Contents |
|---|---|
| `data/seed/questions/*.json` | Bundled question bank (`QuestionFile`), read-only, in git |
| `data/questions.json` | Generated + imported questions (`QuestionFile`) |
| `data/attempts.json` | `{ version: 1, attempts: Attempt[] }` |
| `data/settings.json` | Persisted `Settings` plus the API key (`apiKey`) - never served to the browser |
| `data/sources/index.json` | `{ version: 1, sources: StudySource[] }` |
| `data/sources/<id>.txt` | Extracted text of each study source |

The seed directory defaults to `<project>/data/seed/questions` (relative to the project root, not
`DATA_DIR`) and can be overridden with the `SEED_DIR` environment variable, so tests can point
`DATA_DIR` at a temp folder and `SEED_DIR` at a small fixture bank.

Server environment variables: `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR`, `SEED_DIR`,
`HTTPS` (`1` serves HTTPS with a self-signed certificate cached in `DATA_DIR/cert/`),
`ANTHROPIC_API_KEY` (takes precedence over the key saved in settings).

## Health & blueprint

### `GET /api/health`
`{ ok: true, version: string, hasApiKey: boolean, questionCount: number }`

### `GET /api/blueprint`
Returns `Blueprint` (from `src/shared/blueprint.ts`).

## Questions

### `GET /api/questions?category=&source=&difficulty=&q=&needsReview=1`
Filters are optional and may repeat (`?category=a&category=b`). `q` is a case-insensitive substring
match on stem/option text. `needsReview=1` returns only questions the importer flagged. Response:
```json
{ "questions": Question[], "counts": { "total": n, "bySource": { "bundled": n, "ai": n, "imported": n }, "byCategory": { "<CategoryId>": n } } }
```
`counts` always describes the whole bank (unfiltered).

### `GET /api/questions/:id` -> `Question` (404 if unknown)

### `DELETE /api/questions/:id` -> `{ ok: true }`
Only `ai` and `imported` questions can be deleted (400 for bundled). Deleting also removes nothing
from attempts (history is kept).

### `POST /api/questions/import`
Body: `QuestionFile`, `{ questions: [...] }`, or a bare array. Entries are repaired by
`src/server/questions/normalize.ts` (field aliases, options as strings or a label map, the answer as
a label, index or text, more than three options trimmed to the correct one plus the first two
distractors, markdown stripped) and then validated. A question missing its category, activity
statement or a rationale is imported with `needsReview: true` (its category guessed by
`src/server/questions/classify.ts`) rather than rejected; only a question whose stem, three usable
options or correct answer cannot be recovered is rejected. Questions whose stem already exists in
the bank are skipped. Saved with `source: "imported"` and a fresh id; a valid `createdAt` is kept.
Response: `ImportResponse` = `{ imported, skippedDuplicates, rejected: [{ index, errors }],
needsReview, dropped: [{ index, options }] }`. The same pipeline backs `npm run import -- <files>`
(`src/server/cli/import.ts`).

### `POST /api/questions/enrich`
Body: `{ ids: string[] }` or `{ all: true }` (every `needsReview` question). Asks Claude to fill in
the category, activity statement, clinical-judgment step, difficulty, a rationale for every option
and a teaching point, in batches of 10. The stem, option texts and keyed answer are always copied
from the stored question, never from the model, and values the author supplied are kept; the
`needsReview` flag clears only when nothing is missing. A question Claude has a concern about (the
key looks wrong, more than one option is defensible, the question is unanswerable) is left
untouched and returned in `flagged`. Same `no_api_key` handling as `/api/generate`, and the request
timeout is disabled. Response: `EnrichResponse` = `{ updated, flagged: [{ id, concern }], warnings,
model, usage }`.

Validation rules (also used for generated questions):
- `stem` non-empty (>= 20 chars), plain text
- exactly 3 `options` with labels `A`, `B`, `C` in order; each `text` and `rationale` non-empty
- `correct` is one of the labels
- `category` is a known `CategoryId`; `difficulty` a known `Difficulty`; `clinicalJudgmentStep` (if present) known
- `subtopic` non-empty
- option texts are distinct (case-insensitive)

## Quiz

### `POST /api/quiz/start`
Body: `QuizStartRequest`. Selects `count` questions (1..50, clamped) from the bank:
1. Filter by `categories`, `sources`, `difficulty` when provided.
2. Decide how many questions each category gets with `blueprintDistribution(count, categories)`;
   when `adaptive !== false` and `/api/stats` reports weak categories, move up to 40% of the
   quota toward the weak categories (never below 1 for a category that had a quota).
3. Within a category prefer questions not answered in the last 7 days (`avoidRecent !== false`),
   then random order. If a category has too few questions, fill from the other allowed categories.
4. If the whole bank has fewer questions than requested, return what exists (never error on a
   non-empty bank; 400 `no_questions` only when nothing matches).
Response: `QuizStartResponse` with questions in play order (categories interleaved/shuffled, not
grouped). `sessionId` is a fresh random id.

### `POST /api/attempts`
Body: `AttemptRequest`. The server looks up the question, grades it, appends an `Attempt` to
`attempts.json` and returns `AttemptResponse`. 404 if the question is unknown.

### `GET /api/sessions/:sessionId`
`{ sessionId, attempts: Attempt[], summary: SessionSummary }` (404 if no attempts for that id).

### `GET /api/stats` -> `Stats`
### `DELETE /api/stats` -> `{ ok: true }` (clears all attempts)

## Study sources

### `GET /api/sources` -> `{ sources: StudySource[] }` (newest first)
### `GET /api/sources/:id` -> `{ source: StudySource, text: string }`
### `POST /api/sources`  body `{ name: string, text: string }` -> `StudySource` (201)
### `POST /api/sources/url` body `{ url: string }` -> `StudySource` (201)
Fetches the page (http/https only, 20 s timeout, 10 MB max), strips scripts/styles/tags, collapses
whitespace, and stores the text. `name` defaults to the page `<title>` or the URL.
### `PUT /api/sources/upload?name=<filename>`
Raw body (`express.raw`, any content type, 25 MB limit). `.pdf` is converted with `pdf-parse`;
everything else is treated as UTF-8 text (`.txt`, `.md`, `.csv`, `.html` - HTML is stripped like
`/url`). Returns `StudySource` (201). 415 for binary formats that are not PDF (e.g. `.docx`).
### `DELETE /api/sources/:id` -> `{ ok: true }`

## Settings

### `GET /api/settings` -> `Settings`
### `PUT /api/settings`
Body: partial `{ model?, voice?: Partial<VoiceSettings>, defaultCount? }`; merged and returned as
`Settings`. Defaults: model `claude-opus-5`, voice `{ enabled: true, rate: 1, autoListen: true,
readRationale: true }`, defaultCount `10`.
### `PUT /api/settings/api-key` body `{ apiKey: string }` -> `Settings`
Stored in `settings.json`. 400 if empty. When `ANTHROPIC_API_KEY` is set in the environment it
takes precedence and this endpoint returns 409 `api_key_from_env`.
### `DELETE /api/settings/api-key` -> `Settings`
### `POST /api/settings/verify-key` -> `{ ok: boolean, error?: string, model: string }`
Calls `verifyApiKey` from the generator with the effective key and configured model.

## Generation

### `POST /api/generate`
Body: `GenerateRequest`. Resolves the effective API key (env, else settings; 400 `no_api_key` with a
helpful message when neither is set), loads the selected sources' text, loads stats when
`targetWeakAreas`, collects existing stems, and calls `generateQuestions` from
`src/server/generator/index.ts`. Generated questions are validated; invalid ones are dropped with a
warning. When `save !== false` the valid questions are appended to `questions.json`.
Response: `GenerateResponse`. `GeneratorError` maps to its `status`; other errors 500.
Generation can take a few minutes: the server disables the request timeout for this route.

## Static site
`GET /` serves `public/index.html`; `public/js/**` is the compiled browser code
(`tsc -p tsconfig.web.json`). Unknown non-API paths also serve `index.html` (client-side routing
uses the URL hash, so this is only a convenience).
