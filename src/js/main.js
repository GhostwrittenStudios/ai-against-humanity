// Boot: wire settings, UI, and game together.

import { settings, initSettingsUI } from "./settings.js";
import { listModels, testConnection } from "./ollama.js";
import { createUI } from "./ui.js";
import { createGame } from "./game.js";

const ui = createUI();
const game = createGame(() => settings, ui);
ui.bindGame(game);
window.AAH = { game, settings }; // debug handle

initSettingsUI({
  listModels,
  testConnection,
  onSaved: () => {
    ui.toast("Settings saved.");
    game.onSettingsChanged();
  },
});

document.getElementById("start-target-score").textContent = settings.targetScore;

const startBtn = document.getElementById("btn-start");
const continueBtn = document.getElementById("btn-continue");

function refreshStartButtons() {
  const hasSave = game.hasSavedGame();
  continueBtn.classList.toggle("hidden", !hasSave);
  startBtn.textContent = hasSave ? "New Game" : "Start Game";
  startBtn.disabled = false;
  continueBtn.disabled = false;
}
refreshStartButtons();

function enterGame(fn) {
  startBtn.disabled = true;
  continueBtn.disabled = true;
  document.getElementById("start-target-score").textContent = settings.targetScore;
  ui.showGameScreen();
  fn();
}

startBtn.addEventListener("click", () => enterGame(() => game.startGame()));
continueBtn.addEventListener("click", () => enterGame(() => game.resumeGame()));

// game over -> back to the start screen
document.getElementById("btn-menu").addEventListener("click", () => {
  document.getElementById("winner-overlay").classList.add("hidden");
  document.getElementById("screen-game").classList.add("hidden");
  document.getElementById("screen-start").classList.remove("hidden");
  document.getElementById("round-indicator").classList.add("hidden");
  refreshStartButtons();
});

// friendly pre-flight hint on the start screen
(async () => {
  const hint = document.getElementById("start-hint");
  const res = await testConnection(settings.ollamaUrl, settings.model);
  hint.textContent = res.ok
    ? `AI ready: ${settings.model}`
    : `⚠ ${res.message} Open Settings (⚙) — without it you'll get the small built-in deck.`;
})();
