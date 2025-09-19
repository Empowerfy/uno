// 🔗 Connect to deployed backend on Render
const socket = io("https://uno-official.onrender.com", {
  transports: ["websocket", "polling"]
});

// Elements
const statusDiv = document.getElementById("status");
const waitingDiv = document.getElementById("waiting");
const playersDiv = document.getElementById("players");
const handDiv = document.getElementById("hand");
const topCardDiv = document.getElementById("top-card");
const drawBtn = document.getElementById("drawBtn");
const timerDiv = document.getElementById("timer");
const timerFill = document.getElementById("timer-fill");
const joinBtn = document.getElementById("joinBtn");
const nicknameInput = document.getElementById("nicknameInput");
const wildModal = document.getElementById("wildModal");
const colorBtns = document.querySelectorAll(".color-btn");
const leaderboardDiv = document.getElementById("leaderboard");
const bgMusic = document.getElementById("bg-music");
const connectWalletBtn = document.getElementById("connectWalletBtn");
const walletDisplay = document.getElementById("walletDisplay");

// 🎵 Sounds
const cardSound = new Audio("card.mp3");

// Timer
let countdownInterval = null;

// ✅ Auto-fill nickname if wallet is already connected
window.addEventListener("load", () => {
  const wallet = localStorage.getItem("unoWallet");
  if (wallet) {
    nicknameInput.value = wallet.slice(0, 4) + "..." + wallet.slice(-4);
    walletDisplay.textContent = `✅ ${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  }
});

// ✅ Handle wallet connection
connectWalletBtn.addEventListener("click", async () => {
  if (window.solana && window.solana.isPhantom) {
    try {
      const resp = await window.solana.connect();
      const wallet = resp.publicKey.toString();
      localStorage.setItem("unoWallet", wallet);

      // Show wallet on page
      walletDisplay.textContent = `✅ ${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
      walletDisplay.style.fontWeight = "bold";

      // Auto-fill nickname if empty
      if (!nicknameInput.value.trim()) {
        nicknameInput.value = wallet.slice(0, 4) + "..." + wallet.slice(-4);
      }
    } catch (err) {
      console.error("Wallet connection failed", err);
    }
  } else {
    alert("⚠️ Phantom Wallet not found. Please install it.");
    window.open("https://phantom.app/", "_blank");
  }
});

// ✅ Join game
joinBtn.addEventListener("click", () => {
  let nickname = nicknameInput.value.trim() || "Anon";
  const wallet = localStorage.getItem("unoWallet");

  if (wallet) {
    nickname = `${nickname} (${wallet.slice(0, 4)}...${wallet.slice(-4)})`;
  }

  socket.emit("joinGame", { nickname });

  joinBtn.disabled = true;
  nicknameInput.disabled = true;
  connectWalletBtn.disabled = true;

  bgMusic.loop = true;
  bgMusic.play().catch(() => {});
});

// ✅ Draw card
drawBtn.addEventListener("click", () => {
  socket.emit("drawCard");
  cardSound.play().catch(() => {});
});

// ✅ Wild card color selection
colorBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const color = btn.getAttribute("data-color");
    socket.emit("chooseColor", color);
    wildModal.style.display = "none";
  });
});

// ✅ Game state update
socket.on("gameState", game => {
  renderStatus(game);
  renderPlayers(game);
  renderTopCard(game);
  renderHand(game);
  renderLeaderboard(game);
  renderTimer(game);
});

// ✅ Game Over
socket.on("gameOver", data => {
  alert(`🎉 ${data.winner} won this round!`);

  let countdown = 3;
  const overlay = document.getElementById("nextGameOverlay");
  const message = document.getElementById("nextGameMessage");
  const leaveBtn = document.getElementById("leaveBtn");

  overlay.style.display = "flex";
  message.textContent = `Next game starting in ${countdown}...`;

  const interval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      message.textContent = `Next game starting in ${countdown}...`;
    } else {
      clearInterval(interval);
      overlay.style.display = "none";
    }
  }, 1000);

  leaveBtn.onclick = () => {
    overlay.style.display = "none";
    clearInterval(interval);
    socket.disconnect();
    alert("👋 You left the game. Refresh the page to rejoin.");
  };
});

// ✅ Global leaderboard updates
socket.on("globalLeaderboard", data => {
  renderLeaderboard({ leaderboard: data });
});

// =====================
// Rendering functions
// =====================
function renderStatus(game) {
  if (!game.started) {
    statusDiv.textContent = `Game will start once 4 players join (${game.players.length}/4 joined)`;
    if (game.waitingCount !== undefined) {
      waitingDiv.textContent = `👥 Total waiting players: ${game.waitingCount}`;
    }
  } else {
    statusDiv.textContent = `Game in progress - Turn: ${game.players[game.currentPlayer].nickname}`;
    waitingDiv.textContent = "";
  }
}

