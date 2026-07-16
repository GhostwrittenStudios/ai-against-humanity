const { contextBridge, ipcRenderer } = require("electron");

// Deliberately expose one narrow capability instead of Electron/Node itself.
contextBridge.exposeInMainWorld("aiAgainstHumanityDesktop", {
  ollama: {
    request: async (request) => {
      const response = await ipcRenderer.invoke("ollama:request", request);
      if (!response.ok) {
        const safe = new Error(response.message || "Could not reach Ollama.");
        if (Number.isInteger(response.status)) safe.status = response.status;
        throw safe;
      }
      return response.body;
    },
  },
});
