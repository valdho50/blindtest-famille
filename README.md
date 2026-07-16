# Blind Test Famille — Prototype

Jeu de blind test multijoueur : une phrase de chanson s'affiche, les joueurs devinent le titre et/ou l'interprète depuis leur téléphone, le maître du jeu valide les réponses puis lance un extrait YouTube pour la correction.

## ⚠️ À vérifier avant de jouer

Les identifiants YouTube dans `data/songs.json` sont des exemples fournis à titre indicatif et **n'ont pas été vérifiés un par un** — certains peuvent être incorrects, indisponibles ou avoir changé. Avant une partie, remplace-les par des liens que tu as toi-même vérifiés (ouvre la vidéo sur YouTube, récupère l'identifiant dans l'URL après `v=`, et choisis un timecode de départ/fin pertinent).

## Installation

Prérequis : [Node.js](https://nodejs.org) installé sur l'ordinateur qui fera office d'écran du maître du jeu.

```bash
cd blindtest
npm install
npm start
```

Le terminal affiche :
```
Blind test prêt sur http://localhost:3000
  Écran maître du jeu : http://localhost:3000/host.html
  Écran joueur        : http://localhost:3000/player.html
```

## Lancer une partie

1. Sur l'ordinateur (ou la TV) qui sert d'écran principal, ouvre `http://localhost:3000/host.html` et clique sur **Créer une nouvelle partie**. Un code à 4 chiffres s'affiche.
2. Assure-toi que les téléphones des joueurs sont connectés **au même réseau Wi-Fi** que cet ordinateur.
3. Trouve l'adresse IP locale de l'ordinateur hôte :
   - Windows : `ipconfig` (ligne "Adresse IPv4")
   - Mac/Linux : `ifconfig` ou `ip a` (souvent une adresse du type `192.168.x.x`)
4. Sur chaque téléphone, ouvre un navigateur et va sur `http://<IP-de-l-ordinateur>:3000/player.html` (ex : `http://192.168.1.42:3000/player.html`), saisit le code de partie et un pseudo.
5. Depuis l'écran du maître du jeu, choisis une thématique, clique sur **Lancer une manche**.
6. Les joueurs voient la phrase et envoient leur réponse. Le maître du jeu voit les réponses arriver en direct, coche "titre ok" / "interprète ok" pour chaque joueur et valide (1 point par élément correct).
7. Clique sur **Lancer la correction** : le titre, l'interprète et l'extrait YouTube (audio) s'affichent sur l'écran du maître du jeu — c'est lui qui diffuse le son (haut-parleurs de l'ordinateur ou enceinte branchée). Les joueurs voient uniquement le titre/interprète, pas la vidéo.
8. **Manche suivante** pour continuer, **Terminer la partie** pour clore et afficher les scores finaux.

## Ajouter / modifier des chansons

Édite directement `data/songs.json`. Chaque thématique contient une liste de chansons avec :
- `phrase` : la phrase proposée aux joueurs
- `title`, `artist` : la bonne réponse
- `youtubeId` : l'identifiant de la vidéo YouTube (partie après `v=` dans l'URL)
- `start`, `end` : le timecode (en secondes) de l'extrait à jouer au moment de la correction

Tu peux aussi ajouter de nouvelles thématiques en dupliquant un bloc `{ "id": ..., "label": ..., "songs": [...] }`.

## Limites connues de ce prototype

- Les données de partie sont en mémoire : si le serveur redémarre, les parties en cours sont perdues.
- Pas de minuteur automatique sur les réponses — c'est au maître du jeu de gérer le rythme oralement (ou de compter mentalement).
- La correction manuelle des réponses part du principe que le maître du jeu gère les fautes de frappe/variantes de titre à l'oeil.
- Fonctionne en local (même Wi-Fi). Pour jouer à distance, il faudrait héberger le serveur en ligne (Render, Railway, etc.) — faisable sans changer le code, mais pas fait dans ce prototype.
