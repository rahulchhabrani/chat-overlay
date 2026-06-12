// Background service worker
// Relays YouTube chat messages and fetches Kick chatroom IDs.
// ── In-memory cache: eliminates storage + tabs.query on every message ────────
let cachedSite   = 'chess.com';
let cachedTabIds = new Set();

// Populate cache on startup
chrome.storage.sync.get(['targetSite'], s => {
  cachedSite = (s.targetSite || 'chess.com').trim().toLowerCase();
  refreshTargetTabs();
});

// Keep cachedSite in sync when popup saves new settings
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.targetSite) {
    cachedSite = (changes.targetSite.newValue || 'chess.com').trim().toLowerCase();
    refreshTargetTabs();
  }
});

// Find all open tabs that match the target site
function refreshTargetTabs() {
  chrome.tabs.query({}, tabs => {
    cachedTabIds = new Set(
      tabs
        .filter(t => t.url && t.url.toLowerCase().includes(cachedSite))
        .map(t => t.id)
    );
  });
}

// Track tab changes so the cache stays current without re-querying all tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  if (tab.url && tab.url.toLowerCase().includes(cachedSite)) {
    cachedTabIds.add(tabId);
  } else {
    cachedTabIds.delete(tabId);
  }
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
    return true; // keep channel open for async response
  }

  // Relay YT messages — uses cached site+tabs, zero async reads
  if (msg.type === 'YT_CHAT_MSG') {
    if (cachedTabIds.size === 0) {
      // Cache miss (service worker just woke up) — do one-time refresh then send
      refreshTargetTabs();
      setTimeout(() => {
        cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {}));
      }, 150);
      return;
    }
    cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, msg).catch(() => {}));
  }
});
