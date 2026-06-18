document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  chrome.storage.local.get(['twitchChannel', 'kickChannel', 'targetSite', 'overlayWidth', 'overlayHeight', 'overlayOpacity'], s => {
    if (s.twitchChannel) $('twitch').value  = s.twitchChannel;
    if (s.kickChannel)   $('kick').value    = s.kickChannel;
    if (s.targetSite)    $('site').value    = s.targetSite;
    if (s.overlayWidth)  $('width').value   = s.overlayWidth;
    if (s.overlayHeight) $('height').value  = s.overlayHeight;
    if (s.overlayOpacity != null) {
      const pct = Math.round(s.overlayOpacity * 100);
      $('opacity').value = pct;
      $('opacityVal').textContent = pct + '%';
    }
  });

  $('opacity').addEventListener('input', e => {
    $('opacityVal').textContent = e.target.value + '%';
  });

  $('save').addEventListener('click', () => {
    const twitchChannel = $('twitch').value.trim().replace(/^#/, '').toLowerCase();
    const kickChannel   = $('kick').value.trim().replace(/^#/, '').toLowerCase();
    const targetSite    = $('site').value.trim().toLowerCase() || 'chess.com';
    const width   = parseInt($('width').value)   || 300;
    const height  = parseInt($('height').value)  || 460;
    const opacity = parseInt($('opacity').value) / 100;

    // Get old site so we can close overlay there if site changed
    chrome.storage.local.get(['targetSite'], old => {
      const oldSite = (old.targetSite || 'chess.com').trim().toLowerCase();

      chrome.storage.local.set({ twitchChannel, kickChannel, targetSite, overlayWidth: width, overlayHeight: height, overlayOpacity: opacity }, () => {

        // If site changed, close overlay on old-site tabs
        if (oldSite !== targetSite) {
          chrome.tabs.query({ url: '*://*.' + oldSite + '/*' }, tabs => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'CCO_CLOSE' }).catch(() => {}));
          });
        }

        // Inject + update new-site tabs (background handles new navigations;
        // here we handle already-open tabs on the target site)
        chrome.tabs.query({ url: '*://*.' + targetSite + '/*' }, tabs => {
          tabs.forEach(tab => {
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
              .catch(() => {})
              .finally(() => {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'CCO_UPDATE',
                  twitchChannel,
                  kickChannel,
                  width,
                  height,
                  opacity,
                }).catch(() => {});
              });
          });
        });

        $('status').style.color = '#4caf50';
        $('status').textContent = 'â Saved! Reload ' + targetSite + ' if needed.';
        setTimeout(() => { $('status').textContent = ''; }, 4000);
      });
    });
  });
});
