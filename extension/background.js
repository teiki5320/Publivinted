// Publivinted — service worker.
// Reçoit une annonce de l'appli (via bridge.js), ouvre vinted.fr/items/new dans un onglet,
// fait remplir + relire par content.js, publie si tout est conforme, renvoie l'URL de l'annonce.

const NEW_URL = "https://www.vinted.fr/items/new";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== "pv-publish") return;
  publish(msg.listing, sender.tab?.id)
    .then(sendResponse)
    .catch((e) => sendResponse({ published: false, note: e.message }));
  return true; // réponse asynchrone
});

function progress(appTabId, text) {
  if (appTabId) chrome.tabs.sendMessage(appTabId, { pvProgress: text }).catch(() => {});
}

function waitTab(tabId, test, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); reject(new Error("Délai dépassé sur Vinted")); }, timeout);
    function fn(id, info, tab) {
      if (id !== tabId) return;
      if (test(info, tab)) { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve(tab); }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function sendToContent(tabId, message, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try { return await chrome.tabs.sendMessage(tabId, message); }
    catch { await sleep(500); } // content script pas encore prêt
  }
  throw new Error("Le formulaire Vinted ne répond pas");
}

async function publish(listing, appTabId) {
  if (!listing) throw new Error("Annonce vide");
  const tab = await chrome.tabs.create({ url: NEW_URL, active: true });
  try {
    await waitTab(tab.id, (info) => info.status === "complete");
    const cur = await chrome.tabs.get(tab.id);
    if (!cur.url.startsWith(NEW_URL)) {
      return { published: false, note: "Non connecté à Vinted dans ce Chrome (redirection vers la connexion)" };
    }
    progress(appTabId, "Remplissage du formulaire Vinted…");
    const r = await sendToContent(tab.id, { action: "pv-fill", listing, publish: true });
    if (!r?.clicked) {
      return { published: false, note: r?.note || "Relecture non conforme : publication annulée", rows: r?.rows };
    }
    progress(appTabId, "Publication envoyée, attente de la confirmation Vinted…");
    const done = await waitTab(tab.id, (info, t) => /\/items\/\d+/.test(info.url || t.url || ""), 60000).catch(() => null);
    if (!done) return { published: false, note: "Vinted n'a pas confirmé la publication (vérifie l'onglet)", rows: r.rows };
    const url = (done.url || "").split("?")[0];
    await sleep(1500);
    chrome.tabs.remove(tab.id).catch(() => {});
    return { published: true, url, rows: r.rows };
  } catch (e) {
    return { published: false, note: e.message };
  }
}
