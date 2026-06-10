// Relay YouTube chat messages from YT tab → target site tabs
// Fetch Kick chatroom ID (needs host_permissions for kick.com)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Fetch Kick chatroom ID from Kick's public API
  if (msg.type === 'GET_KICK_CHATROOM') {
    fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(msg.channel)}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(data => {
        sendResponse({ chatroomId: data.chatroom?.id ?? null });
      })
      .catch(() => sendResponse({ chatroomId: null }));
    return true; // keep channel open for async response
  }

  // Relay YT messages to the configured target site tabs
  if (msg.type === 'YT_CHAT_MSG') {
    chrome.storage.sync.get(['targetSite'], s => {
      const site = (s.targetSite || 'chess.com').trim().toLowerCase();
      chrome.tabs.query({}, tabs => {
        tabs
          .filter(t => t.url && t.url.toLowerCase().includes(site))
          .forEach(tab => chrome.tabs.sendMessage(tab.id, msg).catch(() => {}));
      });
    });
  }
});
