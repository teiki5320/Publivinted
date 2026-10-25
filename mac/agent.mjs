#!/usr/bin/env node
// Publivinted — programme du Mac.
// Récupère les lots de photos envoyés depuis l'appli, fait rédiger les annonces par Claude Code
// avec l'abonnement du Mac (`claude -p`, aucune clé API) et renvoie le résultat au serveur.
// Lancé en continu par launchd (voir mac/installer.sh). Réglages dans mac/.env : PV_API, PV_TOKEN.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ATTENTE = 15000;                // entre deux vérifications quand il n'y a rien à faire
const DELAI_CLAUDE = 15 * 60 * 1000;  // au-delà, on abandonne le lot

// ---------- Réglages ----------
function lireEnv(fichier) {
  const env = {};
  try {
    for (const ligne of fs.readFileSync(fichier, "utf8").split("\n")) {
      const m = ligne.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* pas de fichier : variables d'environnement seulement */ }
  return env;
}
const cfg = { ...lireEnv(path.join(ICI, ".env")), ...process.env };
const API = (cfg.PV_API || "https://publivinted.teiki5320.workers.dev").replace(/\/$/, "");
const TOKEN = cfg.PV_TOKEN || "";
if (!TOKEN) {
  console.error("PV_TOKEN manquant : mets le code d'accès de l'appli dans mac/.env (PV_TOKEN=...).");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toLocaleString("fr-FR"), "—", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Serveur ----------
async function api(chemin, opts = {}) {
  const res = await fetch(API + chemin, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`${chemin} : erreur ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

// ---------- Claude Code ----------
// Localise `claude` même quand launchd lance le programme avec un PATH réduit (CLAUDE_BIN pour forcer).
function claudeBin() {
  const home = os.homedir();
  const candidats = [
    cfg.CLAUDE_BIN,
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ].filter(Boolean);
  return candidats.find((c) => fs.existsSync(c)) || "claude";
}

const CONSIGNE = `Tu aides un particulier à vendre ses propres affaires sur Vinted (France).
On te donne des photos numérotées à partir de 0. Plusieurs photos peuvent montrer le même article.

Tâche :
1. Regroupe les photos par article (un article = un objet vendu seul ou un lot évident).
2. Pour chaque article, rédige une annonce Vinted en français, honnête et précise.

Règles de rédaction :
- titre : 100 caractères max, « type + marque + détail utile » (ex. « Pull col rond Zara laine bleu marine »).
- description : 3 à 6 phrases, naturelles, sans emoji excessif ni majuscules criardes. Mentionne l'état réel, les défauts visibles, la matière si lisible sur l'étiquette, et les mesures si visibles. N'invente rien : si une info n'est pas visible, ne l'affirme pas.
- categorie : chemin complet du catalogue Vinted, du plus général au plus précis, en libellés exacts Vinted (ex. ["Hommes", "Vêtements", "Pulls et sweats", "Pulls"]). Racines possibles : Femmes, Hommes, Enfants, Maison, Électronique, Divertissement, Loisirs et collections, Sport.
- marque : telle que lue sur l'étiquette ou le produit ; "" si inconnue.
- taille : libellé Vinted (XS, S, M, L, XL, 38, 40, Taille unique…) ; "" si sans objet ou illisible.
- etat : exactement l'une de ces valeurs : "Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état", "Satisfaisant".
- couleur : 1 ou 2 couleurs Vinted (Noir, Blanc, Gris, Beige, Marron, Bleu, Bleu marine, Vert, Kaki, Jaune, Orange, Rouge, Bordeaux, Rose, Violet, Multicolore…).
- matiere : 0 à 3 matières Vinted (Coton, Laine, Polyester, Lin, Cuir, Jean, Soie, Cachemire…), seulement si lisibles ou évidentes ; [] sinon.
- colis : "Petit" (enveloppe, vêtement léger), "Moyen" (chaussures, pull épais), ou "Grand" (objet volumineux).
- prix : estimation réaliste du marché de l'occasion Vinted en euros entiers : prix_conseille, prix_min, prix_max.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"articles":[{"photos":[0,1],"annonce":{"titre":"","description":"","categorie":[],"marque":"","taille":"","etat":"","couleur":[],"matiere":[],"colis":""},"prix_conseille":0,"prix_min":0,"prix_max":0}]}
Chaque photo doit apparaître dans un seul article.`;

function demanderClaude(dossier, fichiers) {
  const prompt =
    CONSIGNE +
    `\n\nLes ${fichiers.length} photos sont les fichiers ${fichiers.join(", ")} du dossier courant (photo-N = photo N). ` +
    `Lis-les toutes avec l'outil Read avant de répondre, puis produis le JSON.`;
  return new Promise((resolve, reject) => {
    // Seul l'outil Read est disponible, dans un dossier temporaire qui ne contient que les photos.
    // --safe-mode : ni plugins, ni hooks, ni serveurs MCP du Mac ; l'abonnement reste utilisé.
    const child = spawn(
      claudeBin(),
      ["-p", prompt, "--output-format", "json", "--tools", "Read", "--allowedTools", "Read",
       "--strict-mcp-config", "--no-session-persistence", "--safe-mode"],
      { cwd: dossier, stdio: ["ignore", "pipe", "pipe"], env: process.env }
    );
    let out = "", err = "";
    const minuteur = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Claude a mis trop de temps à répondre")); }, DELAI_CLAUDE);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(minuteur);
      reject(e.code === "ENOENT" ? new Error("Commande `claude` introuvable sur le Mac (CLAUDE_BIN dans mac/.env)") : e);
    });
    child.on("close", (code) => {
      clearTimeout(minuteur);
      let enveloppe = null;
      try { enveloppe = JSON.parse(out); } catch { /* pas du JSON */ }
      const texte = enveloppe && typeof enveloppe.result === "string" ? enveloppe.result : out;
      if (code !== 0 || enveloppe?.is_error) {
        const detail = `${texte}\n${err}`.trim().slice(0, 300);
        if (/login|logged out|authenticat|credential|oauth|expired/i.test(detail)) {
          return reject(new Error("Claude Code n'est pas connecté sur le Mac : lance `claude` puis /login"));
        }
        return reject(new Error(`claude -p a échoué (code ${code}) : ${detail || "aucun message"}`));
      }
      resolve(texte);
    });
  });
}

function extraireJson(texte) {
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut < 0 || fin < debut) throw new Error("Réponse de Claude sans JSON");
  return JSON.parse(texte.slice(debut, fin + 1));
}

// ---------- Un lot ----------
async function traiter(lot) {
  log(`Lot ${lot.id} : ${lot.photos.length} photo(s), rédaction par Claude…`);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "publivinted-"));
  try {
    const fichiers = [];
    for (let i = 0; i < lot.photos.length; i++) {
      const res = await api(`/api/photos/${lot.photos[i]}`);
      const ext = { "image/png": "png", "image/webp": "webp" }[res.headers.get("Content-Type")] || "jpg";
      fichiers.push(`photo-${i}.${ext}`);
      fs.writeFileSync(path.join(dossier, fichiers[i]), Buffer.from(await res.arrayBuffer()));
    }
    const t0 = Date.now();
    const resultat = extraireJson(await demanderClaude(dossier, fichiers));
    const r = await (await api(`/api/mac/batches/${lot.id}/result`, { method: "POST", body: JSON.stringify(resultat) })).json();
    log(`Lot ${lot.id} : ${r.ok ? `${r.items} annonce(s) prête(s)` : "réponse refusée par le serveur"} en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    log(`Lot ${lot.id} : échec — ${e.message}`);
    await api(`/api/mac/batches/${lot.id}/result`, { method: "POST", body: JSON.stringify({ error: e.message }) }).catch(() => {});
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// ---------- Boucle ----------
log(`Programme Publivinted démarré (serveur ${API})`);
for (;;) {
  try {
    const { batch } = await (await api("/api/mac/next", { method: "POST" })).json();
    if (batch) { await traiter(batch); continue; }
  } catch (e) {
    log("Serveur injoignable :", e.message);
  }
  await sleep(ATTENTE);
}
