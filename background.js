// Background service worker — manages ALL WebSocket connections
// Twitch IRC + Kick Pusher live here; YouTube chat is relayed from content_youtube.js

// ── Target tab cache ─────────────────────────────────────────────
let cachedSite   = 'chess.com';
let cachedTabIds = new Set();

chrome.storage.sync.get(['targetSite'], s => {
  cachedSite = (s.targetSite || 'chess.com').trim().toLowerCase();
  refreshTargetTabs();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.targetSite) {
    cachedSite = (changes.targetSite.newValue || 'chess.com').trim().toLowerCase();
    refreshTargetTabs();
  }
});
function refreshTargetTabs() {
  chrome.tabs.query({}, tabs => {
    cachedTabIds = new Set();
    tabs.filter(t => t.url && t.url.toLowerCase().includes(cachedSite)).forEach(t => {
      cachedTabIds.add(t.id);
      injectContentScript(t.id); // inject into any already-open matching tabs
    });
  });
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return; // wait for full load before injecting
  if (tab.url && tab.url.toLowerCase().includes(cachedSite)) {
    cachedTabIds.add(tabId);
    injectContentScript(tabId); // inject only into the target site
  } else {
    cachedTabIds.delete(tabId);
  }
});
chrome.tabs.onRemoved.addListener(tabId => cachedTabIds.delete(tabId));

// ── Programmatic injection ────────────────────────────────────────────
// content.js is NOT a declarative content script — it is injected only into
// tabs matching the user's configured target site. This avoids <all_urls>.
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    // Non-injectable tabs (chrome://, PDF, etc.) — silently ignore
  }
}

function sendToTargetTabs(msg) {
  if (cachedTabIds.size === 0) {
    refreshTargetTabs();
    setTimeout(() => cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {})), 150);
    return;
  }
  cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {}));
}

// ── Service worker keepalive ──────────────────────────────────────────
// Chrome 116+: SW stays alive while WS messages exchanged within 30s window.
// We send a PING every 20s when any WS is open to maintain the activity window.
let keepaliveInterval = null;

function startKeepalive() {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    if (twitchWs && twitchWs.readyState === WebSocket.OPEN) {
      twitchWs.send('PING :tmi.twitch.tv');
    } else if (kickWs && kickWs.readyState === WebSocket.OPEN) {
      kickWs.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
    }
  }, 20000);
}

function stopKeepalive() {
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
}

// Alarm fires every 1 min as a backup — reconnects if SW was killed and lost its WS
chrome.alarms.create('cco-reconnect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'cco-reconnect') return;
  if (twitchChannel && (!twitchWs || twitchWs.readyState !== WebSocket.OPEN)) connectTwitch(twitchChannel);
  if (kickSlug     && (!kickWs   || kickWs.readyState   !== WebSocket.OPEN)) connectKick(kickSlug);
});

// ── Twitch IRC WebSocket ────────────────────────────────────────────
let twitchWs = null;
let twitchChannel = '';
let twitchReconnectTimer = null;

function connectTwitch(channel) {
  if (twitchWs) { try { twitchWs.close(); } catch (e) {} twitchWs = null; }
  if (twitchReconnectTimer) { clearTimeout(twitchReconnectTimer); twitchReconnectTimer = null; }
  twitchChannel = channel.toLowerCase().replace(/^#/, '').trim();
  sendToTargetTabs({ type: 'TWITCH_STATUS', status: '🟣…' });

  try { twitchWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); }
  catch (e) { sendToTargetTabs({ type: 'TWITCH_STATUS', status: '🟣❌' }); return; }

  twitchWs.onopen = () => {
    twitchWs.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    twitchWs.send('PASS SCHMOOPIIE');
    twitchWs.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 990000)));
    twitchWs.send('JOIN #' + twitchChannel);
    startKeepalive();
  };
  twitchWs.onmessage = e => e.data.split('\r\n').forEach(l => { if (l) parseTwitch(l); });
  twitchWs.onclose = () => {
    sendToTargetTabs({ type: 'TWITCH_STATUS', status: '🟣↻' });
    twitchReconnectTimer = setTimeout(() => connectTwitch(twitchChannel), 5000);
  };
  twitchWs.onerror = () => sendToTargetTabs({ type: 'TWITCH_STATUS', status: '🟣❌' });
}

function parseTwitchEmotes(rawText, emotesTag) {
  if (!emotesTag) return rawText;
  var emotes = [];
  emotesTag.split('/').forEach(function(part) {
    var colon = part.indexOf(':');
    if (colon < 0) return;
    var id = part.slice(0, colon);
    part.slice(colon + 1).split(',').forEach(function(pos) {
      var dash = pos.indexOf('-');
      if (dash < 0) return;
      emotes.push({ id: id, start: parseInt(pos, 10), end: parseInt(pos.slice(dash + 1), 10) });
    });
  });
  if (!emotes.length) return rawText;
  emotes.sort(function(a, b) { return a.start - b.start; });
  var result = '';
  var last = 0;
  emotes.forEach(function(e) {
    if (e.start > last) result += rawText.slice(last, e.start);
    var url = 'https://static-cdn.jtvnw.net/emoticons/v2/' + e.id + '/default/dark/1.0';
    var name = rawText.slice(e.start, e.end + 1);
    result += '' + url + '' + name + '';
    last = e.end + 1;
  });
  if (last < rawText.length) result += rawText.slice(last);
  return result;
}

