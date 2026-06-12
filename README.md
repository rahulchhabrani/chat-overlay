# Multistream Chat Overlay — Chrome Extension

> **Overlay Twitch, Kick & YouTube live chat on any website** — chess.com, gaming sites, video players, anything.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-brightgreen?logo=googlechrome)](https://github.com/rahulchhabrani/chat-overlay)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![Platforms](https://img.shields.io/badge/Platforms-Twitch%20%7C%20Kick%20%7C%20YouTube-9147ff)](https://github.com/rahulchhabrani/chat-overlay)

---

## What is this?

**Multistream Chat Overlay** is a Chrome extension that lets you watch **Twitch, Kick, and YouTube live chat** as a floating overlay on top of any website. No more alt-tabbing between your stream and your game, chess board, or browser app.

Perfect for:
- 🎮 Watching chat while playing games in the browser
- ♟️ Chess players on chess.com who stream on Twitch/Kick/YouTube
- 📺 Content creators who want chat visible on any site
- 🖥️ Anyone who wants chat without opening a second window

---

## Features

- 🟣 **Twitch chat** — native IRC WebSocket, no login required
- 🟢 **Kick chat** — real-time via Pusher WebSocket
- 🔴 **YouTube live chat** — DOM relay from the live stream tab
- 🪟 **Draggable & resizable** — position and resize the overlay anywhere on screen
- 👻 **Dim/transparent mode** — make the overlay semi-transparent so it doesn't block content
- 📌 **Collapse** — minimize to just a header bar when not needed
- 💾 **Chat history** — messages persist across page refreshes
- ⚡ **Smooth rendering** — messages trickle in with animations, never burst-pop
- 🎯 **Configurable target site** — works on any domain you choose

---

## Installation

### Option 1: Load from source (Developer Mode)

1. **Download** this repo — click the green **Code** button → **Download ZIP**, then unzip it
2. Open **chrome://extensions** in Chrome
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the unzipped `chat-overlay-main` folder
5. The 💬 icon appears in your Chrome toolbar — click it to configure

### Option 2: Chrome Web Store *(coming soon)*

---

## How to Use

### Setting up Twitch chat
1. Click the **Chat Overlay** icon in the Chrome toolbar
2. Enter your **Twitch channel name** (e.g. `xqc`, `pokimane`)
3. Click **Save & Connect**
4. Navigate to any website — the overlay appears in the bottom-right corner

### Setting up Kick chat
1. Click the extension icon
2. Enter your **Kick channel name**
3. Click **Save & Connect**

### Setting up YouTube chat
1. Open the **YouTube live stream** in any Chrome tab
2. Chat messages from that stream will automatically appear in the overlay

### Connecting all three at once
You can have Twitch, Kick, and YouTube chat all showing simultaneously. The colored dots in the overlay header show which platforms are connected:
- 🟣 Purple = Twitch
- 🟢 Green = Kick  
- 🔴 Red = YouTube

### Choosing which website to show the overlay on
By default the overlay appears on **chess.com**. To change this:
1. Click the extension icon
2. Change the **Target Site** field (e.g. `twitch.tv`, `youtube.com`, or leave blank for all sites)
3. Click Save

### Moving and resizing
- **Drag** the header bar to reposition the overlay
- **Resize** from the bottom-left corner handle
- **Collapse** using the — button to minimize
- **Dim** using the ◑ button for a transparent ghost mode

---

## Why native WebSockets?

Most chat overlay extensions use iframes or third-party embeds, which break on sites with strict Content Security Policies (CSP). This extension uses **direct WebSocket connections** to Twitch IRC and Kick's Pusher API — meaning it works on any site, including heavily locked-down ones like chess.com.

---

## Tech stack

- Chrome Extension Manifest V3
- Twitch IRC over WebSocket (`wss://irc-ws.chat.twitch.tv`)
- Kick via Pusher WebSocket (`wss://ws-us2.pusher.com`)
- YouTube via DOM content script relay
- Vanilla JS — zero dependencies, no build step

---

## Keywords

chrome extension live chat overlay · twitch chat overlay chrome · kick chat overlay · youtube chat overlay · multistream chat · chess.com twitch chat · overlay chat on any website · stream chat floating window · live chat while gaming
