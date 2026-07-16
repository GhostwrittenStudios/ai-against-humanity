// Core game engine: round flow, card pools, bots.

import { generateWhiteCards, generateBlackCards } from "./ollama.js";
import { FALLBACK_WHITE, FALLBACK_BLACK } from "./fallback-cards.js";

const HAND_SIZE = 10;
const WHITE_BATCH = 18;
const BLACK_BATCH = 8;
const WHITE_LOW_WATER = 8; // top up in background below this

export const BOTS = [
  { id: "rebecca", name: "Rebecca", avatar: "assets/avatars/rebecca.svg" },
  { id: "timothy", name: "Timothy", avatar: "assets/avatars/timothy.svg" },
  { id: "steve",   name: "Steve",   avatar: "assets/avatars/steve.svg" },
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * ui interface (implemented in ui.js):
 *   showTableMessage(text|null), setStatus(html), renderSeats(state),
 *   renderBlackCard(text), renderHand(state), renderSubmissions(state),
 *   revealSubmission(index), markWinnerCard(index),
 *   showRoundWinner(state, submission, isGameOver), showBanner(text|null), toast(text, isError)
 */
export function createGame(getSettings, ui) {
  const state = {
    phase: "lobby", // lobby | generating | picking | judging | roundEnd | gameOver
    round: 0,
    players: [],
    czarIndex: 0,
    blackCard: null,
    hand: [],
    submissions: [], // { playerId, text, revealed }
    targetScore: 7,
    aiDown: false,
    generatingHint: false,
  };

  // ---- card pools ----
  let whitePool = [];
  let blackPool = [];
  const seenWhite = [];
  const seenBlack = [];
  let whiteGenPromise = null;
  let botTimers = [];

  function clearBotTimers() {
    botTimers.forEach(clearTimeout);
    botTimers = [];
  }

  function fallbackRefill() {
    if (whitePool.length < WHITE_LOW_WATER) {
      const fresh = shuffle(FALLBACK_WHITE).filter((c) => !seenWhite.includes(c));
      whitePool.push(...(fresh.length ? fresh : shuffle(FALLBACK_WHITE)));
    }
    if (blackPool.length < 2) {
      const fresh = shuffle(FALLBACK_BLACK).filter((c) => !seenBlack.includes(c));
      blackPool.push(...(fresh.length ? fresh : shuffle(FALLBACK_BLACK)));
    }
  }

  function markAiDown(err) {
    if (!state.aiDown) {
      console.warn("AI generation failed:", err);
      state.aiDown = true;
      const model = getSettings().model;
      ui.showBanner(err && err.status === 404
        ? `⚠ Model "${model}" is not installed on the Ollama server. Run "ollama pull ${model}" in a terminal, or pick an installed model in Settings (⚙). Using the built-in emergency deck for now.`
        : "⚠ Can't reach the AI server — using the built-in emergency deck. Check Settings (⚙), then save to retry.");
    }
    fallbackRefill();
  }

  /** Settings were saved: clear AI-down state so we retry generation. */
  function onSettingsChanged() {
    if (state.aiDown) {
      state.aiDown = false;
      ui.showBanner(null);
    }
    state.targetScore = getSettings().targetScore;
    ui.renderSeats(state);
  }

  async function generateWhiteBatch() {
    if (state.aiDown) { fallbackRefill(); return; }
    if (whiteGenPromise) return whiteGenPromise;
    whiteGenPromise = (async () => {
      try {
        const cards = await generateWithRetry(() => generateWhiteCards(getSettings(), WHITE_BATCH, seenWhite));
        for (const c of cards) {
          if (!seenWhite.includes(c)) { whitePool.push(c); seenWhite.push(c); }
        }
      } catch (err) {
        markAiDown(err);
      } finally {
        whiteGenPromise = null;
      }
    })();
    return whiteGenPromise;
  }

  async function generateBlackBatch() {
    if (state.aiDown) { fallbackRefill(); return; }
    try {
      const cards = await generateWithRetry(() => generateBlackCards(getSettings(), BLACK_BATCH, seenBlack));
      for (const c of cards) {
        if (!seenBlack.includes(c)) { blackPool.push(c); seenBlack.push(c); }
      }
    } catch (err) {
      markAiDown(err);
    }
  }

  /** Small models flake occasionally — try a batch twice before declaring the AI down. */
  async function generateWithRetry(fn) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cards = await fn();
        if (cards.length) return cards;
        lastErr = new Error("empty batch");
      } catch (err) {
        lastErr = err;
        if (err.status === 404) break; // missing model: retrying won't help
      }
    }
    throw lastErr;
  }

  async function drawWhite(n) {
    while (whitePool.length < n) {
      await generateWhiteBatch();
      if (state.aiDown) fallbackRefill();
    }
    return whitePool.splice(0, n);
  }

  async function drawBlack() {
    while (blackPool.length < 1) {
      await generateBlackBatch();
      if (state.aiDown) fallbackRefill();
    }
    // random black card so refills don't feel sequential
    const i = Math.floor(Math.random() * blackPool.length);
    return blackPool.splice(i, 1)[0];
  }

  function topUpInBackground() {
    if (whitePool.length < WHITE_LOW_WATER) generateWhiteBatch();
    if (blackPool.length < 2) generateBlackBatch();
  }

  // ---- save / resume ----
  // Snapshots are taken at round boundaries only, so a resumed game always
  // restarts cleanly at the top of a round (mid-round submissions are not kept).
  const SAVE_KEY = "aah-save";

  function saveGame(resumePoint) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1,
        resumePoint, // "picking" = replay this round | "nextRound" = deal a new one
        round: state.round,
        czarIndex: state.czarIndex,
        scores: Object.fromEntries(state.players.map((p) => [p.id, p.score])),
        targetScore: state.targetScore,
        blackCard: state.blackCard,
        hand: state.hand,
        whitePool, blackPool,
        seenWhite: seenWhite.slice(-80),
        seenBlack: seenBlack.slice(-40),
      }));
    } catch (e) { /* storage full — the game just won't resume */ }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  function readSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.v === 1 && Array.isArray(s.hand) && s.blackCard) return s;
    } catch (e) {}
    return null;
  }

  function hasSavedGame() { return readSave() !== null; }

  // ---- game flow ----

  function buildPlayers(s) {
    return [
      { id: "you", name: s.username, avatar: null, score: 0, isHuman: true },
      ...BOTS.map((b) => ({ ...b, score: 0, isHuman: false })),
    ];
  }

  async function startGame() {
    clearSave();
    const s = getSettings();
    state.targetScore = s.targetScore;
    state.players = buildPlayers(s);
    state.czarIndex = Math.floor(Math.random() * state.players.length);
    state.round = 0;
    state.hand = [];
    state.phase = "generating";
    ui.renderSeats(state);
    ui.renderHand(state);
    ui.renderBlackCard(null);
    ui.renderSubmissions(state);
    ui.setStatus("");
    ui.showTableMessage("The AI is writing the first cards…");

    // kick both generations in parallel
    await Promise.all([generateWhiteBatch(), generateBlackBatch()]);
    state.hand = await drawWhite(HAND_SIZE);
    ui.showTableMessage(null);
    await beginRound();
  }

  async function beginRound() {
    clearBotTimers();
    state.round += 1;
    state.czarIndex = (state.czarIndex + 1) % state.players.length;
    state.submissions = [];
    state.phase = "generating";
    ui.renderSubmissions(state);
    ui.renderSeats(state);

    // refill player's hand
    if (state.hand.length < HAND_SIZE) {
      const need = HAND_SIZE - state.hand.length;
      if (whitePool.length < need) ui.showTableMessage("The AI is writing more cards…");
      state.hand.push(...(await drawWhite(need)));
    }

    if (blackPool.length < 1) ui.showTableMessage("The AI is writing the next black card…");
    state.blackCard = await drawBlack();
    ui.showTableMessage(null);

    saveGame("picking");
    startPicking();
  }

  /** Enter the picking phase for the current round (fresh or resumed). */
  function startPicking() {
    state.phase = "picking";
    ui.renderBlackCard(state.blackCard);
    ui.renderHand(state);
    ui.renderSeats(state);

    const czar = state.players[state.czarIndex];
    if (czar.isHuman) {
      ui.setStatus(`Round ${state.round} — <b>you are the Card Czar</b>. Wait for the others to play.`);
    } else {
      ui.setStatus(`Round ${state.round} — <b>${czar.name}</b> is the Card Czar. Drag a card up to play it.`);
    }

    // schedule bot submissions
    for (const p of state.players) {
      if (p.isHuman || p.id === czar.id) continue;
      const wait = 1500 + Math.random() * 3500;
      botTimers.push(setTimeout(() => botSubmit(p), wait));
    }

    topUpInBackground();
  }

  /** Restore a saved game and drop back into it. */
  async function resumeGame() {
    const s = readSave();
    if (!s) return startGame();
    const set = getSettings();
    state.targetScore = s.targetScore || set.targetScore;
    state.players = buildPlayers(set);
    for (const p of state.players) p.score = s.scores?.[p.id] || 0;
    whitePool = Array.isArray(s.whitePool) ? s.whitePool : [];
    blackPool = Array.isArray(s.blackPool) ? s.blackPool : [];
    seenWhite.length = 0; seenWhite.push(...(s.seenWhite || []));
    seenBlack.length = 0; seenBlack.push(...(s.seenBlack || []));
    state.hand = s.hand;
    state.blackCard = s.blackCard;
    state.czarIndex = s.czarIndex;
    state.round = s.round;
    state.submissions = [];
    state.aiDown = false;
    clearBotTimers();
    ui.showTableMessage(null);
    ui.renderSubmissions(state);
    if (s.resumePoint === "nextRound") {
      ui.renderSeats(state);
      await beginRound();
    } else {
      startPicking();
    }
  }

  async function botSubmit(bot) {
    if (state.phase !== "picking") return;
    let card;
    if (whitePool.length > 0) {
      const i = Math.floor(Math.random() * whitePool.length);
      card = whitePool.splice(i, 1)[0];
    } else {
      card = rand(FALLBACK_WHITE);
    }
    state.submissions.push({ playerId: bot.id, text: card, revealed: false });
    ui.renderSubmissions(state);
    ui.renderSeats(state);
    checkAllSubmitted();
  }

  /** Human plays a card (from drag or zoom modal). */
  function playCard(text) {
    if (state.phase !== "picking") return false;
    const czar = state.players[state.czarIndex];
    if (czar.isHuman) return false;
    if (state.submissions.some((s) => s.playerId === "you")) return false;
    const idx = state.hand.indexOf(text);
    if (idx === -1) return false;
    state.hand.splice(idx, 1);
    state.submissions.push({ playerId: "you", text, revealed: false });
    ui.renderHand(state);
    ui.renderSubmissions(state);
    ui.renderSeats(state);
    ui.setStatus("Card played. Waiting for the others…");
    checkAllSubmitted();
    return true;
  }

  function checkAllSubmitted() {
    const needed = state.players.length - 1;
    if (state.submissions.length < needed) return;
    state.submissions = shuffle(state.submissions);
    state.phase = "judging";
    ui.renderSeats(state);
    ui.renderSubmissions(state);
    const czar = state.players[state.czarIndex];
    if (czar.isHuman) {
      ui.setStatus("<b>You're the Czar.</b> Click each card to reveal it.");
    } else {
      ui.setStatus(`<b>${czar.name}</b> is reading the answers…`);
      botJudge(czar);
    }
  }

  async function botJudge(czar) {
    // flip cards one by one, then "think", then pick
    for (let i = 0; i < state.submissions.length; i++) {
      await delay(900);
      if (state.phase !== "judging") return;
      state.submissions[i].revealed = true;
      ui.revealSubmission(i);
    }
    await delay(1200 + Math.random() * 1500);
    if (state.phase !== "judging") return;
    const winnerIdx = Math.floor(Math.random() * state.submissions.length);
    finishRound(winnerIdx);
  }

  /** Human czar clicked a face-down submission: reveal it. */
  function czarClick(index) {
    if (state.phase !== "judging") return;
    if (!state.players[state.czarIndex].isHuman) return;
    const sub = state.submissions[index];
    if (!sub || sub.revealed) return;
    sub.revealed = true;
    ui.revealSubmission(index);
    if (state.submissions.every((s) => s.revealed)) {
      ui.setStatus("All revealed — <b>tap a card to read it</b> and crown the winner.");
    }
  }

  /** Human czar confirmed a winner (from the zoomed card view). */
  function czarPick(index) {
    if (state.phase !== "judging") return;
    if (!state.players[state.czarIndex].isHuman) return;
    if (!state.submissions[index]) return;
    if (!state.submissions.every((s) => s.revealed)) return;
    finishRound(index);
  }

  function finishRound(winnerIdx) {
    state.phase = "roundEnd";
    const sub = state.submissions[winnerIdx];
    const winner = state.players.find((p) => p.id === sub.playerId);
    winner.score += 1;
    ui.markWinnerCard(winnerIdx);
    ui.renderSeats(state);
    const gameOver = winner.score >= state.targetScore;
    if (gameOver) {
      state.phase = "gameOver";
      clearSave();
    } else {
      saveGame("nextRound");
    }
    setTimeout(() => ui.showRoundWinner(state, sub, gameOver), 1400);
    topUpInBackground();
  }

  function nextRound() {
    if (state.phase === "gameOver") return;
    beginRound();
  }

  return {
    state, startGame, resumeGame, hasSavedGame,
    playCard, czarClick, czarPick, nextRound, onSettingsChanged,
  };
}
