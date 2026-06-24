# Chat Overlay – Twitch, Kick & YouTube Chrome Extension

> Float Twitch, Kick, and YouTube live chat on top of any website — no second monitor needed.

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install%20Free-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/chat-overlay-%E2%80%93-twitch-kic/ckbekljbdfajcbomkmbcalhmbdfeonnc)

**Chat Overlay** is a free Chrome extension that lets streamers keep Twitch, Kick, and YouTube chat visible as a floating overlay on any website — chess.com, GeoGuessr, or anywhere else you stream from.

## Features

- **Twitch chat overlay** — connects via IRC WebSocket, no login required
- **Kick chat overlay** — live chat via Pusher WebSocket
- **YouTube live chat overlay** — DOM relay for YouTube streams
- **Draggable & resizable** — position anywhere on screen, stays where you put it
- **Dim mode** — ghost-transparent so chat never blocks your game
- **Collapse to bar** — minimize to a slim header with one click
- **Works everywhere** — chess.com, GeoGuessr, Kick, Twitch, any website (even iframe-blocking sites)
- **No account, no login** — just enter a channel name and connect
- **No data collected** — zero tracking, zero telemetry

## Install

**[→ Add to Chrome — Free](https://chromewebstore.google.com/detail/chat-overlay-%E2%80%93-twitch-kic/ckbekljbdfajcbomkmbcalhmbdfeonnc)**

Available on the Chrome Web Store. Works on Chrome, Brave, Arc, and any Chromium-based browser.

## Who It's For

Built for streamers who game on a single screen. If you stream on Twitch, Kick, or YouTube while playing chess.com, GeoGuessr, or anything else in the browser — Chat Overlay keeps your chat visible without a second monitor or squinting at your phone.

## How to Use

1. Click **Add to Chrome** above
2. Click the Chat Overlay icon in your Chrome toolbar
3. Enter your Twitch, Kick, or YouTube channel name and hit **Save & Connect**

## How It Works

- **Twitch** — native IRC WebSocket (`wss://irc-ws.chat.twitch.tv`)
- **Kick** — Pusher WebSocket for real-time chat
- **YouTube** — DOM relay injected into the YouTube chat iframe

No iframes for chat rendering. All connections are native WebSocket — fast and lightweight.

## Privacy

No data is collected, stored, or transmitted to any server. All connections go directly from your browser to Twitch/Kick/YouTube. See the [privacy policy](https://chat.rchx.com/privacy.html).

## Manual Install (Developer Mode)

1. Download and unzip this repo
2. Open `chrome://extensions` and enable **Developer Mode**
3. Click **Load unpacked** → select the folder
4. Click the extension icon, enter your channels, and hit **Save & Connect**

## Links

- [chat.rchx.com](https://chat.rchx.com) — landing page
- [Chrome Web Store](https://chromewebstore.google.com/detail/chat-overlay-%E2%80%93-twitch-kic/ckbekljbdfajcbomkmbcalhmbdfeonnc)
- [@rahulchhabrani](https://x.com/rahulchhabrani) on X

---

*Built by [Rahul](https://rchx.com) · v4.6*
