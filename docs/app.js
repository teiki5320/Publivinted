// Publivinted — appli web : import → Claude construit → swipe → publication via l'extension.
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------- API ----------------
// Même origine quand le Worker sert la page ; sinon (GitHub Pages) on appelle le Worker en ligne.
const API = location.hostname.endsWith("github.io") ? "https://publivinted.teiki5320.workers.dev" : "";
// Le code d'accès reste sur l'appareil et part dans chaque requête (pas de cookie entre deux domaines).
const TOKEN_KEY = "pv_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} };
const auth = () => ({ Authorization: `Bearer ${getToken()}` });

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...(opts.body && !(opts.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...auth(), ...(opts.headers || {}) }
  });
  if (res.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Non connecté"); }
  const data = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}
const patchItem = (id, body) => api(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(body) });

// Photos : servies par l'API authentifiée, donc chargées en blob puis affichées via <img data-photo="id">.
const fetchPhoto = (id) =>
  fetch(`${API}/api/photos/${id}`, { headers: auth() }).then((r) => { if (!r.ok) throw new Error(`Photo : erreur ${r.status}`); return r.blob(); });
const photoUrls = new Map(); // id → Promise<URL objet>
function showPhoto(img, id) {
  if (!id) return;
  img.dataset.photo = id;
  if (!photoUrls.has(id)) {
    const p = fetchPhoto(id).then((b) => URL.createObjectURL(b));
    p.catch(() => photoUrls.delete(id));
    photoUrls.set(id, p);
  }
  photoUrls.get(id).then((u) => { if (img.dataset.photo === id) img.src = u; }).catch(() => {});
}
const loadPhotos = (root) => $$("img[data-photo]", root).forEach((img) => showPhoto(img, img.dataset.photo));

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------------- Connexion ----------------
function showLogin() { $("#app").hidden = true; $("#v-login").hidden = false; }
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-err").textContent = "";
  try {
    const token = $("#login-token").value;
    await api("/api/login", { method: "POST", body: JSON.stringify({ token }) });
    setToken(token);
    start();
  } catch (err) { $("#login-err").textContent = err.message; }
});

// ---------------- Navigation ----------------
const views = ["import", "swipe", "lot", "suivi"];
function go(view) {
  views.forEach((v) => ($(`#v-${v}`).hidden = v !== view));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.view === view));
  location.hash = view;
  if (view === "swipe") loadDeck();
  if (view === "lot") loadLot();
  if (view === "suivi") loadSuivi();
}
$$(".tab").forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (views.includes(v) && $(`#v-${v}`).hidden && !$("#app").hidden) go(v);
});
document.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) go(g.dataset.goto); });

async function refreshCounts() {
  const [b, v] = await Promise.all([api("/api/items?status=brouillon"), api("/api/items?status=valide")]);
  $("#n-brouillon").textContent = b.length || "";
  $("#n-valide").textContent = v.length || "";
}

// ---------------- 1. Import ----------------
let files = [];
const MAX = 40;

function addFiles(list) {
  const imgs = [...list].filter((f) => f.type.startsWith("image/"));
  files = files.concat(imgs).slice(0, MAX);
  renderThumbs();
}
function renderThumbs() {
  const box = $("#thumbs");
  box.innerHTML = "";
  files.forEach((f, i) => {
    const fig = document.createElement("figure");
    fig.dataset.i = i;
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    fig.appendChild(img);
    box.appendChild(fig);
  });
  $("#btn-upload").disabled = !files.length;
  $("#btn-clear").hidden = !files.length;
  $("#import-status").textContent = files.length ? `${files.length} photo(s) prête(s)${files.length >= MAX ? " (maximum atteint)" : ""}.` : "";
}
$("#file").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
$("#btn-clear").addEventListener("click", () => { files = []; renderThumbs(); });

// Redimensionne côté navigateur (1600 px max, JPEG) : upload rapide, coût Claude réduit.
async function resize(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.86));
}

$("#btn-upload").addEventListener("click", async () => {
  const btn = $("#btn-upload");
  const status = $("#import-status");
  btn.disabled = true;
  $("#btn-clear").hidden = true;
  try {
    const { id } = await api("/api/batches", { method: "POST" });
    for (let i = 0; i < files.length; i++) {
      status.textContent = `Envoi des photos… ${i + 1}/${files.length}`;
      const blob = await resize(files[i]);
      await api(`/api/batches/${id}/photos`, { method: "POST", body: blob, headers: { "Content-Type": blob.type || "image/jpeg" } });
      $(`#thumbs figure[data-i="${i}"]`)?.classList.add("done");
    }
    status.textContent = "Claude regroupe les photos et rédige les annonces… (environ 30 s à 1 min)";
    const r = await api(`/api/batches/${id}/analyse`, { method: "POST" });
    toast(`${r.items} annonce(s) construite(s)`);
    files = [];
    renderThumbs();
    await refreshCounts();
    go("swipe");
  } catch (err) {
    status.textContent = "Erreur : " + err.message;
    btn.disabled = false;
  }
});

