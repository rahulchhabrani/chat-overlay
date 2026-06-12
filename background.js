// Background service worker
// Relays Kick chatroom IDs and polls YouTube's live chat API directly.
//
// YouTube chat is polled here (not in a content script) because:
//   • Chrome suspends rAF and throttles timers in background tabs
//   • The service worker runs independently of any tab's visibility state
//   • This makes chat delivery immune to tab switching/minimising

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

// ── YouTube Live Chat API polling ─────────────────────────────────────────────
// Polls YouTube's internal /get_live_chat endpoint from the service worker so
// chat delivery is never gated on a tab's visibility or rAF schedule.
let ytContinuation  = null;
let ytClientVersion = '2.20260612.00.00';
let ytPollTimer     = null;
let ytSeenIds       = new Set();

function scheduleYtPoll(delayMs) {
  if (ytPollTimer) clearTimeout(ytPollTimer);
  ytPollTimer = setTimeout(pollYouTubeLiveChat, delayMs);
}

async function pollYouTubeLiveChat() {
  if (!ytContinuation) return;
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/live_chat/get_live_chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: ytClientVersion, hl: 'en', gl: 'US' }
        },
        continuation: ytContinuation,
      })
    });

    if (!res.ok) { scheduleYtPoll(5000); return; }

    const data = await res.json();
    const lcc  = data?.continuationContents?.liveChatContinuation;
    if (!lcc)  { scheduleYtPoll(5000); return; }

    // Rotate continuation token
    const nc = lcc?.continuations?.[0];
    const nextToken = nc?.invalidationContinuationData?.continuation
                   || nc?.timedContinuationData?.continuation;
    const pollDelay = Math.min(
      nc?.invalidationContinuationData?.timeoutMs
      || nc?.timedContinuationData?.timeoutMs
      || 5000,
      5000  // cap at 5s — never lag too far behind
    );
    if (nextToken) ytContinuation = nextToken;

    // Relay new messages
    const actions = lcc?.actions || [];
    for (const action of actions) {
      const item = action?.addChatItemAction?.item;
      if (!item) continue;
      const msg = parseYtChatItem(item);
      if (!msg || ytSeenIds.has(msg.id)) continue;
      ytSeenIds.add(msg.id);
      if (ytSeenIds.size > 2000) ytSeenIds = new Set([...ytSeenIds].slice(-500));
      const payload = {
        type: 'YT_CHAT_MSG',
        username: msg.username, text: msg.text, color: msg.color, isSuperchat: msg.isSuperchat,
      };
      if (cachedTabIds.size === 0) refreshTargetTabs();
      cachedTabIds.forEach(id => chrome.tabs.sendMessage(id, payload).catch(() => {}));
    }

    scheduleYtPoll(pollDelay);
  } catch (e) {
    scheduleYtPoll(5000);
  }
}

function parseYtChatItem(item) {
  const text   = item.liveChatTextMessageRenderer;
  const paid   = item.liveChatPaidMessageRenderer;
  const member = item.liveChatMembershipItemRenderer;
  const r      = text || paid || member;
  if (!r) return null;

  const id       = r.id || Math.random().toString(36).slice(2);
  const username = r.authorName?.simpleText || '';
  if (!username) return null;

  let msgText = '';
  if (r.message?.runs) {
    msgText = r.message.runs
      .map(run => run.text != null ? run.text : (run.emoji?.shortcuts?.[0] || run.emoji?.emojiId || ''))
      .join('');
  } else if (r.headerSubtext?.runs) {
    msgText = r.headerSubtext.runs.map(run => run.text || '').join('');
  }
  if (!msgText) msgText = member ? '★ New member!' : '';
  if (!msgText) return null;

  let color = null;
  for (const badge of (r.authorBadges || [])) {
    const tip = badge.liveChatAuthorBadgeRenderer?.tooltip?.toLowerCase() || '';
    if (tip.includes('owner'))     { color = '#FFD700'; break; }
    if (tip.includes('moderator')) { color = '#5E84F1'; break; }
    if (tip.includes('member'))    { color = '#2BA640'; break; }
  }
  if (paid)   color = '#FF9800';
  if (member) color = color || '#2BA640';

  return { id, username, text: msgText, color, isSuperchat: !!paid };
}

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

  // YouTube: content script sends continuation token → start API polling
  if (msg.type === 'YT_INIT') {
    ytContinuation  = msg.continuation;
    ytClientVersion = msg.clientVersion || ytClientVersion;
    ytSeenIds       = new Set();
    scheduleYtPoll(300);
    return;
  }

  // Direct relay fallback (watch-page iframes etc.)
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
