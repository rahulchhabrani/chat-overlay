// Injected into YouTube watch pages and live_chat pages.
// Reads live chat and relays to the overlay via background.js
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  if (location.pathname === '/live_chat') {
    waitForContainer(document);
  } else if (location.pathname === '/watch') {
    findIframe();
  }

  // ── Find the live-chat iframe ─────────────────────────────────────────────
  function findIframe() {
    const tryConnect = (iframe) => {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && doc.readyState !== 'loading') {
        waitForContainer(doc);
      } else {
        iframe.addEventListener('load', () => {
          const d = iframe.contentDocument || iframe.contentWindow?.document;
          if (d) waitForContainer(d);
        }, { once: true });
      }
    };

    const iframe = document.querySelector('#live-chat-iframe');
    if (iframe) { tryConnect(iframe); return; }

    // Wait for iframe to appear — no setTimeout polling
    const obs = new MutationObserver(() => {
      const el = document.querySelector('#live-chat-iframe');
      if (el) { obs.disconnect(); tryConnect(el); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── Wait for yt-live-chat-item-list-renderer ──────────────────────────────
  // Observing this parent (rather than #items directly) means we survive #items rebuilds.
  function waitForContainer(doc) {
    const getRenderer = () => doc.querySelector('yt-live-chat-item-list-renderer');
    const r = getRenderer();
    if (r) { attachObserver(r); return; }

    const obs = new MutationObserver(() => {
      const found = getRenderer();
      if (found) { obs.disconnect(); attachObserver(found); }
    });
    obs.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
  }

  // ── Attach MutationObserver with auto-reconnect on detach ─────────────────
  function attachObserver(renderer) {
    const seen = new Set();
    let mo = null;

    function connect(node) {
      if (mo) mo.disconnect();
      mo = new MutationObserver((mutations) => {
        // If YouTube rebuilt the renderer and detached this node, reconnect
        if (!node.isConnected) {
          mo.disconnect(); mo = null;
          waitForContainer(node.ownerDocument);
          return;
        }
        if (seen.size > 400) seen.clear();
        mutations.forEach(m => m.addedNodes.forEach(n => handleNode(n, seen)));
      });
      // subtree:true catches messages even when YouTube replaces #items inside the renderer
      mo.observe(node, { childList: true, subtree: true });
    }

    connect(renderer);

    // Watchdog: safety net in case isConnected check is never reached
    const watchdog = setInterval(() => {
      if (!renderer.isConnected) {
        clearInterval(watchdog);
        if (mo) { mo.disconnect(); mo = null; }
        const doc = renderer.ownerDocument;
        if (doc && doc.body) waitForContainer(doc);
      }
    }, 10000);
  }

  // ── Parse and relay a single chat node ───────────────────────────────────
  function handleNode(node, seen) {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();
    const isText   = tag === 'yt-live-chat-text-message-renderer';
    const isSuper  = tag === 'yt-live-chat-paid-message-renderer';
    const isMember = tag === 'yt-live-chat-membership-item-renderer';
    if (!isText && !isSuper && !isMember) return;

    // Deduplicate: prefer node id, fall back to content fingerprint
    const nodeId = node.id || node.getAttribute('id');
    const key = nodeId || node.textContent.trim().slice(0, 80);
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
