const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

function normaliseOllamaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid Ollama server URL.");
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Ollama server URLs must use http or https and cannot include credentials.");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function requestOllama({ url, path: apiPath, method = "GET", headers, body }) {
  if (!['/api/chat', '/api/tags'].includes(apiPath)) {
    throw new Error("Unsupported Ollama API endpoint.");
  }
  const base = normaliseOllamaUrl(url);
  const response = await fetch(`${base}${apiPath}`, { method, headers, body });
  const responseBody = await response.text();
  if (!response.ok) {
    const error = new Error(`Ollama HTTP ${response.status}: ${responseBody.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return responseBody;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 390,
    minHeight: 650,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  ipcMain.handle("ollama:request", async (_event, request) => {
    try {
      return { ok: true, body: await requestOllama(request) };
    } catch (error) {
      // Electron does not preserve custom Error fields across IPC, so serialize
      // the status deliberately (the renderer uses 404 for model guidance).
      return { ok: false, status: error.status || 0, message: error.message };
    }
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
