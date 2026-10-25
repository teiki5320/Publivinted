// Publivinted — Worker Cloudflare (API + appli web statique)
// Auth : cookie « pv » (appli web) ou en-tête « Authorization: Bearer » (extension), comparé au secret APP_TOKEN.

import { analyseBatch } from "./claude.js";

const STATUTS = ["brouillon", "valide", "ecarte", "publication", "publie", "vendu", "a_revoir"];
const MAX_PHOTOS_LOT = 40;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const res = await route(request, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || "Erreur serveur" }, status, cors);
    }
  }
};

// ---------- Routage ----------
async function route(request, env, url) {
  const { pathname } = url;
  const m = request.method;

  if (pathname === "/api/login" && m === "POST") return login(request, env);
  if (pathname === "/api/logout" && m === "POST") return logout();

  requireAuth(request, env);

  if (pathname === "/api/me" && m === "GET") return json({ ok: true });

  // Lots
  if (pathname === "/api/batches" && m === "POST") return createBatch(env);
  if (pathname === "/api/batches" && m === "GET") return listBatches(env);
  let p;
  if ((p = match(pathname, "/api/batches/:id/photos")) && m === "POST") return uploadPhoto(request, env, p.id);
  if ((p = match(pathname, "/api/batches/:id/analyse")) && m === "POST") return analyse(env, p.id);
  if ((p = match(pathname, "/api/batches/:id")) && m === "GET") return getBatch(env, p.id);

  // Photos
  if ((p = match(pathname, "/api/photos/:id")) && m === "GET") return getPhoto(env, p.id);

  // Annonces
  if (pathname === "/api/items" && m === "GET") return listItems(env, url.searchParams.get("status"));
  if ((p = match(pathname, "/api/items/:id")) && m === "GET") return getItem(env, p.id);
  if ((p = match(pathname, "/api/items/:id")) && m === "PATCH") return patchItem(request, env, p.id);

  // Extension
  if (pathname === "/api/queue" && m === "GET") return queue(env);
  if ((p = match(pathname, "/api/items/:id/claim")) && m === "POST") return claim(env, p.id);
  if ((p = match(pathname, "/api/items/:id/result")) && m === "POST") return result(request, env, p.id);

  throw httpError(404, "Route inconnue");
}

