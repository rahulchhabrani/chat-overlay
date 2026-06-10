// Injected into YouTube watch pages and live_chat pages.
// Reads live chat and relays to chess.com overlay via background.js
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  const isLiveChatPage = location.pathname === '/live_chat';
  const isWatchPage    = location.pathname === '/watch';

  if (isLiveChatPage) {
    // We're directly in the live_chat page (e.g. pop-out chat)
    waitForContainer(document);
  } else if (isWatchPage) {
    // Watch page — chat lives inside an iframe (#live-chat-iframe)
    // Both are youtube.com so we can access iframe.contentDocument directly
    findIframe();
  }

  // ── Find the live chat iframe on the watch page ────────────────────────────
  function findIframe() {
    const attempt = () => {
      const iframe = document.querySelector('#live-chat-iframe');
      if (!iframe) {
        // Maybe not a live stream — check for popout iframe
        return setTimeout(attempt, 3000);
      }
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!doc || doc.readyState === 'loading') {
        return setTimeout(attempt, 2000);
      }
      waitForContainer(doc);
    };
    // Give the page time to load
    setTimeout(attempt, 4000);
  }

  // ── Wait until the message list container exists, then observe ─────────────
  function waitForContainer(doc) {
    const attempt = () => {
      const container =
        doc.querySelector('#items.yt-live-chat-item-list-renderer') ||
        doc.querySelector('yt-live-chat-item-list-renderer #items');
      if (container) {
        observe(container);
      } else {
        setTimeout(attempt, 2000);
      }
    };
    attempt();
  }

  // ── MutationObserver on the message list ──────────────────────────────────
  function observe(container) {
    const seen = new Set();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => handleNode(node, seen));
      });
    });
    observer.observe(container, { childList: true });
  }

  function handleNode(node, seen) {
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();

    const isText    = tag === 'yt-live-chat-text-message-renderer';
    const isSuper   = tag === 'yt-live-chat-paid-message-renderer';
    const isMember  = tag === 'yt-live-chat-membership-item-renderer';
    if (!isText && !isSuper && !isMember) return;

    // Deduplicate by element id
    const nodeId = node.id || node.getAttribute('id');
    if (nodeId) {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
    }

    const authorEl = node.querySelector('#author-name');
    const msgEl    = node.querySelector('#message') ||
                     node.querySelector('#header-subtext') ||
                     node.querySelector('#header-primary-text');
    if (!authorEl) return;

    const username = authorEl.textContent.trim();
    const text     = msgEl ? msgEl.textContent.trim() : isMember ? '★ New member!' : '';
    if (!username || !text) return;

    // Role-based colors
    let color = null;
    const badgesEl = node.querySelector('#author-badges');
    if (badgesEl) {
      const b = badgesEl.innerHTML;
      if (b.includes('owner'))     color = '#FFD700';
      else if (b.includes('moderator')) color = '#5E84F1';
      else if (b.includes('member'))    color = '#2BA640';
    }
    if (isSuper) color = '#FF9800';
    if (isMember) color = '#2BA640';

    chrome.runtime.sendMessage({
      type:       'YT_CHAT_MSG',
      username,
      text,
      color,
      isSuperchat: isSuper,
    }).catch(() => {});
  }
})();
