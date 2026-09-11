# From Claude — NCLEX study pack

Everything in this folder was made by Claude for Michelle's NCLEX-RN preparation. Files made by
ChatGPT or other tools can sit alongside it; nothing here depends on them.

## Start here

| File / folder | What it is |
|---|---|
| `NCLEX question bank - readable (from Claude).docx` | **For studying right now.** 96 practice questions (12 per NCLEX-RN content area) with A/B/C options, the correct answer, a rationale for *every* option and a teaching point. Word format, ready to read or print. |
| `NCLEX question bank - readable (from Claude).md` | The same questions as plain text, for any editor. |
| `nclex-voice-quiz-app (from Claude).zip` | **The talking quiz app.** Unzip it and follow "How to install and run the app". |
| `How to install and run the app (from Claude).md` | Setup and usage: installing, opening it in a browser, using it from a phone, voice commands, generating questions, importing ChatGPT questions. |
| `ChatGPT prompt and import format (from Claude).md` | A prompt to paste into ChatGPT so its questions land in the app's format, and what the importer repairs when the format is different. |
| `question-bank-json (for the app)/` | The 96 questions as JSON, one file per category. Already inside the app; here too in case you want them separately. |
| `NCLEX-RN 2026 test plan blueprint (from Claude).md` | The test plan the questions follow: the eight content areas with their exam percentages, the topics under each, and the six clinical-judgment steps. |
| `app-documentation/` | Technical specifications. Only needed by a developer. |

## The app in one paragraph

It is a small website you run on a computer at home and open in Chrome or Edge. It reads each
question and its three options aloud, listens for "A", "B" or "C" (tapping and the keyboard work
too), then says **Correct** or **Wrong** and explains why — including why the option you picked was
wrong. It tracks which content areas you are weakest in and steers later quizzes toward them. With
an Anthropic API key it also writes new questions following the NCLEX-RN test plan, based on study
material you give it (notes, a PDF, a web page), and it can take in question sets made with ChatGPT
and fill in any missing categories or explanations.

Install: unzip the app, open a terminal in that folder, run `npm install` then `npm start`, and open
the address it prints. The 96 bundled questions work with no API key.

## About the questions

- Written to the 2026 NCLEX-RN test plan, which keeps the 2023 percentage ranges. Balanced across
  the six clinical-judgment steps and across difficulty.
- Every category went through a clinical-accuracy review and a second, adversarial review that
  argued for the distractors; 67 items were amended as a result and one ambiguous question was
  rewritten.
- Phrased to be read aloud: abbreviations expanded, numbers written out, no tables or lists.
- Real NCLEX items have four or more options and other formats (select-all-that-apply, matrix, case
  studies). Three spoken options are a deliberate choice so questions can be answered hands-free.
  Use these to drill the reasoning; use a full-format bank to rehearse exam mechanics.
- Check anything that surprises you against a current textbook or guideline. These are practice
  items, not an authoritative reference.

## Adding the ChatGPT questions

Save each ChatGPT reply as a `.json` file (the prompt in the ChatGPT file above produces the right
shape). Then either open the app and use **Bank → Import JSON…**, or run
`npm run import -- "path/to/file.json"` in the app folder. Questions missing a category or
explanations are imported and flagged "needs review"; **Enrich with Claude** in the Bank fills them
in without ever changing the question or its correct answer.

## Where this came from

The app's source code also lives in the GitHub repository `subseaguru/images`, on the branch
`claude/nclex-quiz-android-app-1asuvm`, in the folder `nclex-voice-quiz/`.
