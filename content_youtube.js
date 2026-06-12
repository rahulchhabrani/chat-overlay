// Injected into YouTube watch pages and live_chat pages.
//
// Architecture:
//  • MutationObserver detects new messages — Chrome does NOT throttle MOs in
//    background tabs (they fire synchronously on DOM mutations, not via the
//    timer queue). This means messages are delivered even when the tab is hidden.
//  • setInterval force-scrolls the chat — Chrome DOES throttle setInterval in
//    background tabs, but that's OK: we only need periodic scrolling, not
//    precise timing. visibilitychange catches up instantly on tab open.
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  let iframeEl    = null;
  let scrollTimer = null;
  let chatObs     = null;

  const SELECTOR = [
    'yt-live-chat-text-message-renderer',
    'yt-live-chat-paid-message-renderer',
    'yt-live-chat-membership-item-renderer',
  ].join(', ');

  if (location.pathname === '/live_chat') {
    waitAndAttach(document);
  } else if (location.pathname === '/watch') {
    findIframe();
  }

  // ── Find live-chat iframe; wire PERPETUAL load listener ──────────────────
  function findIframe() {
    const attach = (el) => {
      iframeEl = el;
      el.addEventListener('load', () => {
        const d = el.contentDocument || el.contentWindow?.document;
        if (d) waitAndAttach(d);
      });
      const doc = el.contentDocument || el.contentWindow?.document;
      if (doc && doc.readyState !== 'loading') waitAndAttach(doc);
    };
    const el = document.querySelector('#live-chat-iframe');
    if (el) { attach(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector('#live-chat-iframe');
      if (found) { obs.disconnect(); attach(found); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── Wait for first message node, then hand off to startWatching ──────────
  function waitAndAttach(doc) {
    stopAll();
    const ready = () => !!doc.querySelector(SELECTOR);
    if (ready()) { startWatching(doc); return; }
    const obs = new MutationObserver(() => {
      if (ready()) { obs.disconnect(); startWatching(doc); }
    });
    const root = doc.body || doc.documentElement;
    if (root) obs.observe(root, { childList: true, subtree: true });
  }

  function stopAll() {
    if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
    if (chatObs)     { chatObs.disconnect();        chatObs = null;    }
  }

  // ── Force YouTube's windowed renderer to keep inserting new nodes ─────────
  // YouTube only adds message nodes to the DOM when the chat is scrolled to
  // the bottom. Without this, the chat "pauses" and MO has nothing to observe.
  function forceScroll(doc) {
    const scroller = doc.querySelector('#item-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    // Click "scroll to bottom" / "resume" button if YouTube surfaced one
    const btn = doc.querySelector(
      '#show-more button, #scroll-to-bottom-button, ' +
      'yt-live-chat-item-list-renderer #show-more'
    );
    if (btn) btn.click();
  }

  // ── Main engine: MO for detection + setInterval for scroll ───────────────
  function startWatching(doc) {
    stopAll();

    const seen = new Set();

    // setInterval — only used for force-scrolling.
    // Chrome throttles this in background tabs (can slow to ~1s+), which is
    // fine: even a 60s scroll interval just means a brief stall, not a freeze.
    scrollTimer = setInterval(() => forceScroll(doc), 1000);

    // When the user opens the YouTube tab, force-scroll immediately so YouTube
    // resumes rendering before the throttled setInterval fires.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') forceScroll(doc);
    });

    // MutationObserver — NOT throttled by Chrome in background tabs.
    // Fires synchronously whenever YouTube inserts new chat nodes.
    chatObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          tryProcess(node, seen);
          // Container nodes: scan their subtree for message renderers
          node.querySelectorAll?.(SELECTOR).forEach(n => tryProcess(n, seen));
        }
      }
      // Keep seen set bounded — prune IDs no longer in the DOM
      if (seen.size > 800) {
        const live = new Set();
        doc.querySelectorAll(SELECTOR).forEach(n => { if (n.id) live.add(n.id); });
        for (const id of seen) { if (!live.has(id)) seen.delete(id); }
      }
    });

    const root = doc.body || doc.documentElement;
    if (root) chatObs.observe(root, { childList: true, subtree: true });

    // Catch messages already rendered before we attached
    doc.querySelectorAll(SELECTOR).forEach(n => tryProcess(n, seen));

    // Kick off scrolling immediately
    forceScroll(doc);
  }

  // ── Check and dispatch a single node ─────────────────────────────────────
  function tryProcess(node, seen) {
    if (!node.matches?.(SELECTOR)) return;
    if (!node.id || seen.has(node.id)) return;
    seen.add(node.id);
    processNode(node);
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
