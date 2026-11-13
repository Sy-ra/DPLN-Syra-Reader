// Envoie l'URL des onglets dofuspourlesnoobs.com à l'app locale DPLN Syra Reader
const SITE_RE = /^https?:\/\/(www\.)?dofuspourlesnoobs\.com\/.+\.html/i;
const ENDPOINT = 'http://127.0.0.1:47800/open';
let lastSent = '';

async function send(url) {
  if (!url || !SITE_RE.test(url)) return;
  url = url.split('#')[0];
  if (url === lastSent) return;
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    if (r.ok) lastSent = url;
  } catch (_) { /* app fermée : on ignore */ }
}

// Nouvelle page chargée dans un onglet actif
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if ((info.status === 'complete' || info.url) && tab.active) send(tab.url);
});
// Changement d'onglet
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const tab = await chrome.tabs.get(tabId); send(tab.url); } catch (_) {}
});