function parseTwitch(line) {
  if (line.startsWith('PING')) { twitchWs.send('PONG :tmi.twitch.tv'); return; }
  let rest = line, tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    rest.slice(1, sp).split(';').forEach(p => { const eq = p.indexOf('='); if (eq !== -1) tags[p.slice(0, eq)] = p.slice(eq + 1).replace(/\\s/g, ' '); });
    rest = rest.slice(sp + 1);
  }
  if (rest.includes(' 366 ') || (rest.includes('JOIN') && rest.includes('#' + twitchChannel) && rest.includes('justinfan'))) {
    sendToTargetTabs({ type: 'TWITCH_STATUS', status: '🟣' + twitchChannel }); return;
  }
  const m = rest.match(/^:(\w+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :(.+)$/);
  if (!m) return;
  sendToTargetTabs({
    type:     'TWITCH_MSG',
    username: tags['display-name'] || m[1],
    color:    tags['color'] || null,
    text:     parseTwitchEmotes(m[2], tags['emotes']),
    badges:   tags['badges'] || '',
  });
}

// ── Kick Pusher WebSocket ─────────────────────────────────────────
let kickWs = null;
let kickSlug = '';
let kickReconnectTimer = null;

function connectKick(channel) {
  if (kickWs) { try { kickWs.close(); } catch (e) {} kickWs = null; }
  if (kickReconnectTimer) { clearTimeout(kickReconnectTimer); kickReconnectTimer = null; }
  kickSlug = channel.toLowerCase().trim();
  sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢…' });

  fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(kickSlug))
    .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(data => {
      const chatroomId = data.chatroom && data.chatroom.id;
      if (!chatroomId) { sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢❌' }); return; }
      openKickWs(chatroomId, kickSlug);
    })
    .catch(() => sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢❌' }));
}

function openKickWs(chatroomId, slug) {
  const url = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false';
  try { kickWs = new WebSocket(url); }
  catch (e) { sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢❌' }); return; }

  kickWs.onopen = () => { sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢…' }); startKeepalive(); };
  kickWs.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch(ex) { return; }
    if (msg.event === 'pusher:connection_established') {
      kickWs.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.' + chatroomId + '.v2' } }));
      return;
    }
    if (msg.event === 'pusher:ping') { kickWs.send(JSON.stringify({ event: 'pusher:pong', data: {} })); return; }
    if (msg.event === 'pusher_internal:subscription_succeeded') {
      sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢' + slug }); return;
    }
    if (msg.event === 'App\\Events\\ChatMessageEvent') {
      try {
        const d = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        const rawText = d.content || '';
        const text = rawText.replace(/\[emote:(\d+):([^\]]+)\]/g, function(_, id, name) { return '\uE000https://files.kick.com/emotes/' + id + '/fullsize\uE001' + name + '\uE002'; });
        if (text) sendToTargetTabs({
          type:     'KICK_MSG',
          username: (d.sender && d.sender.username) || '?',
          color:    (d.sender && d.sender.identity && d.sender.identity.color) || null,
          text,
        });
      } catch(ex) { }
    }
  };
  kickWs.onclose = () => {
    sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢↻' });
    kickReconnectTimer = setTimeout(() => openKickWs(chatroomId, slug), 5000);
  };
  kickWs.onerror = () => sendToTargetTabs({ type: 'KICK_STATUS', status: '🟢❌' });
}

// ── Message handler ────────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'TWITCH_CONNECT') {
    connectTwitch(msg.channel); return;
  }
  if (msg.type === 'TWITCH_DISCONNECT') {
    if (twitchWs) { try { twitchWs.close(); } catch (e) {} twitchWs = null; }
    if (twitchReconnectTimer) { clearTimeout(twitchReconnectTimer); twitchReconnectTimer = null; }
    twitchChannel = '';
    if (!kickSlug) stopKeepalive();
    return;
  }
  if (msg.type === 'KICK_CONNECT') {
    connectKick(msg.channel); return;
  }
  if (msg.type === 'KICK_DISCONNECT') {
    if (kickWs) { try { kickWs.close(); } catch (e) {} kickWs = null; }
    if (kickReconnectTimer) { clearTimeout(kickReconnectTimer); kickReconnectTimer = null; }
    kickSlug = '';
    if (!twitchChannel) stopKeepalive();
    return;
  }

  // Relay YouTube chat from content_youtube.js → target tab
  if (msg.type === 'YT_CHAT_MSG') {
    sendToTargetTabs(msg); return;
  }
});

// On SW start, reconnect to previously configured channels
chrome.storage.sync.get(['twitchChannel', 'kickChannel'], s => {
  if (s.twitchChannel) connectTwitch(s.twitchChannel);
  if (s.kickChannel)   connectKick(s.kickChannel);
  refreshTargetTabs();
});
