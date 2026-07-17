⭐ AI Against Humanity — Clean, Player‑First README
🎮 Play the Game
Download
Grab the latest desktop builds from the releases/ folder:

Windows — Installer + portable .exe

macOS — .dmg

Linux — .AppImage

Requirements
You need Ollama running locally with at least one model installed.

Recommended model:

Code
ollama pull huihui_ai/qwen3.5-abliterated:2B
Web & Mobile Version
You can also play in a browser:

Local PC: <http://localhost:8123>

Phone/tablet on same network: http://<pc-ip>:8123

If the AI server isn’t reachable, the game falls back to a built‑in deck.

🕹️ How to Play
Click a card to zoom in.

Drag a card up to play it.

Drag a zoomed card down to return it.

When you’re the Card Czar: flip each card, then pick the funniest.

Settings (⚙): name, avatar, model picker, Ollama URL, points‑to‑win.

Progress auto‑saves every round.

Bots: Rebecca, Timothy, Steve.
First to the target score (default 7) wins.

🖥️ Desktop Version (Electron)
The desktop app bundles the UI and handles Ollama requests internally.
Players do not need Python, CORS setup, or a browser.

Run from source
Code
npm install
npm run start
Build a Windows release
Code
npm run dist
This produces installers and portable builds in releases/.

How the desktop bridge works
desktop/preload.cjs exposes a single ollama.request API.

desktop/main.cjs validates requests and only allows /api/chat and /api/tags.

Renderer stays sandboxed (no Node, no filesystem, no arbitrary network).

Web build still uses normal fetch for LAN/mobile testing.

🌐 LAN / Mobile AI Setup
To play from a phone:

Allow external origins in Ollama:

Code
OLLAMA_ORIGINS=*
Set Ollama to listen on the network:

Code
OLLAMA_HOST=0.0.0.0
In Settings, change the server URL to your PC’s LAN IP:

Code
http://192.168.x.x:11434
Without these, the game runs but uses the fallback deck.

🛠️ Development
Requirements
Node.js

Ollama

Python (only for serving static files)

Run the web version
Code
python ai-against-humanity/serve.py
Open <http://localhost:8123>.

Folder Structure
File	Purpose
js/game.js	Round flow, card pools, bot behavior
js/ollama.js	Ollama client + prompts
js/ui.js	Rendering + drag/flip animations
js/settings.js	Settings modal + persistence
js/fallback-cards.js	Offline deck


🚀 Roadmap Ideas
Theme packs (politics, video games, etc.)

Pick‑2 black cards

AI‑judged bot czars

Online multiplayer

Android build with on‑device inference