// ---------------- 2. Swipe ----------------
let deck = [];

async function loadDeck() {
  deck = (await api("/api/items?status=brouillon")).reverse(); // plus ancien d'abord
  renderDeck();
}

function chips(d) {
  const list = [
    d.categorie?.join(" › "), d.marque, d.taille && `Taille ${d.taille}`, d.etat,
    ...(d.couleur || []), ...(d.matiere || []), d.colis && `Colis ${d.colis}`
  ].filter(Boolean);
  return list.map((c) => `<span>${esc(c)}</span>`).join("");
}

function cardHTML(it) {
  const d = it.data;
  const hint = it.prix_min && it.prix_max ? `fourchette ${it.prix_min}–${it.prix_max} €` : "";
  return `
    <div class="pics">
      <img data-photo="${it.photos[0] || ""}" alt="">
      <div class="dots">${it.photos.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
      <span class="stamp yes">VALIDER</span><span class="stamp no">ÉCARTER</span>
    </div>
    <div class="body">
      <h3>${esc(d.titre)}</h3>
      <div class="chips">${chips(d)}</div>
      <p class="desc">${esc(d.description)}</p>
    </div>
    <div class="price">
      <div><div class="val"><span>${it.prix ?? "?"}</span> €</div>
        <div class="hint">conseillé ${it.prix_conseille ?? "?"} € ${hint ? "· " + hint : ""}</div></div>
      <div class="pm"><button data-d="-1" aria-label="Baisser">−</button><button data-d="1" aria-label="Monter">+</button></div>
    </div>`;
}

function renderDeck() {
  const box = $("#deck");
  box.innerHTML = "";
  $("#deck-empty").hidden = deck.length > 0;
  $("#deck-actions").hidden = deck.length === 0;
  $("#deck").hidden = deck.length === 0;
  deck.slice(0, 2).reverse().forEach((it, idx, arr) => {
    const el = document.createElement("article");
    el.className = "card" + (idx === 0 && arr.length > 1 ? " behind" : "");
    el.innerHTML = cardHTML(it);
    loadPhotos(el);
    box.appendChild(el);
  });
  const top = box.lastElementChild;
  if (top) bindCard(top, deck[0]);
}

function bindCard(el, it) {
  // Photos : tap à droite/gauche pour défiler
  let pi = 0;
  const img = $(".pics img", el);
  $(".pics", el).addEventListener("click", (e) => {
    if (moved || it.photos.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    pi = (pi + (e.clientX - r.left > r.width / 2 ? 1 : -1) + it.photos.length) % it.photos.length;
    showPhoto(img, it.photos[pi]);
    $$(".dots i", el).forEach((d, i) => d.classList.toggle("on", i === pi));
  });

  // Prix −/+
  $$(".pm button", el).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    it.prix = Math.max(1, (it.prix || it.prix_conseille || 5) + Number(b.dataset.d));
    $(".val span", el).textContent = it.prix;
    clearTimeout(it._t);
    it._t = setTimeout(() => patchItem(it.id, { prix: it.prix }).catch((err) => toast(err.message)), 500);
  }));

  // Glisser
  let x0 = 0, y0 = 0, dx = 0, dragging = false, moved = false;
  const yes = $(".stamp.yes", el), no = $(".stamp.no", el);
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true; moved = false; x0 = e.clientX; y0 = e.clientY; dx = 0;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 8) moved = true;
    if (Math.abs(e.clientY - y0) > Math.abs(dx) * 1.5 && !moved) return; // laisse défiler le texte
    el.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    yes.style.opacity = Math.max(0, Math.min(1, dx / 100));
    no.style.opacity = Math.max(0, Math.min(1, -dx / 100));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    if (dx > 110) decide(true);
    else if (dx < -110) decide(false);
    else { el.style.transform = ""; yes.style.opacity = no.style.opacity = 0; }
    setTimeout(() => (moved = false), 0);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

