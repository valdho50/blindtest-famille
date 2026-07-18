// Client minimal pour l'API Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sert uniquement à envoyer l'email de réinitialisation de mot de passe.
//
// Configuration attendue (variables d'environnement) :
//   RESEND_API_KEY    clé API Resend (dashboard Resend > API Keys)
//   RESEND_FROM_EMAIL adresse d'expédition, sur un domaine vérifié dans Resend
//                      (ex: "Quizz <no-reply@tondomaine.fr>")
//
// Sans domaine vérifié dans Resend, l'envoi ne fonctionne que vers l'adresse
// email du propriétaire du compte Resend (limite du mode "test" de Resend).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

function isConfigured() {
  return Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!isConfigured()) {
    throw new Error(
      'Resend non configuré : définis RESEND_API_KEY et RESEND_FROM_EMAIL dans les variables d\'environnement.'
    );
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject: 'Réinitialise ton mot de passe — Quizz, on connaît la chanson',
      html: `
        <p>Bonjour,</p>
        <p>Une demande de réinitialisation de mot de passe a été faite pour ton compte maître du jeu.</p>
        <p><a href="${resetUrl}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
        <p>Si tu n'es pas à l'origine de cette demande, tu peux ignorer cet email.</p>
      `,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erreur Resend (${res.status}) : ${body}`);
  }
  return res.json();
}

module.exports = {
  isConfigured,
  sendPasswordResetEmail,
};