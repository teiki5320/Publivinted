# Publivinted

Outil perso pour publier mes propres annonces Vinted.

## Process
1. **Appli web** : j'importe mes photos.
2. **Claude** regroupe les photos par article et rédige les annonces.
3. **Écran swipe** : je valide chaque annonce et ajuste le prix conseillé (−/+).
4. **Extension Chrome** : publie le lot validé sur vinted.fr.

## Adresses
- Appli : https://teiki5320.github.io/publivinted/ (GitHub Pages, dossier `docs/`) — à ouvrir depuis un Raccourci iOS (« Ouvrir les URL »).
- API : https://publivinted.teiki5320.workers.dev

## Stack
- GitHub Pages (appli web, `docs/`)
- Cloudflare Worker (API ; sert aussi `docs/` en local avec `wrangler dev`)
- Cloudflare D1 (annonces, statuts)
- Cloudflare R2 (photos, conservées après la vente)
- Extension Chrome Manifest V3 (`/extension`)

## Avancement
- [x] Étape 1 — extension : relevé des sélecteurs, remplissage d'une annonce de test, relecture, bandeau (sans publication)
- [ ] Étape 2 — …

## Installer l'extension (dev)
1. `chrome://extensions` → activer le *Mode développeur*.
2. *Charger l'extension non empaquetée* → choisir le dossier `extension/`.
3. Ouvrir https://www.vinted.fr/items/new, cliquer l'icône Publivinted → *Remplir l'annonce de test*.

L'extension ne clique jamais sur « Publier » à l'étape 1.

## Règles du dépôt
Branche `main` uniquement, pas de branche ni de PR.
