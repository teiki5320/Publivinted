const out = document.getElementById("out");

document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://www.vinted.fr/items/new")) {
    out.textContent = "Ouvre d'abord la page vinted.fr/items/new.";
    return;
  }
  out.textContent = "Remplissage en cours… (rien ne sera publié)";
  chrome.tabs.sendMessage(tab.id, { action: "pv-fill-test" }, (res) => {
    if (chrome.runtime.lastError) {
      out.textContent = "Recharge la page Vinted puis réessaie.";
      return;
    }
    const ok = res.rows.filter((r) => r.match).length;
    out.textContent = `${ok}/${res.rows.length} champs conformes — voir le bandeau sur la page.`;
  });
});
