/**
 * Browser entry point: registers the routes, exposes the test hooks and starts the router.
 */
import { navigate, route, startRouter } from "./router.js";
import * as speech from "./speech.js";
import * as state from "./state.js";
import { bankView } from "./views/bank.js";
import { generateView } from "./views/generate.js";
import { homeView } from "./views/home.js";
import { quizView } from "./views/quiz.js";
import { resultsView } from "./views/results.js";
import { settingsView } from "./views/settings.js";
import { sourcesView } from "./views/sources.js";

declare global {
  interface Window {
    __nclex?: {
      speech: { speak: typeof speech.speak; listen: typeof speech.listen; stop: typeof speech.stop };
      state: typeof state;
      navigate: typeof navigate;
    };
  }
}

window.__nclex = {
  speech: { speak: speech.speak, listen: speech.listen, stop: speech.stop },
  state,
  navigate,
};

route("/", "home", "Home", homeView);
route("/quiz", "quiz", "Quiz", quizView);
route("/results", "results", "Results", resultsView);
route("/generate", "generate", "Generate", generateView);
route("/sources", "sources", "Sources", sourcesView);
route("/bank", "bank", "Bank", bankView);
route("/settings", "settings", "Settings", settingsView);

const mount = document.getElementById("app");
if (!mount) throw new Error("index.html is missing the #app element.");
// Settings are needed by most screens; fetching them once up front keeps the first quiz question
// from being read with default voice options.
state.loadSettings().finally(() => startRouter(mount));
