// Injected into YouTube watch pages and live_chat pages.
// Reads live chat and relays to the overlay via background.js
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  // Module-level refs so reconnect logic always has the right context
  let iframeEl       = null;
  let activeObserver = null;  // currently running MutationObserver
  let watchdogTimer  = null;

  if (location.pathname === '/live_chat') {
    setupForDoc(document);
  } else if (location.pathname === '/watch') {
    findIframe();
  }

  // ── 1. Find the iframe and wire a PERPETUAL load listener ────────────────
  // The load event fires every time YouTube reloads the chat iframe (it does
  // this silently after extended streams). Without this we'd be watching the
  // old, discarded document forever.
  function findIframe() {
    const attach = (el) => {
      iframeEl = el;
      // Perpetual: re-runs setupForDoc every time the iframe navigates
      el.addEventListener('load', () => {
        const d = el.contentDocument || el.contentWindow?.document;
        if (d) setupForDoc(d);
      });
      // Connect to whatever document is already loaded
      const doc = el.contentDocument || el.contentWindow?.document;
      if (!doc || doc.readyState === 'loading') {
        el.addEventListener('load', () => {
          const d = el.contentDocument || el.contentWindow?.document;
          if (d) setupForDoc(d);
        }, { once: true });
      } else {
        setupForDoc(doc);
      }
    };

    const existing = document.querySelector('#live-chat-iframe');
    if (existing) { attach(existing); return; }

    // Wait for the iframe to appear (no setTimeout polling)
    const obs = new MutationObserver(() => {
      const el = document.querySelector('#live-chat-iframe');
      if (el) { obs.disconnect(); attach(el); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── 2. Find yt-live-chat-item-list-renderer inside this doc ───────────────
  function setupForDoc(doc) {
    disconnectCurrent(); // always clean up before creating new observer

    const getRenderer = () => doc.querySelector('yt-live-chat-item-list-renderer');
    const r = getRenderer();
    if (r) { startObserving(r); return; }

    // Wait for the renderer to appear
    const obs = new MutationObserver(() => {
      const found = getRenderer();
      if (found) { obs.disconnect(); startObserving(found); }
    });
    const root = doc.body || doc.documentElement;
    if (root) obs.observe(root, { childList: true, subtree: true });
  }

  // ── 3. Observe with subtree — survives #items rebuilds ────────────────────
  function startObserving(renderer) {
    disconnectCurrent();

    const seen = new Set();
    const mo = new MutationObserver((mutations) => {
      if (seen.size > 400) seen.clear();
      mutations.forEach(m => m.addedNodes.forEach(n => handleNode(n, seen)));
    });
    mo.observe(renderer, { childList: true, subtree: true });
    activeObserver = mo;

    // Watchdog: if renderer leaves the DOM (YouTube rebuilt the structure),
    // reconnect using the FRESH iframeEl.contentDocument — not stale ownerDocument
    watchdogTimer = setInterval(() => {
      if (renderer.isConnected) return;
      disconnectCurrent();
      if (iframeEl) {
        const freshDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        if (freshDoc && freshDoc.body) setupForDoc(freshDoc);
      } else {
        // live_chat standalone page — ownerDocument is still valid
        setupForDoc(renderer.ownerDocument);
      }
    }, 8000);
  }

  // ── Cleanup helper — always call before creating a new observer ───────────
  function disconnectCurrent() {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (watchdogTimer)  { clearInterval(watchdogTimer); watchdogTimer  = null; }
  }

  // ── Parse and relay a single chat node ────────────────────────────────────
  function handleNode(node, seen) {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();
    const isText   = tag === 'yt-live-chat-text-message-renderer';
    const isSuper  = tag === 'yt-live-chat-paid-message-renderer';
    const isMember = tag === 'yt-live-chat-membership-item-renderer';
    if (!isText && !isSuper && !isMember) return;

    const nodeId = node.id || node.getAttribute('id');
    const key    = nodeId || node.textContent.trim().slice(0, 80);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }

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
