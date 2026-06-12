// Injected into YouTube watch pages and live_chat pages.
//
// Root cause of "freeze": YouTube checks document.hidden / visibilityState and
// pauses its chat rendering engine when the tab is in the background.
// Fix: spoof those APIs in the page context so YouTube always thinks it's visible.
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  // ── Spoof Page Visibility API (must run in PAGE context, not isolated world) ─
  // Content scripts run in an isolated JS world — property overrides here don't
  // affect YouTube's own scripts. We inject a <script> tag to reach page context.
  injectPageScript(`(function(){
    try {
      // YouTube checks document.hidden to pause chat. Always return false.
      Object.defineProperty(document, 'hidden',
        { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState',
        { get: () => 'visible', configurable: true });
      // Suppress visibilitychange events before YouTube's handlers see them
      document.addEventListener('visibilitychange',
        e => e.stopImmediatePropagation(), true);
    } catch(e) {}
  })()`);

  function injectPageScript(code) {
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
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

  // ── Wait for first message node, then start watching ─────────────────────
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

  // ── Keep YouTube's windowed renderer active ───────────────────────────────
  function forceScroll(doc) {
    const scroller = doc.querySelector('#item-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const btn = doc.querySelector(
      '#show-more button, #scroll-to-bottom-button, ' +
      'yt-live-chat-item-list-renderer #show-more'
    );
    if (btn) btn.click();
  }

  // ── MO for message detection + setInterval for scroll ────────────────────
  function startWatching(doc) {
    stopAll();

    const seen = new Set();

    // Force-scroll every 1s. Even if Chrome throttles this in the background,
    // YouTube's rendering loop is now kept alive by the visibility spoof above.
    scrollTimer = setInterval(() => forceScroll(doc), 1000);

    // Immediate scroll on tab focus (belt-and-suspenders)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') forceScroll(doc);
    });

    // MutationObserver — not throttled by Chrome, fires on every DOM insertion
    chatObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          tryProcess(node, seen);
          node.querySelectorAll?.(SELECTOR).forEach(n => tryProcess(n, seen));
        }
      }
      if (seen.size > 800) {
        const live = new Set();
        doc.querySelectorAll(SELECTOR).forEach(n => { if (n.id) live.add(n.id); });
        for (const id of seen) { if (!live.has(id)) seen.delete(id); }
      }
    });

    const root = doc.body || doc.documentElement;
    if (root) chatObs.observe(root, { childList: true, subtree: true });

    // Catch messages already in DOM
    doc.querySelectorAll(SELECTOR).forEach(n => tryProcess(n, seen));
    forceScroll(doc);
  }

  function tryProcess(node, seen) {
    if (!node.matches?.(SELECTOR)) return;
    if (!node.id || seen.has(node.id)) return;
    seen.add(node.id);
    processNode(node);
  }

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
