// Settings: persistence in localStorage + the settings modal UI.

const STORAGE_KEY = "aah-settings";

export const DEFAULTS = {
  ollamaUrl: "http://localhost:11434",
  model: "huihui_ai/qwen3.5-abliterated:2B",
  username: "Player",
  avatar: "",          // dataURL; empty = default placeholder
  targetScore: 7,
};

export let settings = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { /* corrupted -> defaults */ }
  return { ...DEFAULTS };
}

export function save(partial) {
  settings = { ...settings, ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

// ---- avatar helpers ----

export const DEFAULT_USER_AVATAR = "assets/avatars/default.svg";

export function userAvatarSrc() {
  return settings.avatar || DEFAULT_USER_AVATAR;
}

/** Center-crop an image file to a 256x256 square, return dataURL. */
export function cropImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

// ---- settings modal wiring ----

export function initSettingsUI({ onSaved, listModels, testConnection }) {
  const overlay = document.getElementById("settings-overlay");
  const $ = (id) => document.getElementById(id);

  let pendingAvatar = null; // null = unchanged, "" = reset, dataURL = new image

  function open() {
    $("set-username").value = settings.username;
    $("set-ollama-url").value = settings.ollamaUrl;
    $("set-model").value = settings.model;
    $("set-target-score").value = settings.targetScore;
    $("set-avatar-preview").src = userAvatarSrc();
    $("test-conn-result").textContent = "";
    $("test-conn-result").className = "test-result";
    pendingAvatar = null;
    overlay.classList.remove("hidden");
  }

  function close() { overlay.classList.add("hidden"); }

  document.getElementById("btn-settings").addEventListener("click", open);
  $("btn-settings-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  $("set-avatar-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingAvatar = await cropImageFile(file);
      $("set-avatar-preview").src = pendingAvatar;
    } catch (err) {
      alert("Could not load that image.");
    }
    e.target.value = "";
  });

  $("set-avatar-clear").addEventListener("click", () => {
    pendingAvatar = "";
    $("set-avatar-preview").src = DEFAULT_USER_AVATAR;
  });

  $("btn-fetch-models").addEventListener("click", async () => {
    const url = $("set-ollama-url").value.trim() || DEFAULTS.ollamaUrl;
    const list = $("model-list");
    list.innerHTML = "";
    try {
      const models = await listModels(url);
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        list.appendChild(opt);
      }
      $("test-conn-result").textContent = `Found ${models.length} models — click the Model box to pick.`;
      $("test-conn-result").className = "test-result ok";
    } catch (err) {
      $("test-conn-result").textContent = "Could not reach server.";
      $("test-conn-result").className = "test-result fail";
    }
  });

  $("btn-test-conn").addEventListener("click", async () => {
    const el = $("test-conn-result");
    el.textContent = "Testing…";
    el.className = "test-result";
    const url = $("set-ollama-url").value.trim() || DEFAULTS.ollamaUrl;
    const model = $("set-model").value.trim();
    const res = await testConnection(url, model);
    el.textContent = res.message;
    el.className = "test-result " + (res.ok ? "ok" : "fail");
  });

  $("btn-settings-save").addEventListener("click", () => {
    const partial = {
      username: $("set-username").value.trim() || "Player",
      ollamaUrl: ($("set-ollama-url").value.trim() || DEFAULTS.ollamaUrl).replace(/\/+$/, ""),
      model: $("set-model").value.trim() || DEFAULTS.model,
      targetScore: Math.max(1, Math.min(20, parseInt($("set-target-score").value, 10) || DEFAULTS.targetScore)),
    };
    if (pendingAvatar !== null) partial.avatar = pendingAvatar;
    save(partial);
    close();
    onSaved(settings);
  });
}
