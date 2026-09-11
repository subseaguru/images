# NCLEX Voice Quiz

A study app for the NCLEX-RN that talks. It reads each question and its three options aloud, listens
for "A", "B" or "C", then says whether you were right **and why** — the wrong answers are explained
as well as the right one. It runs on a computer in your own home; nothing is published to the
internet.

It ships with 96 practice questions covering all eight NCLEX-RN content areas. With an Anthropic API
key it can also write new questions for you — following the NCLEX-RN test plan, aimed at your weak
areas, and grounded in your own study material (lecture notes, a PDF, a page from the web) — and it
can take in question sets you made elsewhere, for example with ChatGPT.

---

## What you need

| | |
|---|---|
| A computer | Windows, Mac or Linux with [Node.js](https://nodejs.org) 20 or newer |
| A browser | Chrome or Edge for **voice answering**. Firefox and Safari read questions aloud but cannot listen (you tap or type instead) |
| A microphone | Any built-in laptop microphone is fine |
| An API key | Only for writing new questions or filling in imported ones. The 96 bundled questions work without one |

## Install and run

```bash
npm install
npm start
```

`npm start` builds the app and starts it. It prints the addresses to open:

```
NCLEX Voice Quiz is running. Open:
  http://localhost:3000
  http://192.168.1.42:3000
Data directory: /home/you/nclex-voice-quiz/data
```

Open the first address in Chrome or Edge on the same computer. Stop the app with Ctrl-C. Next time,
`npm start` again (or `npm run serve`, which skips the rebuild).

### Using it from your phone, tablet or another computer

Open the second address (the one with numbers) on any device on the same home network. Questions are
read aloud there too, but **voice answering will not work** over a plain `http://` address on another
device: browsers only allow the microphone on `localhost` or on a secure (`https://`) connection.

To answer by voice from another device, start the app with HTTPS:

```bash
HTTPS=1 npm start
```

On Windows PowerShell: `$env:HTTPS=1; npm start`.

The app creates its own certificate the first time (stored in `data/cert/`). Because that certificate
is self-signed, the browser shows a warning the first time — choose "Advanced" and continue. After
that, voice answering works from any device on the network.

## First-time setup

1. Open the app and go to **Settings**.
2. **Voice**: pick a voice and speaking speed, then press *Test voice*. Leave "Listen for spoken
   answers" on if you want to answer by talking.
3. **API key** (only if you want the app to write questions): paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com) and press *Save*, then *Verify*. The key is
   stored in `data/settings.json` on your computer and is never shown again, only a hint like
   `sk-ant-…a1b2`. If you prefer, set the environment variable `ANTHROPIC_API_KEY` instead and the
   app will use that.

## Studying

On the **Home** page choose how many questions, optionally which categories, and press *Start quiz*.

Each question is read aloud: "Question 1 of 10 … Option A … Option B … Option C". Then answer:

| How | What to do |
|---|---|
| Voice | Say "A", "B" or "C" — also "alpha", "bravo", "charlie", "the second one", "option B" |
| Tap | Click or tap the option |
| Keyboard | A, B, C or 1, 2, 3 |

Other voice commands: "repeat" (or "say again"), "next", "skip", "stop".
Keyboard: **R** repeat, **N** or **Enter** next, **S** skip, **Esc** stop.

After you answer, a banner says **Correct** or **Wrong**, and the app explains:

- Wrong: why the option you chose is wrong, then what the right answer is and why.
- Correct: why that answer is right.

Every option's rationale stays on screen, along with a teaching point — the rule to remember. Press
*Next* for the following question.

At the end, **Results** show your score, how you did per category, and every question you missed with
its explanations. *Practice weak areas* starts a new quiz focused on the categories you struggled
with. Your history is kept, so the Home page always shows your overall accuracy and weakest areas,
and quizzes quietly favour those areas over time.

If you reload the page mid-quiz, it picks up where you left off.

## Adding your own study material

**Sources** lets you give the app your own material so generated questions come from what you are
actually studying:

- **Paste text** — lecture notes, a summary, anything you typed.
- **Add a URL** — a guideline or article page; the app fetches it and keeps the text.
- **Upload a file** — `.pdf`, `.txt`, `.md` or `.html` (Word files are not supported; copy the text
  out and paste it instead).

Each source shows its size, and you can delete it at any time.

## Letting Claude write questions

On **Generate**, choose how many questions (1–20) and, optionally:

| Option | What it does |
|---|---|
| Categories | Leave empty to follow the real NCLEX-RN mix (more pharmacology and management of care, less basic care, and so on) |
| Difficulty / clinical judgment step | Focus on harder items, or on a thinking step like "recognize cues" |
| Study sources | Tick the sources the questions should be based on |
| Research online | Claude first searches the web for current NCLEX guidance and clinical practice on your topic, then writes |
| Target my weak areas | Weights the new questions toward the categories you get wrong |
| Focus | Free text, e.g. "insulin types and peak times" |

Generation takes roughly one to three minutes (longer with research). New questions are saved to your
bank, tagged **AI generated**, and appear in quizzes immediately. Cost is a few cents' worth of API
usage for a typical batch; the exact token count is shown when it finishes.

