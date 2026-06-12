// Runs in PAGE JS world (loaded via chrome.runtime.getURL to bypass CSP).
// Has full access to window.ytInitialData, window.ytcfg, and session cookies.
// Sends chat messages to the content script via postMessage.
(function () {
  if (window.__cco_poll) return;
  window.__cco_poll = true;

  var cont = null, pollTimer = null, seen = new Set();

  function getCtx() {
    var d = (window.ytcfg && window.ytcfg.data_) || {};
    return {
      client: {
        clientName: 'WEB',
        clientVersion: d.INNERTUBE_CLIENT_VERSION || '2.20260612.00.00',
        hl: d.HL || 'en',
        gl: d.GL || 'US',
        visitorData: d.VISITOR_DATA || ''
      }
    };
  }

  function init() {
    try {
      var yd = window.ytInitialData;
      if (!yd) return false;
      var lr = yd.contents && yd.contents.liveChatRenderer;
      var cs = lr && lr.continuations;
      if (!cs || !cs.length) return false;
      var c = cs[0];
      cont = (c.invalidationContinuationData && c.invalidationContinuationData.continuation)
           || (c.timedContinuationData && c.timedContinuationData.continuation)
           || (c.reloadContinuationData && c.reloadContinuationData.continuation) || null;
      return !!cont;
    } catch (e) { return false; }
  }

  function sched(ms) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  function poll() {
    if (!cont) return;
    var ctx = getCtx();
    fetch('/youtubei/v1/live_chat/get_live_chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': ctx.client.clientVersion,
        'x-origin': 'https://www.youtube.com'
      },
      body: JSON.stringify({ context: ctx, continuation: cont })
    })
      .then(function (r) { if (!r.ok) { sched(5000); return null; } return r.json(); })
      .then(function (data) {
        if (!data) return;
        var lcc = data.continuationContents && data.continuationContents.liveChatContinuation;
        if (!lcc) { sched(5000); return; }
        var nc = (lcc.continuations || [])[0];
        var next = (nc && nc.invalidationContinuationData && nc.invalidationContinuationData.continuation)
                || (nc && nc.timedContinuationData && nc.timedContinuationData.continuation);
        var delay = Math.min(
          (nc && nc.invalidationContinuationData && nc.invalidationContinuationData.timeoutMs)
          || (nc && nc.timedContinuationData && nc.timedContinuationData.timeoutMs) || 5000,
          5000
        );
        if (next) cont = next;
        (lcc.actions || []).forEach(function (a) {
          var item = a.addChatItemAction && a.addChatItemAction.item;
          if (!item) return;
          var msg = parse(item);
          if (!msg || seen.has(msg.id)) return;
          seen.add(msg.id);
          if (seen.size > 2000) { var arr = Array.from(seen); seen = new Set(arr.slice(-500)); }
          window.postMessage({ __cco: 1, u: msg.u, t: msg.t, c: msg.c, s: msg.s }, '*');
        });
        sched(delay);
      })
      .catch(function () { sched(5000); });
  }

  function parse(item) {
    var r = item.liveChatTextMessageRenderer
           || item.liveChatPaidMessageRenderer
           || item.liveChatMembershipItemRenderer;
    if (!r) return null;
    var paid = !!item.liveChatPaidMessageRenderer;
    var member = !!item.liveChatMembershipItemRenderer;
    var id = r.id || Math.random().toString(36).slice(2);
    var u = (r.authorName && r.authorName.simpleText) || '';
    if (!u) return null;
    var t = '';
    if (r.message && r.message.runs) {
      t = r.message.runs.map(function (x) {
        return x.text != null ? x.text
          : ((x.emoji && x.emoji.shortcuts && x.emoji.shortcuts[0])
            || (x.emoji && x.emoji.emojiId) || '');
      }).join('');
    } else if (r.headerSubtext && r.headerSubtext.runs) {
      t = r.headerSubtext.runs.map(function (x) { return x.text || ''; }).join('');
    }
    if (!t) t = member ? '\u2605 New member!' : '';
    if (!t) return null;
    var c = null;
    (r.authorBadges || []).forEach(function (b) {
      if (c) return;
      var tip = ((b.liveChatAuthorBadgeRenderer && b.liveChatAuthorBadgeRenderer.tooltip) || '').toLowerCase();
      if (tip.indexOf('owner') >= 0) c = '#FFD700';
      else if (tip.indexOf('moderator') >= 0) c = '#5E84F1';
      else if (tip.indexOf('member') >= 0) c = '#2BA640';
    });
    if (paid) c = '#FF9800';
    if (member) c = c || '#2BA640';
    return { id: id, u: u, t: t, c: c, s: paid };
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && cont) {
      if (pollTimer) clearTimeout(pollTimer);
      poll();
    }
  });

  if (init()) {
    poll();
  } else {
    var n = 0, iv = setInterval(function () {
      if (init() || ++n > 60) { clearInterval(iv); if (cont) poll(); }
    }, 500);
  }
})();
