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

function pickSong(room, themeId) {
  const theme = songData.themes.find((t) => t.id === themeId);
  if (!theme) return null;
  const available = theme.songs.filter((s) => !room.usedSongIds.has(s.id));
  const pool = available.length > 0 ? available : theme.songs;
  const song = pool[Math.floor(Math.random() * pool.length)];
  room.usedSongIds.add(song.id);
  return song;
}

// Toutes les chansons, toutes thématiques confondues (pour piocher des leurres QCM
// même si la thématique en cours n'a pas assez de titres différents).
const allSongs = songData.themes.flatMap((t) => t.songs);
const allTitles = [...new Set(allSongs.map((s) => s.title))];
const allArtists = [...new Set(allSongs.map((s) => s.artist))];

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
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = true;
    cb({
      code,
      themes: songData.themes.map((t) => ({ id: t.id, label: t.label, count: t.songs.length })),
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

  socket.on('host:startRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id || !room.theme) return;
    const song = pickSong(room, room.theme);
    if (!song) return;
    room.currentSong = song;
    room.phase = 'question';
    room.pendingAnswers = {};
    const roundMode = resolveRoundMode(room);
    room.currentRoundMode = roundMode;

    const payload = { phrase: song.phrase, mode: roundMode };
    if (roundMode === 'qcm') {
      payload.titleOptions = buildOptions(song.title, allTitles);
      payload.artistOptions = buildOptions(song.artist, allArtists);
    }
    io.to(code).emit('game:phrase', payload);
    io.to(room.hostSocketId).emit('game:answersUpdate', { answers: [] });
    // Réponse attendue envoyée uniquement au maître du jeu, dès le début de la manche,
    // pour qu'il puisse suivre/valider les réponses des joueurs en connaissance de cause.
    io.to(room.hostSocketId).emit('game:answerHint', {
      title: song.title,
      artist: song.artist,
    });
  });

  socket.on('host:reveal', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id || !room.currentSong) return;
    room.phase = 'reveal';
    const song = room.currentSong;
    // L'extrait audio (YouTube start/end) n'est envoyé qu'au maître du jeu,
    // qui le diffuse sur ses propres enceintes.
    io.to(room.hostSocketId).emit('game:revealHost', {
      title: song.title,
      artist: song.artist,
      youtubeId: song.youtubeId,
      start: song.start,
      end: song.end,
    });
    // Les joueurs voient seulement le titre/interprète, pas l'extrait audio.
    socket.to(code).emit('game:revealPlayers', {
      title: song.title,
      artist: song.artist,
    });
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
    const player = room.players[socket.id];
    const answers = Object.entries(room.pendingAnswers).map(([id, a]) => ({
      id,
      name: room.players[id]?.name,
      titleGuess: a.titleGuess,
      artistGuess: a.artistGuess,
    }));
    io.to(room.hostSocketId).emit('game:answersUpdate', { answers });
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