## Importing questions made elsewhere (ChatGPT and friends)

**Bank → Import JSON…** takes question sets written by other tools. The importer is forgiving: it
accepts a plain list of questions, common field names (`question`, `answer`, `explanation`,
`choices`), options written as plain strings, answers given as a letter, a number or the text of the
right option, and it trims four-option questions down to three. Questions that arrive without an
NCLEX category or without a rationale for every option are still imported, flagged **needs review**.

For a lot of files at once:

```bash
npm run import -- "path/to/questions1.json" "path/to/questions2.json"
```

Then tick **Needs review only** in the Bank and press **Enrich with Claude**: it fills in the missing
category, activity statement, difficulty, per-option rationales and teaching point. It never changes
the question, the options or which answer is correct — and if it thinks the keyed answer is wrong, it
says so instead of changing it, leaving that question for you to judge.

`docs/IMPORT_FORMAT.md` has the exact format, a prompt you can paste into ChatGPT to get questions in
the right shape, and everything the importer repairs.

The **Bank** page also lets you search and filter all your questions, read their rationales, delete
AI or imported ones (bundled questions cannot be deleted), and export everything as a JSON file.

## The NCLEX-RN blueprint this app follows

Questions are mixed in the proportions of the NCLEX-RN Test Plan effective April 2026, which keeps
the percentage ranges of the 2023 plan:

| Content area | Share of the exam |
|---|---|
| Management of Care | 15–21% |
| Safety and Infection Control | 10–16% |
| Health Promotion and Maintenance | 6–12% |
| Psychosocial Integrity | 6–12% |
| Basic Care and Comfort | 6–12% |
| Pharmacological and Parenteral Therapies | 13–19% |
| Reduction of Risk Potential | 9–15% |
| Physiological Adaptation | 11–17% |

Every question is also tagged with an activity statement from the plan and one of the six
clinical-judgment steps (recognize cues, analyze cues, prioritize hypotheses, generate solutions,
take action, evaluate outcomes).

**One difference from the real exam:** NCLEX questions have four or more options and include formats
this app does not use (select-all-that-apply, matrix, drag-and-drop, case studies). Three spoken
options are a deliberate choice so questions can be answered out loud, hands-free. Use this app to
drill the reasoning and the content; use a full-format question bank to rehearse the exam mechanics.

## Your data and your privacy

Everything lives in the `data` folder next to the app:

| File | What is in it |
|---|---|
| `data/seed/questions/` | The 96 bundled questions (part of the app) |
| `data/questions.json` | Questions you generated or imported |
| `data/attempts.json` | Every answer you have given, for the statistics |
| `data/settings.json` | Your settings **and your API key** |
| `data/sources/` | The study material you added |
| `data/cert/` | The self-signed certificate, if you use HTTPS |

Nothing is uploaded anywhere except when you press Generate or Enrich, which send your request (and
the study sources you ticked) to the Anthropic API. There is no account, no tracking and no other
network traffic. To back up your progress, copy the `data` folder. To start over, delete it.

## Settings you can change from the command line

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Set to `127.0.0.1` to allow only this computer |
| `HTTPS` | off | `HTTPS=1` serves https with a self-signed certificate |
| `DATA_DIR` | `./data` | Where your questions, progress and settings are stored |
| `SEED_DIR` | `./data/seed/questions` | Where the bundled questions are read from |
| `ANTHROPIC_API_KEY` | unset | Overrides the key saved in Settings |

Example: `PORT=8080 HTTPS=1 npm start`

## If something goes wrong

| Problem | Fix |
|---|---|
| No voices in the list | Some systems need a moment after the page loads; reload once. On Linux install a speech engine (e.g. `espeak-ng`) |
| The microphone never starts | Voice answering needs Chrome or Edge, and the page must be on `localhost` or `https://`. Check the browser's microphone permission for the site |
| "Not secure" warning over HTTPS | Expected with a self-signed certificate: choose Advanced and continue. It is your own computer |
| Port already in use | Start with another port: `PORT=3100 npm start` |
| "The Claude API rejected the API key" | Re-paste the key in Settings and press Verify; check it has credit |
| Generation seems stuck | It can take minutes, especially with research on. The page shows the elapsed seconds; errors appear there too |
| Questions do not read aloud | Check "Read questions aloud" in Settings, and that the system volume is up |

## For developers

```
src/shared/    Types and the NCLEX blueprint, used by both the server and the browser
src/server/    Express API: question bank, quiz selection, statistics, sources, settings
src/server/generator/  Claude question generation and enrichment (Anthropic SDK)
src/web/       The browser app: views, speech, API client (plain TypeScript, no framework)
public/        index.html, styles and the compiled browser code
data/seed/     The bundled question bank
tests/         Unit tests (node:test)          e2e/  Browser tests (Playwright)
docs/          API.md, SPEC.md, IMPORT_FORMAT.md
```

```bash
npm run build       # compile server and browser code
npm test            # unit tests
npm run test:e2e    # browser tests (Chromium)
npm run typecheck   # types only
```

`docs/API.md` describes every endpoint, `docs/SPEC.md` the screens and the voice behaviour, and
`docs/IMPORT_FORMAT.md` the import format.