function match(path, pattern) {
  const a = path.split("/"), b = pattern.split("/");
  if (a.length !== b.length) return null;
  const out = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(":")) out[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

// ---------- Auth ----------
function tokenFrom(request) {
  const h = request.headers.get("Authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const c = request.headers.get("Cookie") || "";
  const m = c.match(/(?:^|;\s*)pv=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function requireAuth(request, env) {
  if (!env.APP_TOKEN) throw httpError(500, "Secret APP_TOKEN non configuré");
  if (!safeEqual(tokenFrom(request), env.APP_TOKEN)) throw httpError(401, "Non connecté");
}
async function login(request, env) {
  const { token } = await request.json().catch(() => ({}));
  if (!env.APP_TOKEN || !safeEqual(token || "", env.APP_TOKEN)) throw httpError(401, "Code d'accès incorrect");
  return json({ ok: true }, 200, {
    "Set-Cookie": `pv=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`
  });
}
function logout() {
  return json({ ok: true }, 200, { "Set-Cookie": "pv=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0" });
}

// Appli web publiée sur GitHub Pages (https://teiki5320.github.io/Publivinted/)
const PAGES_ORIGIN = "https://teiki5320.github.io";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  // CORS pour l'extension (chrome-extension://) et l'appli sur GitHub Pages ; l'appli servie par le Worker est sur la même origine.
  if (!origin.startsWith("chrome-extension://") && origin !== PAGES_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

// ---------- Lots et photos ----------
async function createBatch(env) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO batches (id) VALUES (?)").bind(id).run();
  return json({ id }, 201);
}

async function listBatches(env) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, (SELECT COUNT(*) FROM photos p WHERE p.batch_id = b.id) AS nb_photos,
            (SELECT COUNT(*) FROM items i WHERE i.batch_id = b.id) AS nb_items
     FROM batches b ORDER BY b.created_at DESC LIMIT 50`
  ).all();
  return json(results);
}

async function getBatch(env, id) {
  const batch = await env.DB.prepare("SELECT * FROM batches WHERE id = ?").bind(id).first();
  if (!batch) throw httpError(404, "Lot introuvable");
  const { results: photos } = await env.DB.prepare(
    "SELECT id, item_id, position FROM photos WHERE batch_id = ? ORDER BY position"
  ).bind(id).all();
  return json({ ...batch, photos });
}

async function uploadPhoto(request, env, batchId) {
  const batch = await env.DB.prepare("SELECT status FROM batches WHERE id = ?").bind(batchId).first();
  if (!batch) throw httpError(404, "Lot introuvable");
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE batch_id = ?").bind(batchId).first();
  if (n >= MAX_PHOTOS_LOT) throw httpError(400, `Maximum ${MAX_PHOTOS_LOT} photos par lot`);

  const type = request.headers.get("Content-Type") || "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw httpError(415, "Format accepté : JPEG, PNG ou WebP");
  const body = await request.arrayBuffer();
  if (body.byteLength > 8 * 1024 * 1024) throw httpError(413, "Photo trop lourde (8 Mo max)");

  const id = crypto.randomUUID();
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  const key = `photos/${batchId}/${id}.${ext}`;
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO photos (id, batch_id, r2_key, position) VALUES (?, ?, ?, ?)")
    .bind(id, batchId, key, n).run();
  return json({ id, position: n }, 201);
}

async function getPhoto(env, id) {
  const row = await env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(id).first();
  if (!row) throw httpError(404, "Photo introuvable");
  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) throw httpError(404, "Fichier absent de R2");
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=86400"
    }
  });
}

// ---------- Analyse par Claude ----------
async function analyse(env, batchId) {
  if (!env.ANTHROPIC_API_KEY) throw httpError(500, "Secret ANTHROPIC_API_KEY non configuré");
  const { results: photos } = await env.DB.prepare(
    "SELECT id, r2_key FROM photos WHERE batch_id = ? ORDER BY position"
  ).bind(batchId).all();
  if (!photos.length) throw httpError(400, "Aucune photo dans ce lot");

  await env.DB.prepare("UPDATE batches SET status = 'analyse' WHERE id = ?").bind(batchId).run();

  // Ré-analyse : on efface les brouillons précédents du lot
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET item_id = NULL WHERE batch_id = ?").bind(batchId),
    env.DB.prepare("DELETE FROM items WHERE batch_id = ? AND status = 'brouillon'").bind(batchId)
  ]);

  let articles;
  try {
    articles = await analyseBatch(env, photos);
  } catch (e) {
    await env.DB.prepare("UPDATE batches SET status = 'erreur' WHERE id = ?").bind(batchId).run();
    throw httpError(502, "Analyse Claude échouée : " + e.message);
  }

  const stmts = [];
  const created = [];
  for (const a of articles) {
    const itemId = crypto.randomUUID();
    const prix = clampPrix(a.prix_conseille);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO items (id, batch_id, data, prix_conseille, prix_min, prix_max, prix)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(itemId, batchId, JSON.stringify(a.annonce), prix, clampPrix(a.prix_min), clampPrix(a.prix_max), prix)
    );
    a.photos.forEach((idx, pos) => {
      const ph = photos[idx];
      if (ph) stmts.push(env.DB.prepare("UPDATE photos SET item_id = ?, position = ? WHERE id = ?").bind(itemId, pos, ph.id));
    });
    created.push(itemId);
  }
  stmts.push(env.DB.prepare("UPDATE batches SET status = 'pret' WHERE id = ?").bind(batchId));
  await env.DB.batch(stmts);
  return json({ items: created.length });
}

function clampPrix(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// ---------- Annonces ----------
async function hydrate(env, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = await env.DB.prepare(
    `SELECT id, item_id FROM photos WHERE item_id IN (${ids.map(() => "?").join(",")}) ORDER BY position`
  ).bind(...ids).all();
  const byItem = {};
  for (const p of ph.results) (byItem[p.item_id] ||= []).push(p.id);
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data), photos: byItem[r.id] || [] }));
}

async function listItems(env, status) {
  let q = "SELECT * FROM items";
  const args = [];
  if (status) {
    const list = status.split(",").filter((s) => STATUTS.includes(s));
    if (list.length) { q += ` WHERE status IN (${list.map(() => "?").join(",")})`; args.push(...list); }
  }
  q += " ORDER BY created_at DESC LIMIT 200";
  const { results } = await env.DB.prepare(q).bind(...args).all();
  return json(await hydrate(env, results));
}

async function getItem(env, id) {
  const row = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();
  if (!row) throw httpError(404, "Annonce introuvable");
  return json((await hydrate(env, [row]))[0]);
}

async function patchItem(request, env, id) {
  const row = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first();
  if (!row) throw httpError(404, "Annonce introuvable");
  const body = await request.json().catch(() => ({}));
  const sets = [], args = [];

  if (body.status !== undefined) {
    if (!STATUTS.includes(body.status)) throw httpError(400, "Statut invalide");
    sets.push("status = ?"); args.push(body.status);
  }
  if (body.prix !== undefined) {
    const p = clampPrix(body.prix);
    if (!p) throw httpError(400, "Prix invalide");
    sets.push("prix = ?"); args.push(p);
  }
  if (body.data !== undefined) {
    const merged = { ...JSON.parse(row.data), ...sanitizeData(body.data) };
    sets.push("data = ?"); args.push(JSON.stringify(merged));
  }
  if (!sets.length) throw httpError(400, "Rien à modifier");
  sets.push("updated_at = datetime('now')");
  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
  return getItem(env, id);
}

const CHAMPS = ["titre", "description", "categorie", "marque", "taille", "etat", "couleur", "matiere", "colis"];
function sanitizeData(d) {
  const out = {};
  for (const k of CHAMPS) {
    if (d[k] === undefined) continue;
    if (["categorie", "couleur", "matiere"].includes(k)) {
      out[k] = (Array.isArray(d[k]) ? d[k] : String(d[k]).split(/\s*[>,]\s*/)).map(String).map((s) => s.trim()).filter(Boolean);
    } else out[k] = String(d[k] ?? "").trim();
  }
  if (out.titre) out.titre = out.titre.slice(0, 100);
  if (out.description) out.description = out.description.slice(0, 2000);
  return out;
}

// ---------- File d'attente de l'extension ----------
async function queue(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM items WHERE status = 'valide' ORDER BY updated_at ASC LIMIT 50"
  ).all();
  return json(await hydrate(env, results));
}

async function claim(env, id) {
  // Passe atomiquement de « valide » à « publication » : évite une double publication.
  const r = await env.DB.prepare(
    "UPDATE items SET status = 'publication', updated_at = datetime('now') WHERE id = ? AND status = 'valide'"
  ).bind(id).run();
  if (!r.meta.changes) throw httpError(409, "Annonce déjà prise ou non validée");
  return getItem(env, id);
}

async function result(request, env, id) {
  const { ok, vinted_url, note } = await request.json().catch(() => ({}));
  const status = ok ? "publie" : "a_revoir";
  await env.DB.prepare(
    "UPDATE items SET status = ?, vinted_url = ?, note = ?, updated_at = datetime('now') WHERE id = ? AND status = 'publication'"
  ).bind(status, ok ? vinted_url || null : null, note ? String(note).slice(0, 2000) : null, id).run();
  return getItem(env, id);
}

// ---------- Utilitaires ----------
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
