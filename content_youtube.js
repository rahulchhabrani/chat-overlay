// Injected into YouTube watch/live_chat pages.
//
// Architecture shift: instead of scraping the DOM (which breaks when Chrome
// suspends requestAnimationFrame in background tabs), this script only extracts
// the continuation token from ytInitialData and hands it to the background
// service worker, which polls YouTube's live chat API independently of any
// tab's visibility state.
(function () {
  if (window.__cco_yt_active) return;
  window.__cco_yt_active = true;

  function extractToken() {
    try {
      const conts = window.ytInitialData?.contents?.liveChatRenderer?.continuations;
      if (!conts?.length) return null;
      const c = conts[0];
      return c?.invalidationContinuationData?.continuation
          || c?.timedContinuationData?.continuation
          || c?.reloadContinuationData?.continuation
          || null;
    } catch (e) { return null; }
  }

  function sendInit() {
    const token = extractToken();
    if (!token) return false;
    const clientVersion = window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION || '2.20260612.00.00';
    chrome.runtime.sendMessage({ type: 'YT_INIT', continuation: token, clientVersion })
      .catch(() => {});
    return true;
  }

  // Try immediately; ytInitialData is usually already present on document_idle
  if (!sendInit()) {
    let attempts = 0;
    const iv = setInterval(() => {
      if (sendInit() || ++attempts > 60) clearInterval(iv);
    }, 500);
  }

  // Re-send if the user focuses the tab (background service worker may have
  // woken from sleep and lost the continuation token)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sendInit();
  });
  window.addEventListener('focus', sendInit);
})();