let deciding = false;
async function decide(ok) {
  if (deciding || !deck.length) return;
  deciding = true;
  const it = deck[0];
  const el = $("#deck").lastElementChild;
  el.style.transform = `translateX(${ok ? 140 : -140}%) rotate(${ok ? 18 : -18}deg)`;
  el.style.opacity = 0;
  try {
    clearTimeout(it._t);
    await patchItem(it.id, { status: ok ? "valide" : "ecarte", prix: it.prix || it.prix_conseille || 1 });
    deck.shift();
    await sleep(220);
    renderDeck();
    refreshCounts();
    if (!deck.length) toast("Tout est trié. Va dans « À publier ».");
  } catch (err) {
    toast(err.message);
    renderDeck();
  } finally { deciding = false; }
}
$("#act-yes").addEventListener("click", () => decide(true));
$("#act-no").addEventListener("click", () => decide(false));
$("#act-edit").addEventListener("click", () => deck[0] && openEdit(deck[0], () => renderDeck()));
document.addEventListener("keydown", (e) => {
  if ($("#v-swipe").hidden || $("#edit").open) return;
  if (e.key === "ArrowRight") decide(true);
  if (e.key === "ArrowLeft") decide(false);
});

// ---------------- Édition ----------------
function openEdit(it, after) {
  const f = $("#edit-form"), d = it.data;
  f.titre.value = d.titre || "";
  f.description.value = d.description || "";
  f.categorie.value = (d.categorie || []).join(" > ");
  f.marque.value = d.marque || "";
  f.taille.value = d.taille || "";
  f.etat.value = d.etat || "Bon état";
  f.couleur.value = (d.couleur || []).join(", ");
  f.matiere.value = (d.matiere || []).join(", ");
  f.colis.value = d.colis || "Petit";
  const dlg = $("#edit");
  dlg.onclose = async () => {
    if (dlg.returnValue !== "save") return;
    const data = {
      titre: f.titre.value, description: f.description.value,
      categorie: f.categorie.value.split(">").map((s) => s.trim()).filter(Boolean),
      marque: f.marque.value, taille: f.taille.value, etat: f.etat.value,
      couleur: f.couleur.value.split(",").map((s) => s.trim()).filter(Boolean),
      matiere: f.matiere.value.split(",").map((s) => s.trim()).filter(Boolean),
      colis: f.colis.value
    };
    try {
      const upd = await patchItem(it.id, { data });
      it.data = upd.data;
      after?.();
      toast("Annonce modifiée");
    } catch (err) { toast(err.message); }
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------------- Listes ----------------
function lineHTML(it, actions) {
  const note = it.note && it.status === "a_revoir" ? `<div class="note">${esc(it.note)}</div>` : "";
  const lien = it.vinted_url ? ` · <a href="${esc(it.vinted_url)}" target="_blank" rel="noopener">voir sur Vinted</a>` : "";
  return `<div class="line" data-id="${it.id}">
    <img data-photo="${it.photos[0] || ""}" alt="">
    <div><div class="t">${esc(it.data.titre)}</div>
      <div class="s"><span class="badge ${it.status}">${LIBELLES[it.status] || it.status}</span> · ${it.prix ?? "?"} €${lien}</div>${note}</div>
    <div class="acts">${actions}</div></div>`;
}
const LIBELLES = { brouillon: "à valider", valide: "prête", publication: "en cours", publie: "en ligne", a_revoir: "à revoir", vendu: "vendue", ecarte: "écartée" };

async function loadLot() {
  const items = await api("/api/items?status=valide");
  $("#lot-list").innerHTML = items.length
    ? items.map((it) => lineHTML(it, `<button class="btn ghost small" data-act="brouillon">Retirer</button>`)).join("")
    : `<p class="empty">Aucune annonce validée pour l'instant.</p>`;
  loadPhotos($("#lot-list"));
  lotCount = items.length;
  updatePublishButton();
}

let filtre = "publie,publication,a_revoir";
$$(".filters .chip").forEach((c) => c.addEventListener("click", () => {
  $$(".filters .chip").forEach((x) => x.classList.toggle("on", x === c));
  filtre = c.dataset.f;
  loadSuivi();
}));
async function loadSuivi() {
  const items = await api(`/api/items?status=${filtre}`);
  $("#suivi-list").innerHTML = items.length
    ? items.map((it) => {
        let a = "";
        if (it.status === "publie") a = `<button class="btn ghost small" data-act="vendu">Vendue</button>`;
        if (it.status === "a_revoir") a = `<button class="btn ghost small" data-act="edit">Modifier</button><button class="btn primary small" data-act="valide">Republier</button>`;
        if (it.status === "ecarte") a = `<button class="btn ghost small" data-act="brouillon">Récupérer</button>`;
        if (it.status === "publication") a = `<button class="btn ghost small" data-act="a_revoir">Débloquer</button>`;
        return lineHTML(it, a);
      }).join("")
    : `<p class="empty">Rien ici.</p>`;
  loadPhotos($("#suivi-list"));
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.closest(".line").dataset.id;
  try {
    if (b.dataset.act === "edit") {
      const it = await api(`/api/items/${id}`);
      return openEdit(it, () => loadSuivi());
    }
    await patchItem(id, { status: b.dataset.act });
    toast("C'est noté");
    refreshCounts();
    if (!$("#v-lot").hidden) loadLot(); else loadSuivi();
  } catch (err) { toast(err.message); }
});

// ---------------- Publication via l'extension ----------------
// L'extension injecte un petit script « pont » sur cette page. On lui parle par window.postMessage.
let ext = null;        // { version } quand l'extension répond
let lotCount = 0;
let running = false, stopAsked = false;
const pending = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.pv !== "ext") return;
  const m = e.data;
  if (m.hello) { ext = { version: m.version }; updatePublishButton(); return; }
  if (m.event === "progress") { $("#pub-progress").textContent = m.text; return; }
  const p = pending.get(m.id);
  if (p) { pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || "Erreur extension")); }
});

