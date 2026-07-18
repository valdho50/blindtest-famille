const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const songData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'songs.json'), 'utf-8'));

// --- Etat en mémoire ---
// rooms[code] = {
//   hostSocketId, players: { socketId: {name, score} },
//   theme, usedSongIds: Set, currentSong, phase, pendingAnswers: {}
// }
const rooms = {};

function generateCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function publicPlayers(room) {
  return Object.entries(room.players).map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
  }));
}

// Toutes les chansons (chaque chanson peut appartenir à plusieurs thématiques
// via son tableau `themes`). Sert aussi à piocher des leurres QCM même si la
// thématique en cours n'a pas assez de titres différents.
const allSongs = songData.songs;
const allTitles = [...new Set(allSongs.map((s) => s.title))];
const allArtists = [...new Set(allSongs.map((s) => s.artist))];

// Pioche une chanson jamais encore proposée durant cette partie. Priorité aux
// chansons rattachées à la thématique choisie (une chanson peut appartenir à
// plusieurs thématiques) ; si elle est épuisée, on pioche parmi toutes les
// chansons plutôt que de répéter un titre déjà joué. Retourne null si vraiment
// toutes les chansons connues ont déjà servi.
function pickSong(room, themeId) {
  const themeSongs = allSongs.filter((s) => s.themes.includes(themeId));
  if (themeSongs.length === 0) return null;
  let available = themeSongs.filter((s) => !room.usedSongIds.has(s.id));
  if (available.length === 0) {
    available = allSongs.filter((s) => !room.usedSongIds.has(s.id));
  }
  if (available.length === 0) return null;
  const song = available[Math.floor(Math.random() * available.length)];
  room.usedSongIds.add(song.id);
  return song;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOptions(correctValue, pool, count = 4) {
  const decoys = shuffle(pool.filter((v) => v !== correctValue)).slice(0, count - 1);
  return shuffle([correctValue, ...decoys]);
}

// Détermine si la manche à venir doit être en QCM, selon le mode choisi par l'hôte.
function resolveRoundMode(room) {
  if (room.answerMode === 'libre') return 'libre';
  if (room.answerMode === 'qcm') return 'qcm';
  // mode 'mixte' : proportion de QCM définie par room.qcmRatio (0-100)
  return Math.random() * 100 < room.qcmRatio ? 'qcm' : 'libre';
}

io.on('connection', (socket) => {
  // --- HOST ---
  socket.on('host:create', (cb) => {
    const code = generateCode();
    rooms[code] = {
      hostSocketId: socket.id,
      players: {},
      theme: null,
      usedSongIds: new Set(),
      currentSong: null,
      currentRoundMode: 'libre',
      phase: 'lobby',
      pendingAnswers: {},
      answerMode: 'libre', // 'libre' | 'qcm' | 'mixte'
      qcmRatio: 50, // % de manches en QCM quand answerMode === 'mixte'
      timerDuration: 30, // secondes ; 0 = pas de minuteur
      questionCount: 10, // nombre de questions pour la partie (5, 10, 15 ou 20)
      questionsAsked: 0, // nombre de questions déjà posées dans la partie en cours
      videoDiffusion: 'host', // 'host' | 'players' | 'both' : où l'extrait vidéo est lu à la correction
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = true;
    cb({
      code,
      themes: songData.themes.map((t) => ({
        id: t.id,
        label: t.label,
        count: allSongs.filter((s) => s.themes.includes(t.id)).length,
      })),
      questionCount: rooms[code].questionCount,
      videoDiffusion: rooms[code].videoDiffusion,
    });
  });

  socket.on('host:selectTheme', ({ code, themeId }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.theme = themeId;
    room.phase = 'theme-selected';
    io.to(code).emit('game:themeSelected', {
      themeId,
      label: songData.themes.find((t) => t.id === themeId)?.label,
    });
  });

  socket.on('host:setAnswerMode', ({ code, answerMode, qcmRatio }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    if (['libre', 'qcm', 'mixte'].includes(answerMode)) {
      room.answerMode = answerMode;
    }
    if (typeof qcmRatio === 'number' && qcmRatio >= 0 && qcmRatio <= 100) {
      room.qcmRatio = qcmRatio;
    }
  });

  socket.on('host:setTimerDuration', ({ code, timerDuration }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    if (typeof timerDuration === 'number' && timerDuration >= 0 && timerDuration <= 300) {
      room.timerDuration = timerDuration;
    }
  });

  socket.on('host:setQuestionCount', ({ code, questionCount }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    if ([5, 10, 15, 20].includes(questionCount)) {
      room.questionCount = questionCount;
    }
  });

  socket.on('host:setVideoDiffusion', ({ code, videoDiffusion }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    if (['host', 'players', 'both'].includes(videoDiffusion)) {
      room.videoDiffusion = videoDiffusion;
    }
  });

  socket.on('host:startRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id || !room.theme) return;
    if (room.questionsAsked >= room.questionCount) return;
    const song = pickSong(room, room.theme);
    if (!song) {
      // Plus aucune chanson inédite disponible : on termine la partie proprement.
      io.to(room.hostSocketId).emit('game:noMoreSongs');
      return;
    }
    room.currentSong = song;
    room.phase = 'question';
    room.pendingAnswers = {};
    room.questionsAsked += 1;
    const roundMode = resolveRoundMode(room);
    room.currentRoundMode = roundMode;

    const payload = {
      phrase: song.phrase,
      mode: roundMode,
      questionIndex: room.questionsAsked,
      questionCount: room.questionCount,
    };
    if (roundMode === 'qcm') {
      payload.titleOptions = buildOptions(song.title, allTitles);
      payload.artistOptions = buildOptions(song.artist, allArtists);
    }
    if (room.timerDuration > 0) {
      payload.timerDuration = room.timerDuration;
      payload.timerEndsAt = Date.now() + room.timerDuration * 1000;
    }
    io.to(code).emit('game:phrase', payload);
    // Roster des joueurs de la manche + statut (aucun n'a encore répondu) pour
    // afficher les pastilles rouges/vertes côté maître du jeu, sans dévoiler
    // le contenu des réponses avant la correction.
    io.to(room.hostSocketId).emit('game:roundPlayers', { players: publicPlayers(room) });
    io.to(room.hostSocketId).emit('game:answersStatus', { answeredIds: [] });
    // Réponse attendue envoyée uniquement au maître du jeu, dès le début de la manche,
    // pour qu'il puisse suivre/valider les réponses des joueurs en connaissance de cause.
    // Restera masquée côté interface tant que le maître du jeu n'active pas l'interrupteur.
    io.to(room.hostSocketId).emit('game:answerHint', {
      title: song.title,
      artist: song.artist,
    });
  });

  // Bascule vers l'écran de correction (utilisée à la fois pour le déclenchement manuel
  // par le maître du jeu et pour la bascule automatique quand tous les joueurs ont répondu).
  function revealRound(room, code) {
    if (!room || !room.currentSong || room.phase !== 'question') return;
    room.phase = 'reveal';
    const song = room.currentSong;
    // Les réponses détaillées de chaque joueur (y compris ceux qui n'ont rien
    // envoyé) ne sont transmises qu'au moment de la correction, pour validation
    // des points par le maître du jeu sur l'écran de correction.
    const answers = Object.entries(room.players).map(([id, p]) => ({
      id,
      name: p.name,
      titleGuess: room.pendingAnswers[id]?.titleGuess || '',
      artistGuess: room.pendingAnswers[id]?.artistGuess || '',
    }));
    // L'extrait vidéo est toujours transmis au maître du jeu (pour contrôle/aperçu) ;
    // il ne sera lu sur son écran que si videoDiffusion vaut 'host' ou 'both' (géré côté client).
    io.to(room.hostSocketId).emit('game:revealHost', {
      title: song.title,
      artist: song.artist,
      youtubeId: song.youtubeId,
      start: song.start,
      end: song.end,
      videoDiffusion: room.videoDiffusion,
      isLastQuestion: room.questionsAsked >= room.questionCount,
      questionIndex: room.questionsAsked,
      questionCount: room.questionCount,
      answers,
    });
    // Les joueurs ne reçoivent l'extrait vidéo que si le maître du jeu a choisi de
    // le diffuser sur leurs appareils ('players' ou 'both').
    const sendVideoToPlayers = room.videoDiffusion === 'players' || room.videoDiffusion === 'both';
    io.to(code).except(room.hostSocketId).emit('game:revealPlayers', {
      title: song.title,
      artist: song.artist,
      ...(sendVideoToPlayers ? { youtubeId: song.youtubeId, start: song.start, end: song.end } : {}),
    });
  }

  socket.on('host:reveal', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    revealRound(room, code);
  });

  socket.on('host:validateAnswer', ({ code, playerId, titleCorrect, artistCorrect }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    const player = room.players[playerId];
    if (!player) return;
    let points = 0;
    if (titleCorrect) points += 1;
    if (artistCorrect) points += 1;
    player.score += points;
    io.to(code).emit('game:scoreboard', { players: publicPlayers(room) });
  });

  socket.on('host:endGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    io.to(code).emit('game:ended', { players: publicPlayers(room) });
    delete rooms[code];
  });

  // --- PLAYER ---
  socket.on('player:join', ({ code, name }, cb) => {
    const room = rooms[code];
    if (!room) {
      cb({ ok: false, error: 'Code de partie inconnu.' });
      return;
    }
    room.players[socket.id] = { name: name.slice(0, 20) || 'Joueur', score: 0 };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = false;
    cb({ ok: true });
    io.to(room.hostSocketId).emit('lobby:update', { players: publicPlayers(room) });
    io.to(code).emit('game:scoreboard', { players: publicPlayers(room) });
  });

  socket.on('player:submitAnswer', ({ code, titleGuess, artistGuess }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'question') return;
    room.pendingAnswers[socket.id] = { titleGuess, artistGuess };
    // Pendant la question, le maître du jeu ne voit que le statut "a répondu / pas
    // encore" (pastille rouge/verte) — pas le contenu des réponses, réservé à
    // l'écran de correction.
    io.to(room.hostSocketId).emit('game:answersStatus', { answeredIds: Object.keys(room.pendingAnswers) });

    // Bascule automatique vers la correction dès que tous les joueurs présents
    // ont répondu (le maître du jeu garde la main pour lancer manuellement plus tôt).
    const playerIds = Object.keys(room.players);
    const answeredCount = Object.keys(room.pendingAnswers).length;
    if (playerIds.length > 0 && answeredCount >= playerIds.length) {
      revealRound(room, code);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (socket.data.isHost) {
      io.to(code).emit('game:hostLeft');
      delete rooms[code];
    } else {
      delete room.players[socket.id];
      io.to(room.hostSocketId).emit('lobby:update', { players: publicPlayers(room) });
      io.to(code).emit('game:scoreboard', { players: publicPlayers(room) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Blind test prêt sur http://localhost:${PORT}`);
  console.log(`  Écran maître du jeu : http://localhost:${PORT}/host.html`);
  console.log(`  Écran joueur        : http://localhost:${PORT}/player.html`);
});