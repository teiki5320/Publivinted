// Publivinted — sélecteurs du formulaire https://www.vinted.fr/items/new
// Chaque champ a une liste de candidats, essayés dans l'ordre (data-testid en premier).
// `label` sert de secours : on cherche le champ par le texte de son libellé.
// Statut : À CONFIRMER sur la page réelle (relevé en cours).

window.PV_SELECTORS = {
  photos: {
    type: "file",
    candidates: [
      '[data-testid="add-photos-input"]',
      '[data-testid="photo-uploader"] input[type="file"]',
      'input[type="file"][accept*="image"]',
      'input[type="file"]'
    ],
    // Pour la relecture : vignettes affichées après upload
    thumbnails: [
      '[data-testid^="photo-uploader-thumbnail"]',
      '[data-testid="photo-uploader"] img'
    ]
  },
  titre: {
    type: "text",
    candidates: ['[data-testid="title--input"]', 'input#title', 'input[name="title"]'],
    label: "Titre"
  },
  description: {
    type: "text",
    candidates: ['[data-testid="description--input"]', 'textarea#description', 'textarea[name="description"]'],
    label: "Décris ton article"
  },
  categorie: {
    type: "tree", // menu en cascade : on clique chaque niveau du chemin
    candidates: ['[data-testid="catalog-select-dropdown-input"]', 'input[name="category"]', '#category'],
    label: "Catégorie"
  },
  marque: {
    type: "search", // menu avec champ de recherche
    candidates: ['[data-testid="brand-select-dropdown-input"]', 'input[name="brand"]', '#brand'],
    searchInput: ['[data-testid="brand-search--input"]', '[data-testid="dropdown-search-input"]', 'input[type="search"]'],
    label: "Marque"
  },
  taille: {
    type: "select",
    candidates: ['[data-testid="size-select-dropdown-input"]', 'input[name="size"]', '#size'],
    label: "Taille"
  },
  etat: {
    type: "select",
    candidates: ['[data-testid="status-select-dropdown-input"]', '[data-testid="condition-select-dropdown-input"]', 'input[name="status"]', '#status'],
    label: "État"
  },
  couleur: {
    type: "multi",
    candidates: ['[data-testid="color-select-dropdown-input"]', 'input[name="color"]', '#color'],
    label: "Couleur"
  },
  matiere: {
    type: "multi",
    candidates: ['[data-testid="material-select-dropdown-input"]', '[data-testid="materials-select-dropdown-input"]', 'input[name="material"]'],
    label: "Matière"
  },
  prix: {
    type: "text",
    candidates: ['[data-testid="price-input--input"]', 'input[name="price"]', '#price'],
    label: "Prix"
  },
  colis: {
    type: "radio", // cartes radio Petit / Moyen / Grand
    candidates: ['[data-testid="package-size-selector"]', '[data-testid^="package-size"]'],
    optionCandidates: ['[data-testid^="package-size-"] input[type="radio"]', 'input[type="radio"][name*="package"]'],
    label: "Format du colis"
  },
  // Options des menus déroulants (toutes listes confondues)
  dropdownOptions: [
    '[data-testid$="--cell"]',
    '[data-testid*="dropdown"] [role="option"]',
    '[role="listbox"] [role="option"]',
    '.web_ui__Cell__cell[role="button"]'
  ],
  // Bouton de publication — jamais cliqué à l'étape 1, référencé pour l'étape 2
  publier: ['[data-testid="upload-form-save-button"]', 'button[type="submit"]']
};
