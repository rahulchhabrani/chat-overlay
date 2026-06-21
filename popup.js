document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  function updateSliderFill(val) {
    const pct = val + '%';
    $('opacity').style.background =
      `linear-gradient(to right, #7822e0 0%, #9b45ff ${pct}, #1e2035 ${pct})`;
  }

  function syncInput(inputId, wrapId, badgeId) {
    const hasVal = $(inputId).value.trim().length > 0;
    $(wrapId).classList.toggle('has-value', hasVal);
    if (badgeId) $(badgeId).classList.toggle('visible', hasVal);
  }

  chrome.storage.local.get(
    ['twitchChannel', 'kickChannel', 'targetSite', 'overlayWidth', 'overlayHeight', 'overlayOpacity'],
    s => {
      if (s.twitchChannel) $('twitch').value = s.twitchChannel;
      if (s.kickChannel)   $('kick').value   = s.kickChannel;
      if (s.targetSite)    $('site').value   = s.targetSite;
      if (s.overlayWidth)  $('width').value  = s.overlayWidth;
      if (s.overlayHeight) $('height').value = s.overlayHeight;

      const pct = s.overlayOpacity != null ? Math.round(s.overlayOpacity * 100) : 92;
      $('opacity').value = pct;
      $('opacityVal').textContent = pct + '%';
      updateSliderFill(pct);

      syncInput('twitch', 'twitch-wrap', 'twitch-status');
      syncInput('kick',   'kick-wrap',   'kick-status');
      syncInput('site',   'site-wrap',   null);

      const first = ['twitch', 'kick', 'site'].find(id => !$(id).value.trim());
      if (first) $(first).focus();
    }
  );

  $('twitch').addEventListener('input', () => syncInput('twitch', 'twitch-wrap', 'twitch-status'));
  $('kick').addEventListener('input',   () => syncInput('kick',   'kick-wrap',   'kick-status'));
  $('site').addEventListener('input',   () => syncInput('site',   'site-wrap',   null));

  function setupClear(clearId, inputId, wrapId, badgeId) {
    $(clearId).addEventListener('click', () => {
      $(inputId).value = '';
      syncInput(inputId, wrapId, badgeId);
      $(inputId).focus();
    });
  }
  setupClear('twitch-clear', 'twitch', 'twitch-wrap', 'twitch-status');
  setupClear('kick-clear',   'kick',   'kick-wrap',   'kick-status');
  setupClear('site-clear',   'site',   'site-wrap',   null);

  $('opacity').addEventListener('input', e => {
    $('opacityVal').textContent = e.target.value + '%';
    updateSliderFill(parseInt(e.target.value));
  });

  ['twitch', 'kick', 'site', 'width', 'height'].forEach(id => {
    $(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    });
  });

  $('close-btn').addEventListener('click', () => window.close());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.close();
  });

  chrome.tabs.query({ url: '*://www.youtube.com/*' }, tabs => {
    const liveTab = tabs.find(t => t.url && (t.url.includes('/live') || t.url.includes('v=')));
    if (liveTab) {
      const el = $('yt-status');
      el.textContent = '\u25cf live detected';
      el.classList.add('live');
    }
  });

  $('save').addEventListener('click', doSave);

  function doSave() {
    const twitchChannel = $('twitch').value.trim().replace(/^@/, '').replace(/^#/, '').toLowerCase();
    const kickChannel   = $('kick').value.trim().replace(/^@/, '').replace(/^#/, '').toLowerCase();
    const targetSite    = $('site').value.trim().toLowerCase() || 'chess.com';
    const width   = parseInt($('width').value)   || 300;
    const height  = parseInt($('height').value)  || 460;
    const opacity = parseInt($('opacity').value) / 100;

    chrome.storage.local.get(['targetSite'], old => {
      const oldSite = (old.targetSite || 'chess.com').trim().toLowerCase();

      chrome.storage.local.set(
        { twitchChannel, kickChannel, targetSite, overlayWidth: width, overlayHeight: height, overlayOpacity: opacity },
        () => {
          if (oldSite !== targetSite) {
            chrome.tabs.query({ url: '*:///*.' + oldSite + '/*' }, tabs => {
              tabs.forEach(tab =>
                chrome.tabs.sendMessage(tab.id, { type: 'CCO_CLOSE' }).catch(() => {})
              );
            });
          }

          chrome.tabs.query({ url: '*:///*.' + targetSite + '/*' }, tabs => {
            tabs.forEach(tab => {
              chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
                .catch(() => {})
                .finally(() => {
                  chrome.tabs.sendMessage(tab.id, {
                    type: 'CCO_UPDATE', twitchChannel, kickChannel, width, height, opacity,
                  }).catch(() => {});
                });
            });
          });

          syncInput('twitch', 'twitch-wrap', 'twitch-status');
          syncInput('kick',   'kick-wrap',   'kick-status');
          syncInput('site',   'site-wrap',   null);

          const btn = $('save');
          btn.textContent = '\u2713  Connected!';
          btn.classList.add('saved');
          setTimeout(() => {
            btn.innerHTML = '\u2713 &nbsp;Save &amp; Connect';
            btn.classList.remove('saved');
          }, 2000);

          $('status').textContent = 'Reload ' + targetSite + ' if needed.';
          setTimeout(() => { $('status').textContent = ''; }, 5000);
        }
      );
    });
  }
});
