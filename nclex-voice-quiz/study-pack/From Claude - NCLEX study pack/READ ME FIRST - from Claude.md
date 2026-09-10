# From Claude — NCLEX study pack (snapshot 2026-09-10)

Everything in this folder was produced by Claude for Michelle's NCLEX-RN preparation. Files made by
ChatGPT or other tools can live alongside it; nothing here depends on them.

## What is in this folder

| File / folder | What it is |
|---|---|
| `NCLEX question bank - readable (from Claude).docx` | 96 practice questions (12 per NCLEX-RN Client Needs subcategory) with A/B/C options, the correct answer, a rationale for every option and a teaching point. Word format for reading, printing or annotating. The same content as the `.md` file. |
| `NCLEX question bank - readable (from Claude).md` | Same questions in plain Markdown (opens in any text editor or on GitHub). |
| `question-bank-json (for the app)/` | The same 96 questions as JSON, one file per category. This is the machine-readable format the NCLEX Voice Quiz app loads and the format the app's Import button expects. |
| `NCLEX-RN 2026 test plan blueprint (from Claude).md` | The NCLEX-RN test plan the app follows: the eight subcategories with their percentage ranges, the activity statements under each, the integrated processes and the six clinical-judgment steps. |
| `ChatGPT prompt and import format (from Claude).md` | A prompt to paste into ChatGPT so it produces questions in the app's format, plus what the app's importer accepts and repairs when the format is different, and how "Enrich with Claude" fills in missing categories and rationales. |
| `app-documentation/` | Technical specs of the app (HTTP API and screen/voice behaviour). Useful for a developer; not needed for studying. |

## Status of the app

The NCLEX Voice Quiz app is a small website you run on a computer at home and open in Chrome or
Edge. It reads each question aloud, listens for "A", "B" or "C" (or a tap/keyboard answer), says
"Correct" or "Wrong" with the reason, and tracks weak areas. It can also generate new questions
with Claude from the NCLEX blueprint and from your own study documents, and import question sets
made elsewhere (for example with ChatGPT).

At the time of this snapshot the app is still being finished and tested. The code lives in the
GitHub repository `subseaguru/images`, branch `claude/nclex-quiz-android-app-1asuvm`, folder
`nclex-voice-quiz/`. A ready-to-run copy with setup instructions will follow when it is complete.

## About the questions

- Written to the 2026 NCLEX-RN test plan (which keeps the 2023 percentage ranges), balanced across
  the six clinical-judgment steps and difficulty levels, and phrased to be read aloud.
- Real NCLEX items have four or more options and several other formats; these use three spoken
  options by design, so use them to practice the reasoning, not the exact exam format.
- Each category file went through a clinical-accuracy review and an adversarial second review;
  the two categories written last (Reduction of Risk Potential, Physiological Adaptation) were
  still in review when this snapshot was taken and may change slightly in the final version.
- Always check anything that surprises you against a current textbook or guideline. These are
  practice items, not an authoritative reference.

## Adding ChatGPT questions to the app later

Save each ChatGPT reply as a `.json` file in this folder (the prompt in the ChatGPT file above makes
ChatGPT produce the right format). In the app, open **Bank → Import JSON** and choose the file, or
run `npm run import -- "path/to/file.json"` from the app folder. Questions with missing categories
or rationales are imported flagged "needs review", and **Enrich with Claude** fills them in.
