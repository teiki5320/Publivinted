// Publivinted — regroupement des photos et rédaction des annonces par Claude (API Messages).

const SYSTEME = `Tu aides un particulier à vendre ses propres affaires sur Vinted (France).
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

const ETATS = ["Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état", "Satisfaisant"];
const COLIS = ["Petit", "Moyen", "Grand"];

export async function analyseBatch(env, photos) {
  const content = [];
  for (let i = 0; i < photos.length; i++) {
    const obj = await env.PHOTOS.get(photos[i].r2_key);
    if (!obj) continue;
    const buf = await obj.arrayBuffer();
    content.push({ type: "text", text: `Photo ${i} :` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: obj.httpMetadata?.contentType || "image/jpeg", data: toBase64(buf) }
    });
  }
  content.push({ type: "text", text: `Il y a ${photos.length} photos (0 à ${photos.length - 1}). Produis le JSON.` });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      system: SYSTEME,
      messages: [{ role: "user", content }]
    })
  });
  if (!res.ok) throw new Error(`API ${res.status} : ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return normaliser(extraireJson(text), photos.length);
}

function extraireJson(text) {
  const debut = text.indexOf("{");
  const fin = text.lastIndexOf("}");
  if (debut < 0 || fin < debut) throw new Error("Réponse sans JSON");
  return JSON.parse(text.slice(debut, fin + 1));
}

// Valide et nettoie la réponse : on ne fait pas confiance aveuglément au format.
function normaliser(obj, nbPhotos) {
  const vus = new Set();
  const arts = [];
  for (const a of obj.articles || []) {
    const photos = [];
    for (const i of (a.photos || []).map(Number)) {
      if (Number.isInteger(i) && i >= 0 && i < nbPhotos && !vus.has(i)) { vus.add(i); photos.push(i); }
    }
    if (!photos.length) continue;
    const n = a.annonce || {};
    const liste = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).map((s) => s.trim()).filter(Boolean);
    arts.push({
      photos,
      annonce: {
        titre: String(n.titre || "").slice(0, 100),
        description: String(n.description || "").slice(0, 2000),
        categorie: liste(n.categorie),
        marque: String(n.marque || ""),
        taille: String(n.taille || ""),
        etat: ETATS.includes(n.etat) ? n.etat : "Bon état",
        couleur: liste(n.couleur).slice(0, 2),
        matiere: liste(n.matiere).slice(0, 3),
        colis: COLIS.includes(n.colis) ? n.colis : "Petit"
      },
      prix_conseille: a.prix_conseille,
      prix_min: a.prix_min,
      prix_max: a.prix_max
    });
  }
  if (!arts.length) throw new Error("Aucun article reconnu");
  return arts;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
