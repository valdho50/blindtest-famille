// Client minimal pour l'API REST de Grist (https://support.getgrist.com/api/).
// Sert à authentifier les maîtres du jeu et à résoudre les répertoires de
// chansons auxquels leur compte a droit.
//
// Configuration attendue (variables d'environnement) :
//   GRIST_API_KEY       clé API personnelle Grist (Profil > API Key)
//   GRIST_DOC_ID         identifiant du document Grist (visible dans son URL)
//   GRIST_API_BASE        optionnel, défaut https://docs.getgrist.com/api
//   GRIST_HOSTS_TABLE      optionnel, défaut "Hosts"
//   GRIST_REPERTOIRES_TABLE  optionnel, défaut "Repertoires"
//
// Schéma attendu dans le document Grist :
//   Table "Hosts"
//     - Username       (Texte)
//     - PasswordHash   (Texte)   hash bcrypt, jamais le mot de passe en clair
//     - DisplayName    (Texte)
//     - Active         (Bascule / Booléen)
//     - Repertoires    (Référence liste -> table "Repertoires")
//   Table "Repertoires"
//     - Label          (Texte)   nom affiché du répertoire
//     - ThemeId        (Texte)   doit correspondre à un id de thème dans data/songs.json

const GRIST_API_BASE = process.env.GRIST_API_BASE || 'https://docs.getgrist.com/api';
const GRIST_DOC_ID = process.env.GRIST_DOC_ID;
const GRIST_API_KEY = process.env.GRIST_API_KEY;
const HOSTS_TABLE = process.env.GRIST_HOSTS_TABLE || 'Hosts';
const REPERTOIRES_TABLE = process.env.GRIST_REPERTOIRES_TABLE || 'Repertoires';

function isConfigured() {
  return Boolean(GRIST_DOC_ID && GRIST_API_KEY);
}

async function gristFetch(path) {
  if (!isConfigured()) {
    throw new Error(
      'Grist non configuré : définis GRIST_DOC_ID et GRIST_API_KEY dans les variables d\'environnement.'
    );
  }
  const res = await fetch(`${GRIST_API_BASE}/docs/${GRIST_DOC_ID}${path}`, {
    headers: { Authorization: `Bearer ${GRIST_API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erreur Grist (${res.status}) sur ${path} : ${body}`);
  }
  return res.json();
}

async function gristPost(path, body) {
  if (!isConfigured()) {
    throw new Error(
      'Grist non configuré : définis GRIST_DOC_ID et GRIST_API_KEY dans les variables d\'environnement.'
    );
  }
  const res = await fetch(`${GRIST_API_BASE}/docs/${GRIST_DOC_ID}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GRIST_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Erreur Grist (${res.status}) sur ${path} : ${errBody}`);
  }
  return res.json();
}

// Les colonnes "Référence liste" peuvent revenir sous deux formes selon les
// versions de l'API Grist : soit un tableau brut d'ids [2, 5], soit une valeur
// "taguée" ['L', 2, 5] (encodage interne Grist pour les listes). On normalise.
function normalizeRefList(value) {
  if (!Array.isArray(value)) return [];
  if (value[0] === 'L') return value.slice(1).filter((v) => typeof v === 'number');
  return value.filter((v) => typeof v === 'number');
}

// Cherche un compte par identifiant (insensible à la casse). Retourne null si
// introuvable ou inactif.
async function findHostByUsername(username) {
  const data = await gristFetch(`/tables/${HOSTS_TABLE}/records`);
  const records = data.records || [];
  const needle = (username || '').trim().toLowerCase();
  const match = records.find((r) => (r.fields.Username || '').trim().toLowerCase() === needle);
  if (!match) return null;
  if (match.fields.Active === false) return null;
  return {
    id: match.id,
    username: match.fields.Username,
    passwordHash: match.fields.PasswordHash || '',
    displayName: match.fields.DisplayName || match.fields.Username,
    repertoireRowIds: normalizeRefList(match.fields.Repertoires),
  };
}

// Résout les ids de thèmes (data/songs.json) auxquels un compte a droit, à
// partir des lignes "Repertoires" liées à son compte Hosts.
async function getThemeIdsForRepertoireRows(rowIds) {
  if (!rowIds.length) return [];
  const data = await gristFetch(`/tables/${REPERTOIRES_TABLE}/records`);
  const records = data.records || [];
  const rowIdSet = new Set(rowIds);
  return records
    .filter((r) => rowIdSet.has(r.id))
    .map((r) => r.fields.ThemeId)
    .filter(Boolean);
}

// Crée un nouveau compte maître du jeu (self-service, depuis host.html).
// Actif par défaut, sans répertoire attribué au départ — l'accès au(x)
// répertoire(s) "offert(s)" est géré côté serveur (data/songs.json), et
// l'administrateur pourra ensuite attribuer des répertoires supplémentaires
// à ce compte directement dans Grist (ou, plus tard, via un système de
// crédits).
async function createHost({ username, passwordHash, displayName }) {
  const result = await gristPost(`/tables/${HOSTS_TABLE}/records`, {
    records: [
      {
        fields: {
          Username: username,
          PasswordHash: passwordHash,
          DisplayName: displayName || username,
          Active: true,
        },
      },
    ],
  });
  return result.records[0].id;
}

module.exports = {
  isConfigured,
  findHostByUsername,
  getThemeIdsForRepertoireRows,
  createHost,
};