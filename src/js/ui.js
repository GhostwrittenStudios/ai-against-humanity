// Rendering + interaction: seats, hand, drag-to-play, zoom modal, overlays.

import { userAvatarSrc } from "./settings.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SEAT_CLASSES = ["seat-bottom", "seat-left", "seat-top", "seat-right"];

/** Shrink a card's font until its text fits (AI card lengths are unpredictable). */
function fitCardText(el) {
  el.classList.add("fit-text");
  el.style.fontSize = "";
  let size = parseFloat(getComputedStyle(el).fontSize);
  const MIN = 8;
  let guard = 40;
  while (size > MIN && guard-- > 0 &&
         (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
    size -= 0.5;
    el.style.fontSize = size + "px";
  }
}

// refit visible cards when the window/orientation changes
let refitTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    document.querySelectorAll(".fit-text").forEach(fitCardText);
  }, 150);
});

export function createUI() {
  let game = null; // bound after creation (circular dependency)

  // ================= seats =================
  function renderSeats(state) {
    document.querySelectorAll(".seat").forEach((el) => el.remove());
    const area = $("table-area");
    state.players.forEach((p, i) => {
      const seat = document.createElement("div");
      seat.className = `seat ${SEAT_CLASSES[i]}`;
      seat.dataset.playerId = p.id;
      const isCzar = state.czarIndex === i && state.phase !== "lobby" && state.phase !== "generating";
      if (isCzar) seat.classList.add("czar");

      const img = document.createElement("img");
      img.className = "avatar";
      img.src = p.isHuman ? userAvatarSrc() : p.avatar;
      img.alt = p.name;
      seat.appendChild(img);

      if (isCzar) {
        const badge = document.createElement("div");
        badge.className = "czar-badge";
        badge.textContent = "\u{1F451}"; // crown
        seat.appendChild(badge);
      }

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = p.isHuman ? `${p.name} (you)` : p.name;
      seat.appendChild(name);

      const score = document.createElement("div");
      score.className = "score";
      score.textContent = `★ ${p.score}`;
      seat.appendChild(score);

      const status = document.createElement("div");
      status.className = "seat-status";
      if (state.phase === "picking" && !isCzar) {
        const submitted = state.submissions.some((s) => s.playerId === p.id);
        status.textContent = submitted ? "played ✓" : "thinking…";
        if (submitted) status.classList.add("submitted");
      } else if (state.phase === "judging" && isCzar) {
        status.textContent = "judging…";
      }
      seat.appendChild(status);

      area.appendChild(seat);
    });
    $("round-indicator").classList.toggle("hidden", state.round === 0);
    $("round-indicator").textContent = `Round ${state.round}`;
  }

  // ================= black card =================
  function renderBlackCard(text) {
    const slot = $("black-card-slot");
    slot.innerHTML = "";
    if (!text) return;
    const card = document.createElement("div");
    card.className = "card black-card";
    card.textContent = text;
    card.title = "Tap to zoom";
    card.addEventListener("click", () => openZoom(text, true, true));
    slot.appendChild(card);
    fitCardText(card);
  }

  // ================= submissions on table =================
  function renderSubmissions(state) {
    const area = $("submission-area");
    area.innerHTML = "";
    const humanCzar = state.players[state.czarIndex]?.isHuman;
    state.submissions.forEach((sub, i) => {
      const el = document.createElement("div");
      el.className = "submission";
      if (sub.revealed) el.classList.add("revealed");
      if (state.phase === "judging" && humanCzar) el.classList.add("pickable");

      const inner = document.createElement("div");
      inner.className = "flip-inner";
      const back = document.createElement("div");
      back.className = "face back";
      back.textContent = "?";
      const front = document.createElement("div");
      front.className = "face front card white-card";
      front.style.width = "100%";
      front.style.height = "100%";
      front.textContent = sub.text;
      inner.appendChild(back);
      inner.appendChild(front);
      el.appendChild(inner);

      el.addEventListener("click", () => {
        const st = game.state;
        const czarIsHuman = st.players[st.czarIndex]?.isHuman;
        if (st.phase === "judging" && czarIsHuman && st.submissions.every((s) => s.revealed)) {
          // all revealed: zoom to read, crown from there (prevents accidental picks)
          openZoom(st.submissions[i].text, true, false, i);
        } else {
          game.czarClick(i); // face-down: flip it
        }
      });
      area.appendChild(el);
      fitCardText(front);
    });
  }

  function revealSubmission(index) {
    const el = $("submission-area").children[index];
    if (el) el.classList.add("revealed");
  }

  function markWinnerCard(index) {
    const el = $("submission-area").children[index];
    if (!el) return;
    el.classList.add("winner-pick");
    const crown = document.createElement("div");
    crown.className = "crown";
    crown.textContent = "\u{1F451}";
    el.appendChild(crown);
  }

  // ================= hand + drag =================
  const PLAY_DRAG_DISTANCE = 90;
  const CLICK_SLOP = 8;

  function renderHand(state) {
    const hand = $("hand");
    hand.innerHTML = "";
    const czarTurn = state.players[state.czarIndex]?.isHuman && state.phase !== "lobby";
    const alreadyPlayed = state.submissions.some((s) => s.playerId === "you");
    const disabled = state.phase !== "picking" || czarTurn || alreadyPlayed;

    if (!state.hand.length && state.phase !== "lobby") {
      const note = document.createElement("div");
      note.className = "hand-empty-note";
      note.textContent = "Waiting for cards…";
      hand.appendChild(note);
      return;
    }

    state.hand.forEach((text) => {
      const card = document.createElement("div");
      card.className = "card white-card hand-card";
      if (disabled) card.classList.add("disabled");
      card.textContent = text;
      attachCardPointer(card, text, () => card.classList.contains("disabled"));
      hand.appendChild(card);
      fitCardText(card);
    });
  }

  function attachCardPointer(card, text, isDisabled) {
    card.addEventListener("pointerdown", (e) => {
      if (isDisabled() || e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      let ghost = null;
      let moved = false; // moved past slop without becoming a vertical drag (e.g. scrolling)

      const onMove = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!ghost && Math.hypot(dx, dy) > CLICK_SLOP) {
          moved = true;
          // only lift the card for a mostly-vertical drag; sideways = deck scroll
          if (Math.abs(dy) > Math.abs(dx)) {
            ghost = card.cloneNode(true);
            ghost.id = "drag-ghost";
            ghost.classList.remove("hand-card");
            document.body.appendChild(ghost);
            card.style.opacity = "0.3";
            document.body.classList.add("drag-active");
          }
        }
        if (ghost) {
          ghost.style.left = ev.clientX + "px";
          ghost.style.top = ev.clientY + "px";
        }
      };

      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("drag-active");
        if (ghost) {
          ghost.remove();
          card.style.opacity = "";
          const liftedUp = startY - ev.clientY > PLAY_DRAG_DISTANCE;
          if (liftedUp && ev.type !== "pointercancel") game.playCard(text);
        } else if (!moved && ev.type !== "pointercancel") {
          openZoom(text, isDisabled());
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  // ================= zoom modal =================
  function openZoom(text, disabled, isBlack = false, judgeIndex = null) {
    const overlay = $("zoom-overlay");
    const card = $("zoom-card");
    const isJudge = judgeIndex !== null;
    card.textContent = text;
    card.classList.toggle("black-card", isBlack);
    card.classList.toggle("white-card", !isBlack);
    $("zoom-play").disabled = isJudge ? false : disabled;
    $("zoom-play").classList.toggle("hidden", isBlack);
    $("zoom-play").textContent = isJudge ? "\u{1F451} Crown this card" : "Play this card";
    $("zoom-back").textContent = isBlack || isJudge ? "Close" : "Back to hand";
    document.querySelector(".zoom-hint").textContent = isBlack
      ? "Drag away (or click outside) to close"
      : isJudge
        ? "Drag up to crown · drag down (or click outside) to keep reading"
        : "Drag up to play · drag down (or click outside) to return";
    overlay.dataset.black = isBlack ? "1" : "";
    overlay.dataset.judgeIndex = isJudge ? String(judgeIndex) : "";
    overlay.classList.remove("hidden");
    overlay.dataset.cardText = text;
    fitCardText(card);
  }

  function closeZoom() {
    $("zoom-overlay").classList.add("hidden");
  }

  function initZoom() {
    const overlay = $("zoom-overlay");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeZoom(); });
    $("zoom-back").addEventListener("click", closeZoom);
    $("zoom-play").addEventListener("click", () => {
      if (overlay.dataset.judgeIndex !== "") {
        closeZoom();
        game.czarPick(Number(overlay.dataset.judgeIndex));
      } else if (game.playCard(overlay.dataset.cardText)) {
        closeZoom();
      }
    });

    // drag up on the big card to play, down to return
    const card = $("zoom-card");
    card.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        card.style.transform = `translateY(${dy}px) rotate(${dy / 40}deg)`;
      };
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        card.style.transform = "";
        const dy = ev.clientY - startY;
        if (dy < -80) {
          if (overlay.dataset.black) {
            closeZoom();
          } else if (overlay.dataset.judgeIndex !== "") {
            closeZoom();
            game.czarPick(Number(overlay.dataset.judgeIndex));
          } else if (!$("zoom-play").disabled && game.playCard(overlay.dataset.cardText)) {
            closeZoom();
          }
        } else if (dy > 80) {
          closeZoom();
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  // ================= winner overlay =================
  function buildFilledBlack(blackText, whiteText) {
    const el = $("winner-black");
    el.innerHTML = "";
    if (blackText.includes("_____")) {
      const [before, after] = blackText.split("_____");
      el.appendChild(document.createTextNode(before));
      const fill = document.createElement("span");
      fill.style.color = "var(--accent)";
      fill.style.textDecoration = "underline";
      let answer = whiteText.replace(/\.$/, "");
      // lowercase the answer when the blank sits mid-sentence
      const lead = before.trim();
      if (lead && !/[.!?]$/.test(lead)) answer = answer.charAt(0).toLowerCase() + answer.slice(1);
      fill.textContent = answer;
      el.appendChild(fill);
      el.appendChild(document.createTextNode(after));
    } else {
      el.textContent = blackText;
    }
  }

  function showRoundWinner(state, sub, gameOver) {
    const winner = state.players.find((p) => p.id === sub.playerId);
    const isYou = winner.isHuman;
    const name = isYou ? "You" : winner.name;
    $("winner-title").innerHTML = gameOver
      ? `\u{1F3C6} <span class="highlight">${esc(name)}</span> win${isYou ? "" : "s"} the game!`
      : `<span class="highlight">${esc(name)}</span> win${isYou ? "" : "s"} the round!`;

    buildFilledBlack(state.blackCard, sub.text);
    $("winner-white").textContent = sub.text;

    const scores = $("winner-scores");
    scores.innerHTML = "";
    const top = Math.max(...state.players.map((p) => p.score));
    state.players.forEach((p) => {
      const span = document.createElement("span");
      span.textContent = `${p.isHuman ? p.name + " (you)" : p.name}: ${p.score}`;
      if (p.isHuman) span.classList.add("me");
      if (p.score === top && top > 0) span.classList.add("leader");
      scores.appendChild(span);
    });

    $("btn-next-round").textContent = gameOver ? "Play Again" : "Next Round";
    $("btn-menu").classList.toggle("hidden", !gameOver);
    $("winner-overlay").classList.remove("hidden");
    fitCardText($("winner-black"));
    fitCardText($("winner-white"));
  }

  function initWinnerOverlay() {
    $("btn-next-round").addEventListener("click", () => {
      $("winner-overlay").classList.add("hidden");
      if (game.state.phase === "gameOver") {
        game.startGame();
      } else {
        game.nextRound();
      }
    });
  }

  // ================= misc =================
  function showTableMessage(text) {
    const el = $("table-message");
    if (!text) { el.classList.add("hidden"); return; }
    el.innerHTML = `<span class="spinner"></span>${esc(text)}`;
    el.classList.remove("hidden");
  }

  function setStatus(html) {
    $("status-line").innerHTML = html; // only trusted, code-built strings
  }

  function showBanner(text) {
    const el = $("connection-banner");
    if (!text) { el.classList.add("hidden"); return; }
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function toast(text, isError = false) {
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = text;
    $("toast-holder").appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function showGameScreen() {
    $("screen-start").classList.add("hidden");
    $("screen-game").classList.remove("hidden");
  }

  // mouse wheel scrolls the hand horizontally on desktop
  $("hand-scroller").addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      $("hand-scroller").scrollLeft += e.deltaY;
    }
  }, { passive: false });

  initZoom();
  initWinnerOverlay();

  return {
    bindGame: (g) => { game = g; },
    renderSeats, renderBlackCard, renderSubmissions, revealSubmission,
    markWinnerCard, renderHand, showRoundWinner,
    showTableMessage, setStatus, showBanner, toast, showGameScreen,
  };
}
