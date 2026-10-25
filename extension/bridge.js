// Publivinted — pont entre l'appli web et l'extension.
// Injecté uniquement sur l'appli Publivinted. Relaie les demandes de la page vers le service worker.

(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const hello = () => window.postMessage({ pv: "ext", hello: true, version: VERSION }, location.origin);
  hello();

  // Progression envoyée par le service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.pvProgress) window.postMessage({ pv: "ext", event: "progress", text: msg.pvProgress }, location.origin);
  });

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (m?.pv !== "app") return;
    if (m.action === "hello") return hello();
    if (m.action !== "publish") return;
    chrome.runtime.sendMessage({ action: "pv-publish", listing: m.payload?.listing }, (res) => {
      const err = chrome.runtime.lastError?.message;
      window.postMessage(
        err || !res
          ? { pv: "ext", id: m.id, ok: false, error: err || "Pas de réponse de l'extension" }
          : { pv: "ext", id: m.id, ok: true, result: res },
        location.origin
      );
    });
  });
})();
