// Publivinted — content script (étape 1)
// Remplit le formulaire Vinted avec l'annonce de test, relit chaque champ,
// et affiche un bandeau de rapport. NE CLIQUE JAMAIS sur « Publier ».

(() => {
  const S = window.PV_SELECTORS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = () => sleep(300 + Math.random() * 500); // 300 à 800 ms
  const norm = (s) =>
    (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => !!el && el.getClientRects().length > 0;

  // ---------- Recherche d'éléments ----------
  function first(list, root = document) {
    for (const sel of list || []) {
      const el = root.querySelector(sel);
      if (el) return { el, sel };
    }
    return null;
  }
  function byLabel(text) {
    if (!text) return null;
    const t = norm(text);
    for (const lab of document.querySelectorAll("label")) {
      if (!norm(lab.textContent).startsWith(t)) continue;
      const id = lab.getAttribute("for");
      const el = id ? document.getElementById(id) : lab.querySelector("input,textarea");
      if (el) return { el, sel: `label « ${text} »` };
    }
    return null;
  }
  function locate(field) {
    return first(field.candidates) || byLabel(field.label);
  }
  async function waitFor(fn, timeout = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = fn();
      if (r) return r;
      await sleep(100);
    }
    return null;
  }

  // ---------- Actions ----------
  function setReactValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  async function injectPhotos(input, paths) {
    const dt = new DataTransfer();
    for (const p of paths) {
      // Photo de test (chemin dans l'extension) ou photo de l'appli ({ name, dataUrl })
      const src = typeof p === "string" ? chrome.runtime.getURL(p) : p.dataUrl;
      const blob = await (await fetch(src)).blob();
      const name = typeof p === "string" ? p.split("/").pop() : p.name;
      dt.items.add(new File([blob], name, { type: blob.type || "image/jpeg", lastModified: Date.now() }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findOption(text) {
    const t = norm(text);
    const all = S.dropdownOptions.flatMap((sel) => [...document.querySelectorAll(sel)]).filter(visible);
    return (
      all.find((o) => norm(o.textContent) === t) ||
      all.find((o) => norm(o.textContent).startsWith(t)) ||
      null
    );
  }

  function clickEl(el) {
    el.scrollIntoView({ block: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function openMenu(trigger) {
    clickEl(trigger);
    await pause();
  }
  async function closeMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
    await pause();
  }

  async function pickOptions(texts) {
    const missing = [];
    for (const txt of texts) {
      const opt = await waitFor(() => findOption(txt), 3000);
      if (!opt) { missing.push(txt); continue; }
      clickEl(opt);
      await pause();
    }
    return missing;
  }

  // ---------- Remplissage par type ----------
  async function fillField(key, field, value) {
    if (key === "photos") {
      const hit = first(field.candidates);
      if (!hit) return { status: "introuvable" };
      await injectPhotos(hit.el, value);
      await sleep(1500); // laisser l'upload démarrer
      return { status: "rempli", sel: hit.sel };
    }

    const hit = locate(field);
    if (!hit) return { status: "introuvable" };
    const el = hit.el;

    switch (field.type) {
      case "text":
        setReactValue(el, value);
        return { status: "rempli", sel: hit.sel };

      case "tree": {
        await openMenu(el);
        const missing = await pickOptions(value); // un clic par niveau
        await closeMenu();
        return missing.length ? { status: "partiel", sel: hit.sel, detail: `options absentes : ${missing.join(", ")}` } : { status: "rempli", sel: hit.sel };
      }

      case "search": {
        await openMenu(el);
        const search = first(field.searchInput);
        if (search) { setReactValue(search.el, value); await pause(); }
        const missing = await pickOptions([value]);
        await closeMenu();
        return missing.length ? { status: "partiel", sel: hit.sel, detail: "marque non trouvée dans la liste" } : { status: "rempli", sel: hit.sel };
      }

      case "select":
      case "multi": {
        await openMenu(el);
        const missing = await pickOptions(Array.isArray(value) ? value : [value]);
        await closeMenu();
        return missing.length ? { status: "partiel", sel: hit.sel, detail: `options absentes : ${missing.join(", ")}` } : { status: "rempli", sel: hit.sel };
      }

      case "radio": {
        const t = norm(value);
        const cards = [...el.querySelectorAll("label, [role='radio'], [data-testid^='package-size-']")];
        const card = cards.find((c) => norm(c.textContent).startsWith(t));
        if (!card) return { status: "partiel", sel: hit.sel, detail: `format « ${value} » absent` };
        clickEl(card);
        return { status: "rempli", sel: hit.sel };
      }
    }
    return { status: "introuvable" };
  }

  // ---------- Relecture ----------
  function readBack(key, field) {
    if (key === "photos") {
      const n = S.photos.thumbnails.flatMap((s) => [...document.querySelectorAll(s)]).length;
      return { shown: `${n} vignette(s)`, count: n };
    }
    const hit = locate(field);
    if (!hit) return { shown: null };
    const el = hit.el;
    if (field.type === "radio") {
      const checked = el.querySelector("input[type='radio']:checked");
      const lab = checked && (checked.closest("label") || checked.parentElement);
      return { shown: lab ? lab.textContent.trim() : "" };
    }
    return { shown: "value" in el ? el.value : el.textContent.trim() };
  }

  function matches(key, expected, rb) {
    if (rb.shown == null) return false;
    if (key === "photos") return rb.count >= expected.length;
    const shown = norm(rb.shown);
    const exp = Array.isArray(expected) ? expected : [expected];
    if (key === "categorie") return shown.includes(norm(exp[exp.length - 1]));
    if (key === "prix") return shown.replace(/[^\d,.]/g, "").replace(",", ".").startsWith(String(expected));
    return exp.every((e) => shown.includes(norm(e)));
  }

  // ---------- Bandeau ----------
  function banner(rows, { publish = false, clicked = false, note = null } = {}) {
    document.getElementById("pv-banner")?.remove();
    const box = document.createElement("div");
    box.id = "pv-banner";
    box.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:2147483647;width:380px;max-height:80vh;overflow:auto;" +
      "background:#fff;color:#111;border:2px solid #09b1ba;border-radius:12px;padding:14px 16px;" +
      "font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)";
    const ok = rows.filter((r) => r.status === "rempli" && r.match).length;
    const icon = (r) => (r.status === "introuvable" ? "❌" : r.match ? "✅" : "⚠️");
    box.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">` +
      `<b>Publivinted — test de remplissage</b><button id="pv-x" style="border:0;background:none;font-size:18px;cursor:pointer">×</button></div>` +
      `<div style="margin-bottom:8px">${ok}/${rows.length} champs conformes. <b>${
        clicked ? "Publication envoyée." : publish ? "Publication annulée." : "Mode test : publication non lancée."
      }</b>${note ? `<br><small style="color:#c2453a">${note}</small>` : ""}</div>` +
      rows
        .map(
          (r) =>
            `<div style="padding:4px 0;border-top:1px solid #eee">${icon(r)} <b>${r.key}</b> — ${r.status}` +
            (r.shown != null ? `<br><small>affiché : ${String(r.shown).slice(0, 80) || "(vide)"}</small>` : "") +
            (r.detail ? `<br><small>${r.detail}</small>` : "") +
            (r.sel ? `<br><small style="color:#888">via ${r.sel}</small>` : "") +
            `</div>`
        )
        .join("");
    document.body.appendChild(box);
    box.querySelector("#pv-x").onclick = () => box.remove();
  }

  // ---------- Orchestration ----------
  const ORDER = ["photos", "titre", "description", "categorie", "marque", "taille", "etat", "couleur", "matiere", "prix", "colis"];

  const vide = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const OBLIGATOIRES = ["photos", "titre", "description", "categorie", "etat", "prix"];

  async function run(listing, { publish = false } = {}) {
    const rows = [];
    for (const key of ORDER) {
      const field = S[key];
      const value = listing[key];
      if (vide(value)) continue;
      let r;
      try {
        r = await fillField(key, field, value);
      } catch (e) {
        r = { status: "erreur", detail: e.message };
      }
      rows.push({ key, ...r });
      await pause();
    }
    await sleep(1200);
    for (const row of rows) {
      const rb = readBack(row.key, S[row.key]);
      row.shown = rb.shown;
      row.match = row.status !== "introuvable" && matches(row.key, listing[row.key], rb);
      if (row.status === "rempli" && !row.match) row.detail = (row.detail ? row.detail + " · " : "") + "écart à la relecture";
    }
    // Garde-fou : tous les champs demandés doivent être conformes, et les obligatoires présents.
    const manquants = OBLIGATOIRES.filter((k) => !rows.find((r) => r.key === k));
    const ecarts = rows.filter((r) => !r.match).map((r) => r.key);
    const conforme = !manquants.length && !ecarts.length;
    let clicked = false, note = null;

    if (!conforme) {
      note = [manquants.length && `manquants : ${manquants.join(", ")}`, ecarts.length && `non conformes : ${ecarts.join(", ")}`]
        .filter(Boolean).join(" · ");
    } else if (publish) {
      const btn = first(S.publier);
      if (!btn || btn.el.disabled) note = "Bouton de publication introuvable ou désactivé";
      else { await pause(); clickEl(btn.el); clicked = true; }
    }
    banner(rows, { publish, clicked, note });
    return { rows, clicked, note };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === "pv-fill-test") {
      run(window.PV_TEST_LISTING, { publish: false }).then(sendResponse);
      return true;
    }
    if (msg?.action === "pv-fill") {
      if (window.__pvBusy) { sendResponse({ clicked: false, note: "Remplissage déjà en cours" }); return; }
      window.__pvBusy = true;
      run(msg.listing, { publish: !!msg.publish })
        .then(sendResponse)
        .catch((e) => sendResponse({ clicked: false, note: e.message }))
        .finally(() => (window.__pvBusy = false));
      return true;
    }
  });
})();