function callExt(action, payload, timeout = 240000) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.postMessage({ pv: "app", id, action, payload }, location.origin);
    setTimeout(() => { if (pending.delete(id)) reject(new Error("L'extension ne répond pas")); }, timeout);
  });
}

function updatePublishButton() {
  const s = $("#ext-status");
  if (!ext) {
    s.innerHTML = "Extension Publivinted non détectée. Ouvre cette appli dans Chrome, sur le Mac où l'extension est installée.";
    s.className = "muted";
  } else {
    s.textContent = `Extension connectée (v${ext.version}). Vérifie que tu es connecté à Vinted dans ce Chrome.`;
    s.className = "ok";
  }
  $("#btn-publish").disabled = !ext || running || lotCount === 0;
}
// Demande de présence (au cas où l'extension a annoncé avant que l'appli écoute)
setTimeout(() => window.postMessage({ pv: "app", action: "hello" }, location.origin), 300);

async function blobToDataUrl(blob) {
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

$("#btn-stop").addEventListener("click", () => { stopAsked = true; $("#btn-stop").disabled = true; });

$("#btn-publish").addEventListener("click", async () => {
  const items = await api("/api/queue");
  if (!items.length) return toast("Rien à publier");
  if (!confirm(`Publier ${items.length} annonce(s) sur Vinted maintenant ?`)) return;
  running = true; stopAsked = false;
  $("#btn-stop").hidden = false; $("#btn-stop").disabled = false;
  updatePublishButton();
  const prog = $("#pub-progress");
  let ok = 0, ko = 0;

  for (let i = 0; i < items.length; i++) {
    if (stopAsked) break;
    const it = items[i];
    prog.textContent = `Annonce ${i + 1}/${items.length} : ${it.data.titre}`;
    try {
      await api(`/api/items/${it.id}/claim`, { method: "POST" });
      const photos = [];
      for (const pid of it.photos) {
        const blob = await fetchPhoto(pid);
        photos.push({ name: `${pid}.jpg`, dataUrl: await blobToDataUrl(blob) });
      }
      const listing = { ...it.data, prix: String(it.prix), photos };
      const r = await callExt("publish", { listing });
      await api(`/api/items/${it.id}/result`, {
        method: "POST",
        body: JSON.stringify({ ok: r.published, vinted_url: r.url, note: r.published ? null : r.note })
      });
      r.published ? ok++ : ko++;
    } catch (err) {
      ko++;
      await api(`/api/items/${it.id}/result`, { method: "POST", body: JSON.stringify({ ok: false, note: err.message }) }).catch(() => {});
    }
    loadLot(); refreshCounts();
    if (i < items.length - 1 && !stopAsked) {
      const wait = 30 + Math.round(Math.random() * 60);
      for (let s = wait; s > 0 && !stopAsked; s--) { prog.textContent = `Pause avant la suivante : ${s} s`; await sleep(1000); }
    }
  }
  running = false;
  $("#btn-stop").hidden = true;
  prog.textContent = `Terminé : ${ok} publiée(s), ${ko} à revoir.`;
  updatePublishButton();
  loadLot(); refreshCounts();
});

// ---------------- Démarrage ----------------
async function start() {
  try { await api("/api/me"); } catch { return; }
  $("#v-login").hidden = true;
  $("#app").hidden = false;
  refreshCounts();
  const v = location.hash.slice(1);
  go(views.includes(v) ? v : "import");
}
start();
