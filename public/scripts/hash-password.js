// Génère un hash bcrypt à coller dans la colonne "PasswordHash" de la table
// "Hosts" du document Grist, pour créer ou réinitialiser le mot de passe d'un
// compte maître du jeu.
//
// Usage :
//   node scripts/hash-password.js "monMotDePasse"

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage : node scripts/hash-password.js "<mot de passe>"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(hash);