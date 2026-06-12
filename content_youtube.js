// Injected into YouTube watch/live_chat pages.
//
// Polls YouTube's live chat API directly from the content script.
// Advantages over DOM scraping or background polling:
//   • Same-origin fetch (youtube.com → youtube.com) — no CORS, cookies auto-included
//   • Content script lives as long as the tab — no service worker sleep/restart issues
//   • fetch() itself is NOT throttled in background tabs; only the scheduling timer is
//   • visibilitychange immediately catches up after any throttled period
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  let continuation  = null;
  let clientVersion = '2.20260612.00.00';
  let pollTimer     = null;
  const seen        = new Set();

  // ── Extract continuation token from ytInitialData ─────────────────────────
  function init() {
    try {
      const conts = window.ytInitialData?.contents?.liveChatRenderer?.continuations;
      if (!conts?.length) return false;
      const c = conts[0];
      continuation = c?.invalidationContinuationData?.continuation
                  || c?.timedContinuationData?.continuation
                  || c?.reloadContinuationData?.continuation
                  || null;
      clientVersion = window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION || clientVersion;
    } catch (e) {}
    return !!continuation;
  }

  // ── Poll YouTube's live chat API ──────────────────────────────────────────
  async function pollLoop() {
    if (!continuation) return;
    try {
      // Relative URL = same-origin; cookies included automatically
      const res = await fetch('/youtubei/v1/live_chat/get_live_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
          continuation,
        })
      });
      if (!res.ok) { schedule(5000); return; }

      const data = await res.json();
      const lcc  = data?.continuationContents?.liveChatContinuation;
      if (!lcc)  { schedule(5000); return; }

      // Rotate continuation token
      const nc    = lcc?.continuations?.[0];
      const next  = nc?.invalidationContinuationData?.continuation
                 || nc?.timedContinuationData?.continuation;
      const delay = Math.min(
        nc?.invalidationContinuationData?.timeoutMs
        || nc?.timedContinuationData?.timeoutMs
        || 5000, 5000
      );
      if (next) continuation = next;

      // Relay new messages to background → chess tab
      for (const action of (lcc?.actions || [])) {
        const item = action?.addChatItemAction?.item;
        if (!item) continue;
        const msg = parseItem(item);
        if (!msg || seen.has(msg.id)) continue;
        seen.add(msg.id);
        if (seen.size > 2000) {
          const arr = [...seen]; seen.clear(); arr.slice(-500).forEach(id => seen.add(id));
        }
        chrome.runtime.sendMessage({
          type: 'YT_CHAT_MSG',
          username: msg.username, text: msg.text, color: msg.color, isSuperchat: msg.isSuperchat,
        }).catch(() => {});
      }

      schedule(delay);
    } catch (e) {
      schedule(5000);
    }
  }

  function schedule(ms) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollLoop, ms);
  }

  // ── Parse one chat item from the API response ─────────────────────────────
  function parseItem(item) {
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

  // ── Start ─────────────────────────────────────────────────────────────────
  if (init()) {
    pollLoop();
  } else {
    // ytInitialData not ready yet — retry until it appears (max 30s)
    let attempts = 0;
    const iv = setInterval(() => {
      if (init() || ++attempts > 60) {
        clearInterval(iv);
        if (continuation) pollLoop();
      }
    }, 500);
  }

  // When the user switches back to this tab, poll immediately to catch up
  // from any period where the timer was throttled by Chrome
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && continuation) {
      if (pollTimer) clearTimeout(pollTimer);
      pollLoop();
    }
  });
})();
