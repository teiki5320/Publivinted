// Publivinted — contrôle des annonces rédigées par Claude sur le Mac (voir mac/agent.mjs).

const ETATS = ["Neuf avec étiquette", "Neuf sans étiquette", "Très bon état", "Bon état", "Satisfaisant"];
const COLIS = ["Petit", "Moyen", "Grand"];

// Valide et nettoie la réponse : on ne fait pas confiance aveuglément au format.
export function normaliser(obj, nbPhotos) {
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
