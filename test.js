const { io } = require('socket.io-client');

const host = io('http://localhost:3000');
const player = io('http://localhost:3000');

let roomCode;

host.on('connect', () => {
  host.emit('host:create', (res) => {
    roomCode = res.code;
    console.log('Code de partie:', roomCode, 'Thèmes:', res.themes.map(t=>t.id));
    player.emit('player:join', { code: roomCode, name: 'Cédric' }, (r) => {
      console.log('Join joueur:', r);
      host.emit('host:selectTheme', { code: roomCode, themeId: 'variete-fr' });
    });
  });
});

host.on('game:themeSelected', (data) => {
  console.log('Thème sélectionné:', data);
  host.emit('host:startRound', { code: roomCode });
});

host.on('game:phrase', (data) => {
  console.log('[HOST] Phrase reçue:', data);
});

player.on('game:phrase', (data) => {
  console.log('[PLAYER] Phrase reçue:', data.phrase);
  player.emit('player:submitAnswer', { code: roomCode, titleGuess: 'Test titre', artistGuess: 'Test artiste' });
});

host.on('game:answersUpdate', (data) => {
  console.log('[HOST] Réponses:', data.answers);
  if (data.answers.length > 0) {
    const a = data.answers[0];
    host.emit('host:validateAnswer', { code: roomCode, playerId: a.id, titleCorrect: true, artistCorrect: false });
    setTimeout(() => host.emit('host:reveal', { code: roomCode }), 200);
  }
});

host.on('game:revealHost', (data) => {
  console.log('[HOST] Reveal:', data);
});
player.on('game:revealPlayers', (data) => {
  console.log('[PLAYER] Reveal:', data);
});

host.on('game:scoreboard', (data) => {
  console.log('Scoreboard:', data.players);
  if (data.players.some(p => p.score > 0)) {
    setTimeout(() => process.exit(0), 300);
  }
});

setTimeout(() => { console.log('TIMEOUT - test incomplet'); process.exit(1); }, 5000);
