// Injected into YouTube watch/live_chat pages.
// Polls YouTube's live chat API from the content script (same-origin, cookies
// auto-included, no service-worker sleep issues).
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  let continuation = null;
  let pollTimer    = null;
  const seen       = new Set();

  // ── Build innertube context from ytcfg (same values YouTube's own client uses)
  function getContext() {
    const cfg = window.ytcfg?.data_ || {};
    return {
      client: {
        clientName:    'WEB',
        clientVersion: cfg.INNERTUBE_CLIENT_VERSION || '2.20260612.00.00',
        hl:            cfg.HL  || 'en',
        gl:            cfg.GL  || 'US',
        visitorData:   cfg.VISITOR_DATA || '',
      }
    };
  }

  // ── Extract continuation token from ytInitialData ─────────────────────────
  function init() {
    try {
      const yd = window.ytInitialData;
      if (!yd) return false;

      const conts = yd?.contents?.liveChatRenderer?.continuations;
      if (!conts?.length) {
        console.log('[CCO] ytInitialData found but no continuations:', yd?.contents);
        return false;
      }
      const c = conts[0];
      continuation = c?.invalidationContinuationData?.continuation
                  || c?.timedContinuationData?.continuation
                  || c?.reloadContinuationData?.continuation
                  || null;
      console.log('[CCO] continuation token:', continuation ? 'found ✓' : 'missing ✗');
    } catch (e) {
      console.error('[CCO] init error:', e);
    }
    return !!continuation;
  }

  // ── Poll YouTube's live chat API ──────────────────────────────────────────
  async function pollLoop() {
    if (!continuation) return;
    try {
      const ctx = getContext();
      const res = await fetch('/youtubei/v1/live_chat/get_live_chat', {
        method: 'POST',
        headers: {
          'Content-Type':           'application/json',
          'x-youtube-client-name':  '1',
          'x-youtube-client-version': ctx.client.clientVersion,
          'x-origin':               'https://www.youtube.com',
        },
        body: JSON.stringify({ context: ctx, continuation }),
      });

      if (!res.ok) {
        console.warn('[CCO] YT API HTTP error:', res.status);
        schedule(5000);
        return;
      }

      const data = await res.json();
      const lcc  = data?.continuationContents?.liveChatContinuation;
      if (!lcc) {
        console.warn('[CCO] Unexpected API response shape:', JSON.stringify(data).slice(0, 200));
        schedule(5000);
        return;
      }

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
      const actions = lcc?.actions || [];
      for (const action of actions) {
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
      console.error('[CCO] pollLoop error:', e);
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
  function start() {
    if (init()) {
      console.log('[CCO] Starting YT live chat poll');
      pollLoop();
      return;
    }
    // ytInitialData not ready — retry for up to 30s
    let attempts = 0;
    const iv = setInterval(() => {
      if (init()) {
        clearInterval(iv);
        console.log('[CCO] Starting YT live chat poll (delayed)');
        pollLoop();
      } else if (++attempts > 60) {
        clearInterval(iv);
        console.warn('[CCO] Gave up waiting for ytInitialData after 30s');
      }
    }, 500);
  }

  start();

  // Catch up immediately when the tab is opened
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && continuation) {
      if (pollTimer) clearTimeout(pollTimer);
      pollLoop();
    }
  });
})();
