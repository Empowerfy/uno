const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ✅ Serve static client files
app.use(express.static(path.join(__dirname, "../Client")));

let lobbies = [];
let leaderboard = {};
let cardId = 0;

// 🎴 Create deck
function createDeck() {
  const colors = ["red", "green", "blue", "yellow"];
  let deck = [];

  colors.forEach(color => {
    for (let i = 0; i <= 9; i++) {
      deck.push({ id: cardId++, color, value: i, type: "number" });
    }
    deck.push({ id: cardId++, color, type: "skip" });
    deck.push({ id: cardId++, color, type: "reverse" });
    deck.push({ id: cardId++, color, type: "plus2" });
  });

  for (let i = 0; i < 4; i++) {
    deck.push({ id: cardId++, type: "wild" });
    deck.push({ id: cardId++, type: "wild+4" });
  }

  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ✅ UNO rules
function canPlayCard(card, topCard) {
  if (!topCard) return true;

  if (card.type === "wild" || card.type === "wild+4") return true;

  // respect chosen color after wild
  if ((topCard.type === "wild" || topCard.type === "wild+4") && topCard.color) {
    return card.color === topCard.color;
  }

  if (card.color && topCard.color && card.color === topCard.color) return true;
  if (card.type === "number" && topCard.type === "number" && card.value === topCard.value) return true;
  if (card.type !== "number" && card.type === topCard.type) return true;

  return false;
}

function drawCardFromDeck(game) {
  if (game.deck.length === 0) {
    game.deck = shuffle(game.discardPile);
    game.discardPile = [];
  }
  return game.deck.pop();
}

function nextTurn(game) {
  if (game.direction === 1) {
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
  } else {
    game.currentPlayer =
      (game.currentPlayer - 1 + game.players.length) % game.players.length;
  }
}

// ⏳ Turn timer
function startTurnTimer(lobby) {
  if (lobby.turnTimeout) clearTimeout(lobby.turnTimeout);

  lobby.turnTime = 30;

  const tick = () => {
    if (!lobby.started) return;
    lobby.turnTime--;
    if (lobby.turnTime <= 0) {
      const player = lobby.players[lobby.currentPlayer];
      if (player) {
        player.hand.push(drawCardFromDeck(lobby));
      }
      nextTurn(lobby);
      lobby.turnTime = 30;
    }
    broadcastGameState(lobby, lobby);
    lobby.turnTimeout = setTimeout(tick, 1000);
  };

  lobby.turnTimeout = setTimeout(tick, 1000);
}

function playCard(game, player, card, lobby) {
  const idx = player.hand.findIndex(c => c.id === card.id);
  if (idx === -1) return;

  const candidate = player.hand[idx];
  if (!canPlayCard(candidate, game.topCard)) return;

  const playedCard = player.hand.splice(idx, 1)[0];
  game.discardPile.push(playedCard);
  game.topCard = playedCard;

  // Wilds pause for color
  if (playedCard.type === "wild" || playedCard.type === "wild+4") {
    game.awaitingColor = true;
    return;
  }

  // Special effects
  if (playedCard.type === "reverse") {
    game.direction *= -1;
  } else if (playedCard.type === "skip") {
    nextTurn(game);
  } else if (playedCard.type === "plus2") {
    nextTurn(game);
    const nextPlayer = game.players[game.currentPlayer];
    for (let i = 0; i < 2; i++) nextPlayer.hand.push(drawCardFromDeck(game));
  }

  // Win check
  if (player.hand.length === 0) {
    if (!player.isBot) {
      leaderboard[player.nickname] = (leaderboard[player.nickname] || 0) + 1;
    }
    game.winner = player.nickname;
    game.started = false;
    if (lobby.turnTimeout) clearTimeout(lobby.turnTimeout);

    io.emit("globalLeaderboard", leaderboard);
    lobby.players.forEach(p => {
      io.to(p.id).emit("gameOver", { winner: player.nickname });
    });
    return;
  }

  nextTurn(game);
  lobby.turnTime = 30;
  broadcastGameState(lobby, lobby);
}

function createLobby() {
  return {
    id: Date.now(),
    players: [],
    deck: createDeck(),
    discardPile: [],
    topCard: null,
    currentPlayer: 0,
    direction: 1,
    started: false,
    winner: null,
    awaitingColor: false,
    turnTimeout: null,
    turnTime: 30
  };
}

function broadcastGameState(lobbyGame, lobby) {
  lobby.players.forEach(p => {
    const gameForPlayer = {
      id: lobby.id,
      players: lobby.players.map(pl => ({
        nickname: pl.nickname,
        handCount: pl.hand.length
      })),
      hand: p.hand.map(c => ({
        ...c,
        playable:
          !lobbyGame.awaitingColor &&
          lobbyGame.started &&
          p.id === lobbyGame.players[lobbyGame.currentPlayer].id &&
          canPlayCard(c, lobbyGame.topCard)
      })),
      topCard: lobbyGame.topCard,
      currentPlayer: lobbyGame.currentPlayer,
      direction: lobbyGame.direction,
      started: lobbyGame.started,
      winner: lobbyGame.winner,
      leaderboard,
      turnTime: lobby.turnTime
    };
    io.to(p.id).emit("gameState", gameForPlayer);
  });
}

function findLobby() {
  let lobby = lobbies.find(l => !l.started && l.players.length < 4);
  if (!lobby) {
    lobby = createLobby();
    lobbies.push(lobby);
  }
  return lobby;
}

io.on("connection", socket => {
  socket.on("joinGame", ({ nickname }) => {
    const lobby = findLobby();

    const player = { id: socket.id, nickname, hand: [], isBot: false };
    lobby.players.push(player);
    socket.join(lobby.id);

    if (lobby.players.length === 4) {
      lobby.started = true;
      for (const p of lobby.players) {
        for (let i = 0; i < 7; i++) p.hand.push(drawCardFromDeck(lobby));
      }
      lobby.topCard = drawCardFromDeck(lobby);
      lobby.turnTime = 30;
      startTurnTimer(lobby);
    }

    broadcastGameState(lobby, lobby);
  });

  socket.on("playCard", card => {
    const lobby = lobbies.find(l => l.players.some(p => p.id === socket.id));
    if (!lobby || !lobby.started) return;
    const player = lobby.players.find(p => p.id === socket.id);
    if (!player || lobby.players[lobby.currentPlayer].id !== socket.id) return;

    playCard(lobby, player, card, lobby);
  });

  socket.on("chooseColor", color => {
    const lobby = lobbies.find(l => l.players.some(p => p.id === socket.id));
    if (!lobby || !lobby.started) return;

    if (lobby.topCard && (lobby.topCard.type === "wild" || lobby.topCard.type === "wild+4")) {
      lobby.topCard.color = color;
      lobby.awaitingColor = false;

      if (lobby.topCard.type === "wild+4") {
        nextTurn(lobby);
        const nextPlayer = lobby.players[lobby.currentPlayer];
        for (let i = 0; i < 4; i++) nextPlayer.hand.push(drawCardFromDeck(lobby));
      }

      nextTurn(lobby);
      lobby.turnTime = 30;
      broadcastGameState(lobby, lobby);
    }
  });

  socket.on("drawCard", () => {
    const lobby = lobbies.find(l => l.players.some(p => p.id === socket.id));
    if (!lobby || !lobby.started) return;
    const player = lobby.players.find(p => p.id === socket.id);
    if (!player || lobby.players[lobby.currentPlayer].id !== socket.id) return;

    player.hand.push(drawCardFromDeck(lobby));
    nextTurn(lobby);
    lobby.turnTime = 30;

    broadcastGameState(lobby, lobby);
  });

  socket.on("disconnect", () => {
    const lobby = lobbies.find(l => l.players.some(p => p.id === socket.id));
    if (!lobby) return;

    const player = lobby.players.find(p => p.id === socket.id);
    if (player) player.isBot = true;

    broadcastGameState(lobby, lobby);
  });
});

// ✅ Render uses process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
