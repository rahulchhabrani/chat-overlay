// Injected into YouTube watch/live_chat pages.
//
// YouTube's CSP blocks inline script injection (nonce-based script-src).
// Fix: load the poller from an extension URL via chrome.runtime.getURL(),
// which Chrome always allows regardless of page CSP. The loaded script runs
// in the PAGE's JS world with full access to ytInitialData, ytcfg, cookies.
// Messages are relayed back here via postMessage.
(function () {
  if (window.__cco_yt_injected) return;
  window.__cco_yt_injected = true;

  // ── Relay postMessages from page-world poller → background → chess tab ────
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.__cco !== 1) return;
    chrome.runtime.sendMessage({
      type:        'YT_CHAT_MSG',
      username:    e.data.u,
      text:        e.data.t,
      color:       e.data.c,
      isSuperchat: e.data.s,
    }).catch(() => {});
  });

  // ── Inject yt_poller.js into PAGE context via extension URL ───────────────
  // Using src= (not textContent) bypasses YouTube's nonce-based CSP.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('yt_poller.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
})();