function renderPlayers(game) {
  playersDiv.innerHTML = "";
  game.players.forEach((p, i) => {
    const div = document.createElement("div");
    div.classList.add("player-info");
    if (i === game.currentPlayer) div.classList.add("current-turn");
    if (p.handCount === 1) div.classList.add("uno-warning");
    div.textContent = `${p.nickname} (${p.handCount})`;
    playersDiv.appendChild(div);
  });
}

function renderTopCard(game) {
  topCardDiv.innerHTML = "";
  if (!game.topCard) return;
  const cardEl = createCardElement(game.topCard, true);
  cardEl.classList.add("top-card");
  topCardDiv.appendChild(cardEl);
}

function renderHand(game) {
  handDiv.innerHTML = "";
  let hasPlayable = false;

  game.hand.forEach(card => {
    const cardEl = createCardElement(card, false);

    if (card.playable) {
      hasPlayable = true;
      cardEl.classList.add("playable");
      cardEl.addEventListener("click", () => {
        if (card.type === "wild" || card.type === "wild+4") {
          wildModal.style.display = "flex";
          socket.emit("playCard", card);
        } else {
          socket.emit("playCard", card);
        }
        cardSound.play().catch(() => {});
      });
    } else {
      cardEl.classList.add("disabled");
    }

    handDiv.appendChild(cardEl);
  });

  if (!game.started) {
    drawBtn.disabled = true;
    drawBtn.classList.remove("highlight");
  } else {
    const wallet = localStorage.getItem("unoWallet");
    const myNickname = wallet
      ? (nicknameInput.value.trim() || "Anon") + ` (${wallet.slice(0, 4)}...${wallet.slice(-4)})`
      : nicknameInput.value.trim() || "Anon";

    const myTurn = game.players[game.currentPlayer].nickname.startsWith(myNickname);

    if (myTurn && !hasPlayable) {
      drawBtn.disabled = false;
      drawBtn.classList.add("highlight");
    } else {
      drawBtn.disabled = true;
      drawBtn.classList.remove("highlight");
    }
  }
}

function renderLeaderboard(game) {
  leaderboardDiv.innerHTML = "<h2>🌍 Global Leaderboard</h2>";
  if (game.leaderboard) {
    Object.entries(game.leaderboard)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, wins]) => {
        const div = document.createElement("div");
        div.textContent = `${name}: ${wins} wins`;
        leaderboardDiv.appendChild(div);
      });
  }
}

function renderTimer(game) {
  clearInterval(countdownInterval);
  if (game.turnTime !== undefined) {
    let timeLeft = game.turnTime;
    timerDiv.style.display = "block";
    timerFill.parentElement.style.display = "block";
    timerDiv.textContent = `⏳ ${timeLeft}s`;
    timerFill.style.width = `${(timeLeft / 30) * 100}%`;

    countdownInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft >= 0) {
        timerDiv.textContent = `⏳ ${timeLeft}s`;
        timerFill.style.width = `${(timeLeft / 30) * 100}%`;
        if (timeLeft <= 5) {
          timerFill.classList.add("warning");
        } else {
          timerFill.classList.remove("warning");
        }
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);
  } else {
    timerDiv.textContent = "";
    timerFill.parentElement.style.display = "none";
  }
}

// =====================
// Card rendering
// =====================
function createCardElement(card, isTop = false) {
  const div = document.createElement("div");
  div.classList.add("card");
  if (card.color) div.classList.add(card.color);

  let bgImg = "";
  if (card.type === "number") {
    const val = card.value !== undefined ? card.value : "?";
    const numEl = document.createElement("span");
    numEl.textContent = val;
    numEl.style.fontSize = "3rem";
    numEl.style.fontWeight = "bold";
    numEl.style.color = "white";
    numEl.style.textShadow = "0 0 5px black, 0 0 10px black";
    div.appendChild(numEl);
  } else if (card.type === "skip") {
    bgImg = "skip.png";
  } else if (card.type === "reverse") {
    bgImg = "reverse.png";
  } else if (card.type === "plus2") {
    const text = document.createElement("span");
    text.textContent = "+2";
    text.style.fontSize = "2.5rem";
    text.style.fontWeight = "bold";
    div.appendChild(text);
  } else if (["plus4", "wild+4", "wild"].includes(card.type)) {
    bgImg = "wildcard.png";
  }

  if (bgImg) {
    div.style.backgroundImage = `url(${bgImg})`;
    div.style.backgroundSize = "cover";
    div.style.backgroundRepeat = "no-repeat";
    div.style.backgroundPosition = "center";
  }

  return div;
}
