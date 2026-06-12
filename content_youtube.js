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

  // ── Find the live-chat iframe — MutationObserver instead of setTimeout polling ──
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

    // Watch for iframe insertion — fires as soon as it appears, no delay
    const obs = new MutationObserver(() => {
      const el = document.querySelector('#live-chat-iframe');
      if (el) { obs.disconnect(); tryConnect(el); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ── Wait for the message list container — MutationObserver, no polling ────────
  function waitForContainer(doc) {
    const getContainer = () =>
      doc.querySelector('#items.yt-live-chat-item-list-renderer') ||
      doc.querySelector('yt-live-chat-item-list-renderer #items');

    const c = getContainer();
    if (c) { observe(c); return; }

    const root = doc.body || doc.documentElement;
    if (!root) return;
    const obs = new MutationObserver(() => {
      const found = getContainer();
      if (found) { obs.disconnect(); observe(found); }
    });
    obs.observe(root, { childList: true, subtree: true });
  }

  // ── MutationObserver on the message list ──────────────────────────────────────
  function observe(container) {
    const seen = new Set();
    new MutationObserver((mutations) => {
      // Trim seen set to prevent unbounded growth (YouTube recycles DOM nodes)
      if (seen.size > 300) seen.clear();
      mutations.forEach(m => m.addedNodes.forEach(n => handleNode(n, seen)));
    }).observe(container, { childList: true });
  }

  function handleNode(node, seen) {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();
    const isText   = tag === 'yt-live-chat-text-message-renderer';
    const isSuper  = tag === 'yt-live-chat-paid-message-renderer';
    const isMember = tag === 'yt-live-chat-membership-item-renderer';
    if (!isText && !isSuper && !isMember) return;

    // Deduplicate: prefer node id, fall back to content hash
    const nodeId = node.id || node.getAttribute('id');
    const key = nodeId || (node.textContent.trim().slice(0, 80));
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
