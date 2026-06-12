// Background service worker
// Relays YouTube chat messages and fetches Kick chatroom IDs.
// YouTube chat is now polled by content_youtube.js (same-origin, content script
// lifetime) — the service worker just relays the messages to the chess tab.

// ── In-memory cache: eliminates storage + tabs.query on every message ────────
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
    cachedTabIds = new Set(
      tabs.filter(t => t.url && t.url.toLowerCase().includes(cachedSite)).map(t => t.id)
    );
  });
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  if (tab.url && tab.url.toLowerCase().includes(cachedSite)) cachedTabIds.add(tabId);
  else cachedTabIds.delete(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => cachedTabIds.delete(tabId));

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Fetch Kick chatroom ID
  if (msg.type === 'GET_KICK_CHATROOM') {
    fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(msg.channel)}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then(data => sendResponse({ chatroomId: data.chatroom?.id ?? null }))
      .catch(() => sendResponse({ chatroomId: null }));
    return true;
  }

  // Relay YT messages from content_youtube.js to the chess tab
  if (msg.type === 'YT_CHAT_MSG') {
    if (cachedTabIds.size === 0) {
      refreshTargetTabs();
      setTimeout(() => {
        cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {}));
      }, 150);
      return;
    }
    cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {}));
  }
});
