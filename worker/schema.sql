-- Publivinted — schéma D1

CREATE TABLE IF NOT EXISTS batches (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- import | attente (du Mac) | analyse (Claude rédige sur le Mac) | pret | erreur
  status      TEXT NOT NULL DEFAULT 'import',
  note        TEXT,                                -- message d'erreur de la rédaction
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  batch_id    TEXT NOT NULL REFERENCES batches(id),
  item_id     TEXT REFERENCES items(id),
  r2_key      TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_batch ON photos(batch_id);
CREATE INDEX IF NOT EXISTS idx_photos_item  ON photos(item_id);

-- statut : brouillon | valide | ecarte | publication | publie | vendu | a_revoir
CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES batches(id),
  status          TEXT NOT NULL DEFAULT 'brouillon',
  data            TEXT NOT NULL,          -- JSON : titre, description, categorie[], marque, taille, etat, couleur[], matiere[], colis
  prix_conseille  REAL,
  prix_min        REAL,
  prix_max        REAL,
  prix            REAL,
  vinted_url      TEXT,
  note            TEXT,                   -- message d'erreur ou rapport de relecture
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
