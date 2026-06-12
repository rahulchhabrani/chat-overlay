// Injected into YouTube watch pages and live_chat pages.
// Uses polling (not MutationObserver) — more robust against YouTube's
// internal DOM management which silently invalidates MO targets.
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  let iframeEl  = null;
  let pollTimer = null;

  if (location.pathname === '/live_chat') {
    waitAndPoll(document);
  } else if (location.pathname === '/watch') {
    findIframe();
  }

  // ── Find live-chat iframe; wire PERPETUAL load listener ──────────────────
  // The load event fires every time YouTube silently reloads the iframe, so
  // we always get a fresh document reference.
  function findIframe() {
    const attach = (el) => {
      iframeEl = el;
      // No {once:true} — handles every future iframe reload
      el.addEventListener('load', () => {
        const d = el.contentDocument || el.contentWindow?.document;
        if (d) waitAndPoll(d);
      });
      const doc = el.contentDocument || el.contentWindow?.document;
      if (doc && doc.readyState !== 'loading') waitAndPoll(doc);
    };

    const el = document.querySelector('#live-chat-iframe');
    if (el) { attach(el); return; }

    const obs = new MutationObserver(() => {
      const found = document.querySelector('#live-chat-iframe');
      if (found) { obs.disconnect(); attach(found); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── Wait for chat container, then start polling ───────────────────────────
  function waitAndPoll(doc) {
    // Clear any previous poll for this doc
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    const SELECTOR = 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer';
    const ready    = () => !!doc.querySelector(SELECTOR);

    if (ready()) { startPoll(doc, SELECTOR); return; }

    // Use MO only to know when chat is first ready, then hand off to polling
    const obs = new MutationObserver(() => {
      if (ready()) { obs.disconnect(); startPoll(doc, SELECTOR); }
    });
    const root = doc.body || doc.documentElement;
    if (root) obs.observe(root, { childList: true, subtree: true });
  }

  // ── Force YouTube chat to stay scrolled to bottom ────────────────────────
  // YouTube uses virtual/windowed rendering: it only inserts new message nodes
  // into the DOM when the chat is scrolled to the bottom. If auto-scroll is
  // paused, new messages are never added to the DOM and polling finds nothing.
  // We force-scroll every 1.5s so YouTube always renders new messages.
  function forceScroll(doc) {
    // Primary scroll container
    const scroller = doc.querySelector('#item-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    // Also click the "scroll to bottom" / "resume" button if YouTube shows one
    const resumeBtn = doc.querySelector(
      '#show-more button, #scroll-to-bottom-button, ' +
      'yt-live-chat-item-list-renderer #show-more'
    );
    if (resumeBtn) resumeBtn.click();
  }

  // ── Poll every 300ms for new message nodes ────────────────────────────────
  // Polling is simpler and more reliable than a MutationObserver on YouTube's
  // dynamically managed chat DOM.
  function startPoll(doc, SELECTOR) {
    if (pollTimer) clearInterval(pollTimer);

    const seen = new Set(); // tracks processed message IDs
    let tick = 0;

    pollTimer = setInterval(() => {
      // Force-scroll every 5 ticks (1.5s) to keep YouTube rendering new nodes
      if (++tick % 5 === 0) forceScroll(doc);

      const nodes = doc.querySelectorAll(SELECTOR);
      if (!nodes.length) return;

      // When seen gets large, reset it using only CURRENTLY VISIBLE IDs
      // to avoid re-sending messages already on screen after the reset.
      if (seen.size > 800) {
        seen.clear();
        nodes.forEach(n => { if (n.id) seen.add(n.id); });
        return; // skip this tick, resume fresh next tick
      }

      nodes.forEach(n => {
        if (!n.id || seen.has(n.id)) return;
        seen.add(n.id);
        processNode(n);
      });
    }, 300);
  }

  // ── Parse one message node and relay to background ────────────────────────
  function processNode(node) {
    const tag      = node.tagName.toLowerCase();
    const isSuper  = tag === 'yt-live-chat-paid-message-renderer';
    const isMember = tag === 'yt-live-chat-membership-item-renderer';

    const authorEl = node.querySelector('#author-name');
    const msgEl    = node.querySelector('#message') ||
                     node.querySelector('#header-subtext') ||
                     node.querySelector('#header-primary-text');
    if (!authorEl) return;

    const username = authorEl.textContent.trim();
    const text     = msgEl ? msgEl.textContent.trim() : (isMember ? '★ New member!' : '');
    if (!username || !text) return;

    let color = null;
    const badgesEl = node.querySelector('#author-badges');
    if (badgesEl) {
      const b = badgesEl.innerHTML;
      if (b.includes('owner'))          color = '#FFD700';
      else if (b.includes('moderator')) color = '#5E84F1';
      else if (b.includes('member'))    color = '#2BA640';
    }
    if (isSuper)  color = '#FF9800';
    if (isMember) color = '#2BA640';

    chrome.runtime.sendMessage({
      type: 'YT_CHAT_MSG', username, text, color, isSuperchat: isSuper,
    }).catch(() => {});
  }
})();
