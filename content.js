(function () {
  if (document.getElementById('cco-root')) return;

  chrome.storage.sync.get(['targetSite'], function(ts) {
    const site = (ts.targetSite || 'chess.com').trim().toLowerCase();
    if (!location.hostname.includes(site)) return;
    initOverlay();
  });

  function initOverlay() {
  // WebSockets now run in background.js; content.js only handles UI
  let statusEl = null, msgList = null, scrollBtn = null;
  let autoScroll = true;
  let programmaticScroll = false;
  const platformStatus = { twitch: '', kick: '', yt: '' };
  let msgCache = [], renderQueue = [], rafId = null;
  const nodePool = [];
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { chrome.storage.local.set({ cco_messages: msgCache }); saveTimer = null; }, 30000);
  }
  window.addEventListener('beforeunload', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (msgCache.length) chrome.storage.local.set({ cco_messages: msgCache });
  });
  const TWITCH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>';
  const KICK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="black"><path d="M4 3h3.5v7l6-7H18l-7 9 7 9h-4.5l-6-7.5V21H4V3z"/></svg>';
  const YT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
  const PLATFORM_ICON = {
    twitch: { bg: '#9147ff', svg: TWITCH_SVG },
    kick:   { bg: '#53FC18', svg: KICK_SVG },
    yt:     { bg: '#FF0000', svg: YT_SVG },
  };
  if (!document.getElementById('cco-styles')) {
    const style = document.createElement('style');
    style.id = 'cco-styles';
    style.textContent = '#cco-scroll-btn{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(100,65,200,0.88);color:#fff;border:none;border-radius:20px;padding:5px 14px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;z-index:2;letter-spacing:0.3px;box-shadow:0 2px 8px rgba(0,0,0,0.5);transition:background 0.15s;}#cco-scroll-btn:hover{background:rgba(120,80,230,0.95);}@keyframes cco-in{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}';
    (document.head || document.documentElement).appendChild(style);
  }
  function buildRow(username, color, text, twitchBadges, platform, isSuperchat, amount) {
    const pi = PLATFORM_ICON[platform] || { bg: '#444', svg: '' };
    const row = nodePool.pop() || document.createElement('div');
    row.dataset.sc = isSuperchat ? '1' : '';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 12px;flex-shrink:0;transition:background 0.1s;animation:cco-in 0.18s ease forwards;' + (isSuperchat ? 'background:rgba(255,152,0,0.08);' : '');
    const iconBox = document.createElement('div');
    iconBox.style.cssText = 'width:20px;height:20px;border-radius:5px;background:' + pi.bg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    iconBox.innerHTML = pi.svg;
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;font-size:14px;line-height:1.45;word-break:break-word;';
    if (twitchBadges) {
      const addBadge = ch => { const b = document.createElement('span'); b.style.cssText = 'font-size:10px;margin-right:2px;vertical-align:middle;'; b.textContent = ch; content.appendChild(b); };
      if (twitchBadges.includes('broadcaster')) addBadge('🎙');
      else if (twitchBadges.includes('moderator')) addBadge('⚔️');
      if (twitchBadges.includes('subscriber')) addBadge('⭐');
      if (twitchBadges.includes('vip')) addBadge('💎');
    }
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'color:' + (color || autoColor(username)) + ';font-weight:700;';
    nameSpan.textContent = username;
    const sep = document.createElement('span');
    sep.style.cssText = 'color:#555;';
    sep.textContent = '  ';
    const msgSpan = document.createElement('span');
    msgSpan.style.cssText = 'color:#ffffff;font-weight:400;';
    msgSpan.textContent = text;
    content.appendChild(nameSpan);

    // Superchat amount badge
    if (isSuperchat && amount) {
      const amtBadge = document.createElement('span');
      amtBadge.style.cssText = 'background:rgba(255,152,0,0.25);color:#FF9800;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:5px;vertical-align:middle;';
      amtBadge.textContent = amount;
      content.appendChild(amtBadge);
    }

    content.appendChild(sep); content.appendChild(msgSpan);
    row.appendChild(iconBox); row.appendChild(content);
    return row;
  }
  function flushQueue() {
    rafId = null;
    if (!renderQueue.length || !msgList) return;
    const batch = renderQueue.splice(0, 5);
    const frag = document.createDocumentFragment();
    batch.forEach(m => frag.appendChild(buildRow(m.username, m.color, m.text, m.twitchBadges, m.platform, m.isSuperchat, m.amount)));
    msgList.appendChild(frag);
    if (renderQueue.length > 0 && !rafId) rafId = requestAnimationFrame(flushQueue);
    while (msgList.children.length > 200) {
      const old = msgList.firstChild; msgList.removeChild(old);
      if (nodePool.length < 30) { old.dataset.sc = ''; old.style.background = ''; while (old.firstChild) old.removeChild(old.firstChild); nodePool.push(old); }
    }
    if (autoScroll) { programmaticScroll = true; msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' }); }
    else if (scrollBtn) { scrollBtn.style.display = 'block'; }
  }
  function renderMessage(username, color, text, twitchBadges, platform, isSuperchat, skipSave, amount) {
    if (!msgList) return;
    clearPlaceholder();
    if (!skipSave) {
      msgCache.push({ username, color, text, badges: twitchBadges, platform, isSuperchat, amount });
      if (msgCache.length > 100) msgCache.splice(0, msgCache.length - 100);
      scheduleSave();
    }
    renderQueue.push({ username, color, text, twitchBadges, platform, isSuperchat, amount });
    if (!rafId) rafId = requestAnimationFrame(flushQueue);
  }
  chrome.storage.sync.get(
    ['twitchChannel', 'kickChannel', 'overlayWidth', 'overlayHeight', 'overlayOpacity', 'overlayLeft', 'overlayTop'],
    function (s) {
      const width = s.overlayWidth || 300;
      const height = s.overlayHeight || 460;
      const opacity = s.overlayOpacity != null ? s.overlayOpacity : 0.92;
      const root = document.createElement('div');
      root.id = 'cco-root';
      Object.assign(root.style, { position: 'fixed', zIndex: '2147483647', width: width + 'px', height: height + 'px', right: '16px', bottom: '16px', display: 'flex', flexDirection: 'column', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 6px 30px rgba(0,0,0,0.7)', opacity: String(opacity), fontFamily: '-apple-system,BlinkMacSystemFont,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif', background: '#111116', contain: 'layout style' });
      if (s.overlayLeft != null && s.overlayTop != null) { root.style.right = 'auto'; root.style.bottom = 'auto'; root.style.left = s.overlayLeft + 'px'; root.style.top = s.overlayTop + 'px'; }
      const header = document.createElement('div');
      Object.assign(header.style, { background: '#1a1a22', borderBottom: '1px solid #222230', color: '#aaa', padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'move', userSelect: 'none', flexShrink: '0', gap: '6px', minHeight: '30px' });
      statusEl = document.createElement('span');
      statusEl.style.cssText = 'flex:1;font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:0.2px;display:flex;align-items:center;gap:5px;';
      updateHeader();
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:2px;flex-shrink:0;';
      const BS = () => 'background:none;border:none;color:#777;cursor:pointer;font-size:13px;padding:1px 4px;border-radius:3px;line-height:1;';
      btns.innerHTML = '<button id="cco-dim" title="Dim" style="' + BS() + '">◑</button><button id="cco-collapse" title="Collapse" style="' + BS() + '">—</button><button id="cco-close" title="Close" style="' + BS() + '">✕</button>';
      header.appendChild(statusEl); header.appendChild(btns);
      msgList = document.createElement('div');
      Object.assign(msgList.style, { flex: '1', overflowY: 'auto', overflowX: 'hidden', padding: '6px 0', display: 'flex', flexDirection: 'column', scrollbarWidth: 'thin', scrollbarColor: '#2a2a3a #111116', contain: 'layout style paint', willChange: 'transform', scrollBehavior: 'smooth' });
      scrollBtn = document.createElement('button');
      scrollBtn.id = 'cco-scroll-btn'; scrollBtn.textContent = '↓ new messages'; scrollBtn.style.display = 'none';
      scrollBtn.addEventListener('click', () => { programmaticScroll = true; msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' }); autoScroll = true; scrollBtn.style.display = 'none'; });
      const resizer = document.createElement('div');
      Object.assign(resizer.style, { position: 'absolute', bottom: '0', left: '0', width: '14px', height: '14px', cursor: 'sw-resize', background: 'linear-gradient(135deg,#2a2a3a 50%,transparent 50%)', zIndex: '1' });
      root.appendChild(header); root.appendChild(msgList); root.appendChild(scrollBtn); root.appendChild(resizer);
      document.body.appendChild(root);
      msgList.addEventListener('mouseover', e => { let t = e.target; while (t && t.parentNode !== msgList) t = t.parentNode; if (t && t !== msgList) t.style.background = t.dataset.sc ? 'rgba(255,152,0,0.13)' : 'rgba(255,255,255,0.04)'; });
      msgList.addEventListener('mouseout', e => { let t = e.target; while (t && t.parentNode !== msgList) t = t.parentNode; if (t && t !== msgList) t.style.background = t.dataset.sc ? 'rgba(255,152,0,0.08)' : ''; });
      chrome.storage.local.get(['cco_messages'], function(stored) {
        msgCache = stored.cco_messages || [];
        if (msgCache.length > 0) { clearPlaceholder(); const frag = document.createDocumentFragment(); msgCache.forEach(m => frag.appendChild(buildRow(m.username, m.color, m.text, m.badges || '', m.platform, m.isSuperchat, m.amount))); msgList.appendChild(frag); programmaticScroll = true; msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' }); }
        if (s.twitchChannel) chrome.runtime.sendMessage({ type: 'TWITCH_CONNECT', channel: s.twitchChannel });
        if (s.kickChannel)   chrome.runtime.sendMessage({ type: 'KICK_CONNECT', channel: s.kickChannel });
        if (!s.twitchChannel && !s.kickChannel && msgCache.length === 0) showPlaceholder();
      });
      msgList.addEventListener('scrollend', () => { programmaticScroll = false; });
      msgList.addEventListener('scroll', () => { if (programmaticScroll) return; autoScroll = (msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight) < 40; if (autoScroll) scrollBtn.style.display = 'none'; }, { passive: true });
      let dragging = false, dox = 0, doy = 0;
      header.addEventListener('mousedown', e => { if (e.target.tagName === 'BUTTON') return; dragging = true; const r = root.getBoundingClientRect(); dox = e.clientX - r.left; doy = e.clientY - r.top; root.style.right = 'auto'; root.style.bottom = 'auto'; e.preventDefault(); });
      document.addEventListener('mousemove', e => { if (!dragging) return; const w = parseInt(root.style.width) || 300; root.style.left = Math.max(-w + 60, Math.min(window.innerWidth - 60, e.clientX - dox)) + 'px'; root.style.top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - doy)) + 'px'; });
      document.addEventListener('mouseup', () => { if (!dragging) return; dragging = false; chrome.storage.sync.set({ overlayLeft: parseInt(root.style.left), overlayTop: parseInt(root.style.top) }); });
      let resizing = false, rx0, ry0, rw0, rh0, rl0, rt0;
      resizer.addEventListener('mousedown', e => { resizing = true; rx0 = e.clientX; ry0 = e.clientY; const r = root.getBoundingClientRect(); rw0 = r.width; rh0 = r.height; rl0 = r.left; rt0 = r.top; root.style.right = 'auto'; root.style.bottom = 'auto'; e.stopPropagation(); e.preventDefault(); });
      document.addEventListener('mousemove', e => { if (!resizing) return; const nw = Math.max(180, rw0 + (rx0 - e.clientX)); const nh = Math.max(130, rh0 + (e.clientY - ry0)); root.style.width = nw + 'px'; root.style.height = nh + 'px'; root.style.left = (rl0 + rw0 - nw) + 'px'; root.style.top = rt0 + 'px'; });
      document.addEventListener('mouseup', () => { if (!resizing) return; resizing = false; chrome.storage.sync.set({ overlayWidth: parseInt(root.style.width), overlayHeight: parseInt(root.style.height) }); });
      let collapsed = false, savedH = height;
      root.querySelector('#cco-collapse').addEventListener('click', () => { collapsed = !collapsed; if (collapsed) { savedH = parseInt(root.style.height) || height; msgList.style.display = 'none'; root.style.height = 'auto'; root.querySelector('#cco-collapse').textContent = '▢'; } else { root.style.height = savedH + 'px'; msgList.style.display = 'flex'; root.querySelector('#cco-collapse').textContent = '—'; } });
      let dimmed = false;
      root.querySelector('#cco-dim').addEventListener('click', () => { dimmed = !dimmed; if (dimmed) { root.style.background = 'transparent'; root.style.boxShadow = 'none'; header.style.background = 'transparent'; header.style.borderBottom = '1px solid rgba(255,255,255,0.08)'; msgList.style.background = 'transparent'; msgList.style.scrollbarColor = 'rgba(42,42,58,0.4) transparent'; } else { root.style.background = '#111116'; root.style.boxShadow = '0 6px 30px rgba(0,0,0,0.7)'; header.style.background = '#1a1a22'; header.style.borderBottom = '1px solid #222230'; msgList.style.background = ''; msgList.style.scrollbarColor = '#2a2a3a #111116'; } });
      root.querySelector('#cco-close').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'TWITCH_DISCONNECT' }); chrome.runtime.sendMessage({ type: 'KICK_DISCONNECT' }); if (rafId) { cancelAnimationFrame(rafId); rafId = null; } renderQueue.length = 0; root.remove(); });
      chrome.runtime.onMessage.addListener(msg => {
        if (msg.type === 'TWITCH_MSG') { renderMessage(msg.username, msg.color, msg.text, msg.badges, 'twitch', false); return; }
        if (msg.type === 'KICK_MSG') { renderMessage(msg.username, msg.color, msg.text, '', 'kick', false); return; }
        if (msg.type === 'TWITCH_STATUS') { platformStatus.twitch = msg.status; updateHeader(); return; }
        if (msg.type === 'KICK_STATUS') { platformStatus.kick = msg.status; updateHeader(); return; }
        if (msg.type === 'YT_CHAT_MSG') { platformStatus.yt = '🔴YT'; updateHeader(); renderMessage((msg.username || '').replace(/^@+/, ''), msg.color || null, msg.text, '', 'yt', msg.isSuperchat, false, msg.amount); return; }
        if (msg.type === 'CCO_CLOSE') { chrome.runtime.sendMessage({ type: 'TWITCH_DISCONNECT' }); chrome.runtime.sendMessage({ type: 'KICK_DISCONNECT' }); const r = document.getElementById('cco-root'); if (r) r.remove(); return; }
        if (msg.type !== 'CCO_UPDATE') return;
        root.style.opacity = String(msg.opacity); root.style.width = msg.width + 'px';
        if (!collapsed) root.style.height = msg.height + 'px';
        const curTop = parseInt(root.style.top);
        if (!isNaN(curTop) && curTop < 0) { root.style.top = '16px'; chrome.storage.sync.set({ overlayTop: 16 }); }
        if (msg.twitchChannel !== undefined) { if (msg.twitchChannel) { clearPlaceholder(); chrome.runtime.sendMessage({ type: 'TWITCH_CONNECT', channel: msg.twitchChannel }); } else { chrome.runtime.sendMessage({ type: 'TWITCH_DISCONNECT' }); platformStatus.twitch = ''; updateHeader(); } }
        if (msg.kickChannel !== undefined) { if (msg.kickChannel) { clearPlaceholder(); chrome.runtime.sendMessage({ type: 'KICK_CONNECT', channel: msg.kickChannel }); } else { chrome.runtime.sendMessage({ type: 'KICK_DISCONNECT' }); platformStatus.kick = ''; updateHeader(); } }
      });
    }
  );
  function updateHeader() {
    if (!statusEl) return;
    const dots = [{ color: '#9147ff', active: !!platformStatus.twitch }, { color: '#53FC18', active: !!platformStatus.kick }, { color: '#FF0000', active: !!platformStatus.yt }];
    const dotsHtml = dots.map(d => '<span style="width:7px;height:7px;border-radius:50%;background:' + (d.active ? d.color : '#2a2a3a') + ';display:inline-block;flex-shrink:0;"></span>').join('');
    statusEl.innerHTML = '<span style="color:#aaa;font-size:10px;font-weight:600;letter-spacing:0.5px;">LIVE CHAT</span><span style="display:inline-flex;align-items:center;gap:4px;">' + dotsHtml + '</span>';
  }
  function showPlaceholder() {
    if (!msgList) return;
    Object.assign(msgList.style, { alignItems: 'center', justifyContent: 'center', textAlign: 'center' });
    msgList.innerHTML = '<div style="color:#444;font-size:12px;padding:20px;line-height:1.8;"><div style="font-size:26px;margin-bottom:10px;">💬</div><div style="color:#555;font-weight:600;margin-bottom:4px;">Not configured</div><div style="color:#333;font-size:11px;">Click the extension icon to set up</div></div>';
  }
  function clearPlaceholder() {
    if (!msgList) return;
    if (msgList.querySelector('div[style*="font-size:26px"]')) { msgList.innerHTML = ''; Object.assign(msgList.style, { alignItems: '', justifyContent: '', textAlign: '' }); }
  }
  function autoColor(name) {
    const p = ['#FF7B7B','#7BF0D0','#7BC7FF','#D4A5FF','#FFD97B','#B5FFB5','#FF9F9F','#9FEFFF'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return p[Math.abs(h) % p.length];
  }
  } // end initOverlay
})();
