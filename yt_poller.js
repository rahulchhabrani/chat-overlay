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
          2500
        );
        if (next) cont = next;
        var msgDelay = 0;
        (lcc.actions || []).forEach(function (a) {
          var item = a.addChatItemAction && a.addChatItemAction.item;
          if (!item) return;
          var msg = parse(item);
          if (!msg || seen.has(msg.id)) return;
          seen.add(msg.id);
          if (seen.size > 2000) { var arr = Array.from(seen); seen = new Set(arr.slice(-500)); }
          // Spread messages over time so they trickle in instead of all popping at once
          (function(m, d) {
            setTimeout(function() {
              window.postMessage({ __cco: 1, u: m.u, t: m.t, c: m.c, s: m.s, a: m.a, hc: m.hc, bc: m.bc }, '*');
            }, d);
          })(msg, msgDelay);
          msgDelay = Math.min(msgDelay + 80, 1200); // 80ms apart, max 1.2s spread
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
    var amount = paid && r.purchaseAmountText ? r.purchaseAmountText.simpleText || null : null;
    var hc = null, bc = null;
    if (paid) {
      var toHex = function(n) { var u = n >>> 0; return '#' + [(u>>16)&255,(u>>8)&255,u&255].map(function(x){return x.toString(16).padStart(2,'0');}).join(''); };
      if (r.headerBackgroundColor != null) hc = toHex(r.headerBackgroundColor);
      if (r.bodyBackgroundColor   != null) bc = toHex(r.bodyBackgroundColor);
    }
    var id = r.id || Math.random().toString(36).slice(2);
    var u = (r.authorName && r.authorName.simpleText) || '';
    if (!u) return null;
    var t = '';
    if (r.message && r.message.runs) {
      t = r.message.runs.map(function (x) {
        // x.text can be "" on emoji runs — check truthiness, not null
        if (x.text) return x.text;
        if (x.emoji) {
          var ei = x.emoji.emojiId || '';
          // Standard Unicode emoji: emojiId IS the character itself (e.g. "👍")
          if (ei && !x.emoji.isCustomEmoji) return ei;
          // Custom channel emoji: embed image URL using PUA delimiters \uE000…\uE002
          // so the renderer can create <img> elements without innerHTML
          var acc = x.emoji.image && x.emoji.image.accessibility
                 && x.emoji.image.accessibility.accessibilityData
                 && x.emoji.image.accessibility.accessibilityData.label;
          var thumbs = x.emoji.image && x.emoji.image.thumbnails;
          var eurl = thumbs && thumbs[0] && thumbs[0].url || '';
          var elbl = acc || (x.emoji.shortcuts && x.emoji.shortcuts[0]) || '';
          if (eurl) return '' + eurl + '' + elbl + '';
          if (elbl) return '[' + elbl + ']';
          return '';
        }
        return '';
      }).join('');
    } else if (r.headerSubtext && r.headerSubtext.runs) {
      t = r.headerSubtext.runs.map(function (x) { return x.text || ''; }).join('');
    }
    if (!t) t = member ? '★ New member!' : '';
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
    return { id: id, u: u, t: t, c: c, s: paid, a: amount, hc: hc, bc: bc };
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
