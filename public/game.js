const A = document.getElementById('app');
const T = document.getElementById('toast');

let token = localStorage.token || null;
let me = null;
let sock = null;
let match = null;
let game = null;
let challengeBox = null;

let canvas = null;
let ctx = null;

let pointerDown = false;
let pointerId = null;

let aim = {
  active: false,
  angle: 0,
  power: 0,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0
};

const TABLE_W = 1.75;
const TABLE_H = 1;
const BALL_R = 0.0255;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Erro na operação.');
  }

  return data;
}

function note(message) {
  if (!T) return;

  T.textContent = message;
  T.classList.add('show');

  clearTimeout(note.timer);

  note.timer = setTimeout(() => {
    T.classList.remove('show');
  }, 3000);
}

/* =========================================================
   LOGIN / CADASTRO
========================================================= */

function login() {
  A.innerHTML = `
    <div class="card login-card">
      <div class="login-logo">🎱</div>

      <h1>Sinuca Arena GK</h1>

      <p>
        <strong>Versão 0.3</strong><br>
        1v1 online • Fichas • Desafios
      </p>

      <input
        id="loginUser"
        class="input"
        placeholder="Usuário"
        autocomplete="username"
      >

      <input
        id="loginPass"
        class="input"
        type="password"
        placeholder="Senha"
        autocomplete="current-password"
      >

      <button class="btn" onclick="doLogin()">
        Entrar
      </button>

      <button class="btn secondary" onclick="registerPage()">
        Criar conta
      </button>
    </div>
  `;
}

function registerPage() {
  A.innerHTML = `
    <div class="card login-card">
      <div class="login-logo">🎱</div>

      <h1>Criar conta</h1>

      <p>
        Crie seu jogador e comece a desafiar.
      </p>

      <input
        id="registerUser"
        class="input"
        placeholder="Escolha seu usuário"
        autocomplete="username"
      >

      <input
        id="registerPass"
        class="input"
        type="password"
        placeholder="Escolha sua senha"
        autocomplete="new-password"
      >

      <button class="btn" onclick="doRegister()">
        Criar conta
      </button>

      <button class="btn secondary" onclick="login()">
        Voltar
      </button>
    </div>
  `;
}

async function doLogin() {
  const username = document.getElementById('loginUser')?.value.trim();
  const password = document.getElementById('loginPass')?.value;

  if (!username || !password) {
    note('Preencha usuário e senha.');
    return;
  }

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    token = data.token;

    localStorage.token = token;

    note('Login realizado.');

    await boot();
  } catch (error) {
    note(error.message);
  }
}

async function doRegister() {
  const username = document.getElementById('registerUser')?.value.trim();
  const password = document.getElementById('registerPass')?.value;

  if (!username || !password) {
    note('Preencha usuário e senha.');
    return;
  }

  if (username.length < 3) {
    note('O usuário precisa ter pelo menos 3 caracteres.');
    return;
  }

  if (password.length < 4) {
    note('A senha precisa ter pelo menos 4 caracteres.');
    return;
  }

  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    token = data.token;

    localStorage.token = token;

    note('Conta criada.');

    await boot();
  } catch (error) {
    note(error.message);
  }
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function boot() {
  if (!token) {
    login();
    return;
  }

  try {
    const data = await api('/api/me');

    me = data.user || data;

    connectSocket();

    home();
  } catch (error) {
    console.error(error);

    token = null;
    localStorage.removeItem('token');

    login();
  }
}

function connectSocket() {
  if (sock) {
    try {
      sock.disconnect();
    } catch (_) {}
  }

  if (typeof io !== 'function') {
    note('Socket.IO não foi carregado.');
    return;
  }

  sock = io({
    auth: {
      token
    }
  });

  sock.on('connect', () => {
    console.log('Socket conectado.');
  });

  sock.on('connect_error', error => {
    console.error('Socket error:', error);
  });

  sock.on('challenge', data => {
    challengeBox = data;

    note('Você recebeu um desafio.');

    if (typeof challenge === 'function') {
      challenge();
    }
  });

  sock.on('wallet', data => {
    if (!me) return;

    if (typeof data.chips === 'number') {
      me.chips = data.chips;
    }

    updateBalance();
  });

  sock.on('matchAccepted', data => {
    if (!data) return;

    startMatch(data.matchId || data.id);
  });

  sock.on('gameState', state => {
    if (!match) return;

    game = normalizeGameState(state);

    renderGame();
  });

  sock.on('turn', data => {
    if (!game) return;

    if (data && data.playerId) {
      game.turn = data.playerId;
    } else if (data) {
      game.turn = data;
    }

    updateGameUI();
  });

  sock.on('gameOver', data => {
    if (data) {
      game = game || {};

      game.over = true;
      game.winner = data.winner || data.winnerId;
    }

    renderGame();

    note(
      data?.winnerName
        ? `🏆 ${data.winnerName} venceu!`
        : '🏆 Partida encerrada.'
    );
  });
}

/* =========================================================
   NAVEGAÇÃO
========================================================= */

function nav() {
  const adminButton = me?.is_admin
    ? `<button class="nav-btn" onclick="admin()">👑 ADM</button>`
    : '';

  return `
    <div class="topbar">
      <div class="brand">
        🎱 <strong>Sinuca Arena GK</strong>
      </div>

      <div class="balance">
        🪙 <span id="balance">${Number(me?.chips || 0)}</span>
      </div>
    </div>

    <div class="nav">
      <button class="nav-btn" onclick="home()">🏠 Lobby</button>
      <button class="nav-btn" onclick="historyPage()">📜 Histórico</button>
      <button class="nav-btn" onclick="invite()">🔗 Divulgar</button>
      ${adminButton}
      <button class="nav-btn danger" onclick="logout()">Sair</button>
    </div>
  `;
}

function updateBalance() {
  const el = document.getElementById('balance');

  if (el) {
    el.textContent = Number(me?.chips || 0);
  }
}

/* =========================================================
   LOBBY
========================================================= */

async function home() {
  try {
    const data = await api('/api/players');

    const players = Array.isArray(data)
      ? data
      : (data.players || []);

    A.innerHTML = `
      ${nav()}

      <div class="card hero">
        <h1>🎱 Desafie seus amigos</h1>

        <p>
          Aposte suas fichas, entre em partidas 1×1
          e mostre quem manda na mesa.
        </p>

        <div class="hero-actions">
          <button class="btn" onclick="challenge()">
            ⚔️ Criar desafio
          </button>

          <button class="btn secondary" onclick="invite()">
            🔗 Divulgar jogo
          </button>
        </div>
      </div>

      <div class="card">
        <h2>👥 Jogadores</h2>

        <div id="players">
          ${
            players.length
              ? players.map(playerCard).join('')
              : `
                <div class="empty">
                  Nenhum jogador encontrado.
                </div>
              `
          }
        </div>
      </div>

      ${
        challengeBox
          ? `
            <div class="card challenge-alert">
              <h2>⚔️ Desafio recebido</h2>

              <p>
                <strong>${esc(challengeBox.fromName || challengeBox.username || 'Jogador')}</strong>
                desafiou você.
              </p>

              <p>
                Aposta:
                <strong>🪙 ${Number(challengeBox.stake || 0)}</strong>
              </p>

              <div class="row">
                <button class="btn" onclick="acceptChallenge()">
                  Aceitar
                </button>

                <button class="btn danger" onclick="rejectChallenge()">
                  Recusar
                </button>
              </div>
            </div>
          `
          : ''
      }
    `;
  } catch (error) {
    A.innerHTML = `
      ${nav()}

      <div class="card">
        <h2>Erro</h2>
        <p>${esc(error.message)}</p>

        <button class="btn" onclick="home()">
          Tentar novamente
        </button>
      </div>
    `;
  }
}

function playerCard(player) {
  const id = player.id || player._id || player.userId;

  if (id === me?.id || id === me?.userId) {
    return `
      <div class="player">
        <div>
          <strong>${esc(player.username || player.name || 'Você')}</strong>
          <small>Você</small>
        </div>

        <div>
          🪙 ${Number(player.chips ?? me?.chips ?? 0)}
        </div>
      </div>
    `;
  }

  return `
    <div class="player">
      <div>
        <strong>${esc(player.username || player.name || 'Jogador')}</strong>

        <small>
          🏆 ${Number(player.wins || 0)}
          &nbsp; • &nbsp;
          ❌ ${Number(player.losses || 0)}
        </small>
      </div>

      <div class="player-actions">
        <span>
          🪙 ${Number(player.chips || 0)}
        </span>

        <button
          class="btn small"
          onclick="challenge('${esc(id)}','${esc(player.username || player.name || '')}')"
        >
          Desafiar
        </button>
      </div>
    </div>
  `;
}

/* =========================================================
   DESAFIO
========================================================= */

function challenge(playerId = '', playerName = '') {
  A.innerHTML = `
    ${nav()}

    <div class="card">
      <h2>⚔️ Criar partida</h2>

      <p>
        Escolha o adversário e o valor da aposta.
      </p>

      ${
        playerId
          ? `
            <div class="selected-player">
              Jogador:
              <strong>${esc(playerName)}</strong>
            </div>
          `
          : ''
      }

      <label>Valor da aposta</label>

      <input
        id="stake"
        class="input"
        type="number"
        min="10"
        value="10"
      >

      ${
        playerId
          ? `
            <button
              class="btn"
              onclick="sendChallenge('${esc(playerId)}')"
            >
              ⚔️ Enviar desafio
            </button>
          `
          : `
            <div class="card mini">
              <p>
                Volte ao lobby e escolha um jogador
                para desafiar.
              </p>
            </div>
          `
      }

      <button class="btn secondary" onclick="home()">
        Voltar
      </button>
    </div>
  `;
}

async function sendChallenge(playerId) {
  const stake = Number(document.getElementById('stake')?.value || 0);

  if (!playerId) {
    note('Jogador inválido.');
    return;
  }

  if (!Number.isFinite(stake) || stake < 10) {
    note('A aposta mínima é 10 fichas.');
    return;
  }

  if (Number(me?.chips || 0) < stake) {
    note('Você não possui fichas suficientes.');
    return;
  }

  try {
    await api('/api/challenge', {
      method: 'POST',
      body: JSON.stringify({
        opponentId: playerId,
        stake
      })
    });

    note('Desafio enviado.');

    home();
  } catch (error) {
    note(error.message);
  }
}

async function acceptChallenge() {
  if (!challengeBox) {
    note('Nenhum desafio disponível.');
    return;
  }

  const id =
    challengeBox.matchId ||
    challengeBox.id ||
    challengeBox.challengeId;

  if (!id) {
    note('Desafio inválido.');
    return;
  }

  try {
    await api(`/api/match/${encodeURIComponent(id)}/accept`, {
      method: 'POST'
    });

    challengeBox = null;

    await startMatch(id);
  } catch (error) {
    note(error.message);
  }
}

function rejectChallenge() {
  challengeBox = null;

  note('Desafio recusado.');

  home();
}

/* =========================================================
   PARTIDA
========================================================= */

async function startMatch(matchId) {
  if (!matchId) {
    note('Partida inválida.');
    return;
  }

  match = {
    id: matchId
  };

  game = null;

  renderGame();

  if (sock) {
    sock.emit('joinMatch', {
      matchId
    });
  }

  try {
    const data = await api(`/api/match/${encodeURIComponent(matchId)}`);

    if (data?.match) {
      match = {
        ...match,
        ...data.match
      };
    } else if (data) {
      match = {
        ...match,
        ...data
      };
    }

    if (data?.game) {
      game = normalizeGameState(data.game);
    }

    renderGame();
  } catch (error) {
    console.warn('Não foi possível carregar partida:', error.message);
  }
}

function normalizeGameState(state) {
  if (!state) {
    return {
      balls: [],
      turn: null,
      moving: false,
      over: false,
      groups: {
        p1: null,
        p2: null
      }
    };
  }

  return {
    ...state,

    balls: Array.isArray(state.balls)
      ? state.balls
      : [],

    moving: Boolean(state.moving),

    over: Boolean(state.over),

    groups: state.groups || {
      p1: null,
      p2: null
    }
  };
}

function renderGame() {
  A.innerHTML = `
    ${nav()}

    <div class="card game-card">
      <div class="game-header">
        <div>
          <strong>🎱 Partida 1×1</strong>

          <div id="gameInfo">
            Carregando mesa...
          </div>
        </div>

        <button class="btn danger small" onclick="leaveMatch()">
          Sair
        </button>
      </div>

      <div class="table-wrap">
        <canvas
          id="poolCanvas"
          width="1050"
          height="600"
        ></canvas>
      </div>

      <div id="gameControls" class="game-controls">
        Arraste para mirar e solte para tacar.
      </div>
    </div>
  `;

  canvas = document.getElementById('poolCanvas');

  if (!canvas) return;

  ctx = canvas.getContext('2d');

  /*
   * ESSENCIAL PARA CELULAR:
   * impede o navegador de interpretar o arraste
   * como rolagem da página.
   */
  canvas.style.touchAction = 'none';

  setupPointerEvents();

  draw();
  updateGameUI();
}

function updateGameUI() {
  const info = document.getElementById('gameInfo');
  const controls = document.getElementById('gameControls');

  if (!info || !controls) return;

  if (!game) {
    info.textContent = 'Aguardando os jogadores...';
    controls.textContent = 'Aguardando a mesa...';
    return;
  }

  const myId =
    me?.id ||
    me?.userId ||
    me?._id;

  const isMyTurn =
    game.turn === myId ||
    game.turn === me?.username ||
    game.turn === me?.name;

  if (game.over) {
    info.innerHTML = `
      <strong>🏆 Partida encerrada</strong>
    `;

    controls.textContent = 'Partida finalizada.';
    return;
  }

  info.innerHTML = `
    ${isMyTurn
      ? '<strong>🟢 Sua vez</strong>'
      : '<strong>🔴 Vez do adversário</strong>'
    }
  `;

  if (game.moving) {
    controls.textContent = '🎱 Bolas em movimento...';
  } else if (isMyTurn) {
    controls.textContent =
      '🎯 Arraste a partir da bola branca e solte para tacar.';
  } else {
    controls.textContent =
      '⏳ Aguarde a jogada do adversário.';
  }
}

function canShoot() {
  if (!game || !me || !match) {
    return false;
  }

  if (game.over) {
    return false;
  }

  if (game.moving) {
    return false;
  }

  const myId =
    me.id ||
    me.userId ||
    me._id;

  return (
    game.turn === myId ||
    game.turn === me.username ||
    game.turn === me.name
  );
}

/* =========================================================
   CONTROLES DE MIRA
========================================================= */

function setupPointerEvents() {
  if (!canvas) return;

  canvas.onpointerdown = event => {
    if (!canShoot()) {
      return;
    }

    event.preventDefault();

    pointerDown = true;
    pointerId = event.pointerId;

    try {
      canvas.setPointerCapture(pointerId);
    } catch (_) {}

    const pos = pointerPosition(event);

    aim.active = true;
    aim.startX = pos.x;
    aim.startY = pos.y;
    aim.currentX = pos.x;
    aim.currentY = pos.y;
    aim.power = 0;

    updateAim(event);

    draw();
  };

  canvas.onpointermove = event => {
    if (!pointerDown) {
      return;
    }

    if (
      pointerId !== null &&
      event.pointerId !== pointerId
    ) {
      return;
    }

    event.preventDefault();

    updateAim(event);
    draw();
  };

  canvas.onpointerup = event => {
    if (!pointerDown) {
      return;
    }

    if (
      pointerId !== null &&
      event.pointerId !== pointerId
    ) {
      return;
    }

    event.preventDefault();

    /*
     * Atualiza a posição final ANTES de disparar.
     * Isso corrige o problema de soltar o dedo/mouse
     * sem registrar corretamente a força.
     */
    updateAim(event);

    pointerDown = false;

    try {
      canvas.releasePointerCapture(pointerId);
    } catch (_) {}

    pointerId = null;

    /*
     * A tacada acontece aqui.
     */
    if (aim.power >= 0.08 && canShoot()) {
      shootNow();
    } else {
      resetAim();
      draw();
    }
  };

  canvas.onpointercancel = event => {
    pointerDown = false;
    pointerId = null;

    resetAim();
    draw();
  };

  canvas.onpointerleave = event => {
    /*
     * NÃO cancela a mira aqui.
     *
     * No celular e no mouse o ponteiro pode sair
     * visualmente da mesa durante o arraste.
     */
  };

  canvas.oncontextmenu = event => {
    event.preventDefault();
  };
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: ((event.clientX - rect.left) / rect.width) * TABLE_W,
    y: ((event.clientY - rect.top) / rect.height) * TABLE_H
  };
}

function updateAim(event) {
  if (!canvas || !game) {
    return;
  }

  const cueBall = getCueBall();

  if (!cueBall) {
    return;
  }

  const pos = pointerPosition(event);

  aim.currentX = pos.x;
  aim.currentY = pos.y;

  /*
   * A direção é da posição atual do dedo/mouse
   * para a bola branca.
   *
   * Isso faz o sistema funcionar como um estilingue:
   * arrasta para trás -> solta -> bola vai para frente.
   */
  const dx = cueBall.x - pos.x;
  const dy = cueBall.y - pos.y;

  aim.angle = Math.atan2(dy, dx);

  const distance = Math.sqrt(
    Math.pow(cueBall.x - pos.x, 2) +
    Math.pow(cueBall.y - pos.y, 2)
  );

  /*
   * Limita a força máxima.
   */
  aim.power = clamp(
    distance / 0.55,
    0,
    1
  );

  aim.active = true;
}

function resetAim() {
  aim.active = false;
  aim.power = 0;
}

function getCueBall() {
  if (!game?.balls) {
    return null;
  }

  return (
    game.balls.find(ball =>
      Number(ball.id) === 0 ||
      ball.id === '0' ||
      ball.number === 0
    ) || null
  );
}

function shootNow() {
  if (!canShoot()) {
    resetAim();
    return;
  }

  if (!sock) {
    note('Conexão com o servidor perdida.');
    return;
  }

  const power = clamp(aim.power, 0.08, 1);

  const shot = {
    matchId: match.id,
    angle: aim.angle,
    power
  };

  /*
   * Marca localmente como em movimento imediatamente.
   * Evita que dois disparos sejam enviados rapidamente.
   */
  game.moving = true;

  sock.emit('shot', shot);

  resetAim();

  updateGameUI();
  draw();
}

/* =========================================================
   DESENHO DA MESA
========================================================= */

function draw() {
  if (!canvas || !ctx) {
    return;
  }

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  drawTable();

  if (game?.balls) {
    for (const ball of game.balls) {
      drawBall(ball);
    }
  }

  drawAim();

  updateGameUI();
}

function drawTable() {
  const w = canvas.width;
  const h = canvas.height;

  const wood = ctx.createLinearGradient(
    0,
    0,
    0,
    h
  );

  wood.addColorStop(0, '#3b2412');
  wood.addColorStop(0.3, '#8b5a2b');
  wood.addColorStop(0.5, '#c08a42');
  wood.addColorStop(0.7, '#70431d');
  wood.addColorStop(1, '#2c190c');

  ctx.fillStyle = wood;

  roundRect(
    ctx,
    10,
    10,
    w - 20,
    h - 20,
    30
  );

  ctx.fill();

  ctx.strokeStyle = '#d6b668';
  ctx.lineWidth = 5;

  roundRect(
    ctx,
    12,
    12,
    w - 24,
    h - 24,
    30
  );

  ctx.stroke();

  const marginX = w * 0.055;
  const marginY = h * 0.09;

  const clothX = marginX;
  const clothY = marginY;
  const clothW = w - marginX * 2;
  const clothH = h - marginY * 2;

  const cloth = ctx.createRadialGradient(
    w / 2,
    h / 2,
    20,
    w / 2,
    h / 2,
    w
  );

  cloth.addColorStop(0, '#11643c');
  cloth.addColorStop(0.55, '#0c5433');
  cloth.addColorStop(1, '#063322');

  ctx.fillStyle = cloth;

  roundRect(
    ctx,
    clothX,
    clothY,
    clothW,
    clothH,
    18
  );

  ctx.fill();

  ctx.strokeStyle = '#1b130a';
  ctx.lineWidth = 7;

  roundRect(
    ctx,
    clothX,
    clothY,
    clothW,
    clothH,
    18
  );

  ctx.stroke();

  /*
   * Brilho do pano.
   */
  const shine = ctx.createLinearGradient(
    0,
    clothY,
    0,
    clothY + clothH
  );

  shine.addColorStop(0, 'rgba(255,255,255,0.07)');
  shine.addColorStop(0.4, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(0,0,0,0.08)');

  ctx.fillStyle = shine;

  roundRect(
    ctx,
    clothX + 5,
    clothY + 5,
    clothW - 10,
    clothH - 10,
    15
  );

  ctx.fill();

  /*
   * Linha central.
   */
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    clothX + clothW / 2,
    clothY + 10
  );

  ctx.lineTo(
    clothX + clothW / 2,
    clothY + clothH - 10
  );

  ctx.stroke();

  /*
   * Marca de saída.
   */
  ctx.beginPath();

  ctx.arc(
    clothX + clothW * 0.25,
    clothY + clothH / 2,
    4,
    0,
    Math.PI * 2
  );

  ctx.fillStyle = '#d6b668';
  ctx.fill();

  /*
   * Marcadores superiores e inferiores.
   */
  for (let i = 1; i < 7; i++) {
    const x =
      clothX +
      (clothW / 7) * i;

    drawMarker(x, clothY - 16);
    drawMarker(x, clothY + clothH + 16);
  }

  /*
   * Logo GK.
   */
  ctx.save();

  ctx.fillStyle = 'rgba(214,182,104,0.22)';
  ctx.font = 'bold 48px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(
    'GK',
    clothX + clothW / 2,
    clothY + clothH / 2
  );

  ctx.restore();

  /*
   * Caçapas.
   */
  for (const pocket of getPocketPositions()) {
    ctx.save();

    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 12;

    ctx.fillStyle = '#030303';

    ctx.beginPath();

    ctx.arc(
      pocket.x,
      pocket.y,
      pocket.r,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();

    ctx.strokeStyle = '#171717';
    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.arc(
      pocket.x,
      pocket.y,
      pocket.r,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  }
}

function drawMarker(x, y) {
  ctx.fillStyle = '#d6b668';

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    3,
    0,
    Math.PI * 2
  );

  ctx.fill();
}

function getPocketPositions() {
  const w = canvas.width;
  const h = canvas.height;

  const marginX = w * 0.055;
  const marginY = h * 0.09;

  const clothX = marginX;
  const clothY = marginY;
  const clothW = w - marginX * 2;
  const clothH = h - marginY * 2;

  const r = Math.min(w, h) * 0.042;

  return [
    {
      x: clothX,
      y: clothY,
      r
    },
    {
      x: clothX + clothW / 2,
      y: clothY - 1,
      r
    },
    {
      x: clothX + clothW,
      y: clothY,
      r
    },
    {
      x: clothX,
      y: clothY + clothH,
      r
    },
    {
      x: clothX + clothW / 2,
      y: clothY + clothH + 1,
      r
    },
    {
      x: clothX + clothW,
      y: clothY + clothH,
      r
    }
  ];
}

/* =========================================================
   BOLAS
========================================================= */

const BALL_COLORS = {
  0: '#ffffff',
  1: '#f4c542',
  2: '#154c9c',
  3: '#c92828',
  4: '#6f299f',
  5: '#ed6c25',
  6: '#198b48',
  7: '#171717',
  8: '#050505',
  9: '#f4c542',
  10: '#154c9c',
  11: '#c92828',
  12: '#6f299f',
  13: '#ed6c25',
  14: '#198b48',
  15: '#171717'
};

function drawBall(ball) {
  if (
    typeof ball.x !== 'number' ||
    typeof ball.y !== 'number'
  ) {
    return;
  }

  const x = ball.x / TABLE_W * canvas.width;
  const y = ball.y / TABLE_H * canvas.height;

  const radius =
    BALL_R / TABLE_W * canvas.width;

  const id =
    Number(ball.id ?? ball.number ?? 0);

  /*
   * Sombra.
   */
  ctx.save();

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';

  ctx.beginPath();

  ctx.ellipse(
    x + radius * 0.35,
    y + radius * 0.45,
    radius * 0.95,
    radius * 0.5,
    0,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.restore();

  /*
   * Bola.
   */
  const baseColor =
    BALL_COLORS[id] || '#ffffff';

  const gradient = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.4,
    radius * 0.05,
    x,
    y,
    radius
  );

  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.16, baseColor);
  gradient.addColorStop(0.72, baseColor);
  gradient.addColorStop(1, '#020202');

  ctx.fillStyle = gradient;

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    radius,
    0,
    Math.PI * 2
  );

  ctx.fill();

  /*
   * Listradas.
   */
  if (id >= 9 && id <= 15) {
    ctx.save();

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.clip();

    ctx.fillStyle = 'rgba(255,255,255,0.88)';

    ctx.fillRect(
      x - radius,
      y - radius * 0.32,
      radius * 2,
      radius * 0.64
    );

    ctx.restore();
  }

  /*
   * Número.
   */
  if (id !== 0) {
    ctx.fillStyle = '#fff';

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      radius * 0.38,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.fillStyle = '#111';

    ctx.font =
      `bold ${Math.max(9, radius * 0.72)}px Arial`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(
      String(id),
      x,
      y + 1
    );
  }

  /*
   * Brilho.
   */
  const shine = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.42,
    0,
    x - radius * 0.35,
    y - radius * 0.42,
    radius * 0.65
  );

  shine.addColorStop(
    0,
    'rgba(255,255,255,0.8)'
  );

  shine.addColorStop(
    0.25,
    'rgba(255,255,255,0.15)'
  );

  shine.addColorStop(
    1,
    'rgba(255,255,255,0)'
  );

  ctx.fillStyle = shine;

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    radius,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;

  ctx.beginPath();

  ctx.arc(
    x,
    y,
    radius,
    0,
    Math.PI * 2
  );

  ctx.stroke();
}

/* =========================================================
   MIRA + TACO
========================================================= */

function drawAim() {
  if (!aim.active || !canShoot()) {
    return;
  }

  const cueBall = getCueBall();

  if (!cueBall) {
    return;
  }

  const x =
    cueBall.x / TABLE_W * canvas.width;

  const y =
    cueBall.y / TABLE_H * canvas.height;

  const maxLength =
    250 + aim.power * 260;

  const endX =
    x + Math.cos(aim.angle) * maxLength;

  const endY =
    y + Math.sin(aim.angle) * maxLength;

  /*
   * Linha de mira.
   */
  ctx.save();

  ctx.setLineDash([10, 8]);

  ctx.strokeStyle =
    'rgba(255,255,255,0.75)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(x, y);

  ctx.lineTo(endX, endY);

  ctx.stroke();

  ctx.restore();

  /*
   * Ponto final.
   */
  ctx.save();

  ctx.strokeStyle =
    'rgba(214,182,104,0.9)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.arc(
    endX,
    endY,
    8,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  ctx.restore();

  /*
   * Taco.
   */
  drawCue(
    x,
    y,
    aim.angle,
    aim.power
  );
}

function drawCue(x, y, angle, power) {
  const maxPull = 120;

  const pull =
    15 + power * maxPull;

  const cueLength = 350;

  const endX =
    x - Math.cos(angle) * (pull + cueLength);

  const endY =
    y - Math.sin(angle) * (pull + cueLength);

  const startX =
    x - Math.cos(angle) * pull;

  const startY =
    y - Math.sin(angle) * pull;

  ctx.save();

  /*
   * Sombra do taco.
   */
  ctx.strokeStyle =
    'rgba(0,0,0,0.55)';

  ctx.lineWidth = 10;
  ctx.lineCap = 'round';

  ctx.beginPath();

  ctx.moveTo(
    startX + 4,
    startY + 4
  );

  ctx.lineTo(
    endX + 4,
    endY + 4
  );

  ctx.stroke();

  /*
   * Corpo do taco.
   */
  const cueGradient = ctx.createLinearGradient(
    startX,
    startY,
    endX,
    endY
  );

  cueGradient.addColorStop(
    0,
    '#f2e3b0'
  );

  cueGradient.addColorStop(
    0.08,
    '#fff'
  );

  cueGradient.addColorStop(
    0.14,
    '#b88b43'
  );

  cueGradient.addColorStop(
    0.75,
    '#6f401b'
  );

  cueGradient.addColorStop(
    1,
    '#1d0f07'
  );

  ctx.strokeStyle = cueGradient;
  ctx.lineWidth = 6;

  ctx.beginPath();

  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);

  ctx.stroke();

  /*
   * Ponta.
   */
  ctx.strokeStyle = '#e8e0d0';
  ctx.lineWidth = 7;

  ctx.beginPath();

  ctx.moveTo(
    startX,
    startY
  );

  ctx.lineTo(
    startX + Math.cos(angle) * 18,
    startY + Math.sin(angle) * 18
  );

  ctx.stroke();

  /*
   * Anel dourado.
   */
  const ringX =
    endX +
    Math.cos(angle) * 55;

  const ringY =
    endY +
    Math.sin(angle) * 55;

  ctx.strokeStyle = '#d6b668';
  ctx.lineWidth = 5;

  ctx.beginPath();

  ctx.moveTo(
    ringX - Math.cos(angle) * 8,
    ringY - Math.sin(angle) * 8
  );

  ctx.lineTo(
    ringX + Math.cos(angle) * 8,
    ringY + Math.sin(angle) * 8
  );

  ctx.stroke();

  ctx.restore();
}

/* =========================================================
   HISTÓRICO
========================================================= */

async function historyPage() {
  try {
    const data = await api('/api/history');

    const history = Array.isArray(data)
      ? data
      : (data.history || []);

    A.innerHTML = `
      ${nav()}

      <div class="card">
        <h2>📜 Histórico</h2>

        ${
          history.length
            ? history.map(historyItem).join('')
            : `
              <div class="empty">
                Nenhuma partida registrada.
              </div>
            `
        }

        <button class="btn secondary" onclick="home()">
          Voltar
        </button>
      </div>
    `;
  } catch (error) {
    A.innerHTML = `
      ${nav()}

      <div class="card">
        <h2>📜 Histórico</h2>

        <p>${esc(error.message)}</p>

        <button class="btn" onclick="historyPage()">
          Tentar novamente
        </button>
      </div>
    `;
  }
}

function historyItem(item) {
  const winner =
    item.winnerName ||
    item.winner ||
    '—';

  const stake =
    Number(item.stake || 0);

  return `
    <div class="history-item">
      <div>
        <strong>
          ${esc(item.opponentName || item.opponent || 'Partida')}
        </strong>

        <small>
          ${esc(item.date || item.createdAt || '')}
        </small>
      </div>

      <div>
        🪙 ${stake}
      </div>

      <div>
        🏆 ${esc(winner)}
      </div>
    </div>
  `;
}

/* =========================================================
   DIVULGAÇÃO
========================================================= */

function invite() {
  const url = window.location.href;

  A.innerHTML = `
    ${nav()}

    <div class="card">
      <h2>🔗 Divulgar Sinuca Arena GK</h2>

      <p>
        Convide seus amigos para jogar e disputar
        fichas em partidas 1×1.
      </p>

      <div class="invite-box">
        ${esc(url)}
      </div>

      <button class="btn" onclick="copyInvite()">
        📋 Copiar link
      </button>

      <button class="btn secondary" onclick="shareInvite()">
        📲 Compartilhar
      </button>

      <button class="btn secondary" onclick="home()">
        Voltar
      </button>
    </div>
  `;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(
      window.location.href
    );

    note('Link copiado.');
  } catch (_) {
    note('Não foi possível copiar automaticamente.');
  }
}

async function shareInvite() {
  const url = window.location.href;

  const text =
    '🎱 Entre na Sinuca Arena GK! ' +
    'Desafie seus amigos em partidas 1×1.';

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Sinuca Arena GK',
        text,
        url
      });

      return;
    } catch (_) {}
  }

  await copyInvite();
}

/* =========================================================
   ADM
========================================================= */

async function admin() {
  if (!me?.is_admin) {
    note('Acesso restrito.');
    return;
  }

  try {
    const data = await api('/api/players');

    const players = Array.isArray(data)
      ? data
      : (data.players || []);

    A.innerHTML = `
      ${nav()}

      <div class="card">
        <h2>👑 Painel ADM</h2>

        <p>
          Libere ou remova fichas dos jogadores.
        </p>

        <div class="admin-list">
          ${
            players.length
              ? players.map(adminPlayer).join('')
              : `
                <div class="empty">
                  Nenhum jogador.
                </div>
              `
          }
        </div>
      </div>
    `;
  } catch (error) {
    note(error.message);
  }
}

function adminPlayer(player) {
  const id =
    player.id ||
    player._id ||
    player.userId;

  return `
    <div class="admin-player">
      <div>
        <strong>
          ${esc(player.username || player.name || 'Jogador')}
        </strong>

        <small>
          🪙 ${Number(player.chips || 0)}
        </small>
      </div>

      <div class="admin-actions">
        <input
          id="chips-${esc(id)}"
          class="input small-input"
          type="number"
          min="1"
          value="100"
        >

        <button
          class="btn small"
          onclick="addChips('${esc(id)}')"
        >
          + Liberar
        </button>

        <button
          class="btn danger small"
          onclick="removeChips('${esc(id)}')"
        >
          - Remover
        </button>
      </div>
    </div>
  `;
}

async function addChips(playerId) {
  const input =
    document.getElementById(`chips-${playerId}`);

  const amount = Number(input?.value || 0);

  if (!amount || amount <= 0) {
    note('Informe uma quantidade válida.');
    return;
  }

  try {
    await api('/api/admin/chips', {
      method: 'POST',
      body: JSON.stringify({
        userId: playerId,
        amount,
        action: 'add'
      })
    });

    note(`${amount} fichas liberadas.`);

    admin();
  } catch (error) {
    note(error.message);
  }
}

async function removeChips(playerId) {
  const input =
    document.getElementById(`chips-${playerId}`);

  const amount = Number(input?.value || 0);

  if (!amount || amount <= 0) {
    note('Informe uma quantidade válida.');
    return;
  }

  try {
    await api('/api/admin/chips', {
      method: 'POST',
      body: JSON.stringify({
        userId: playerId,
        amount,
        action: 'remove'
      })
    });

    note(`${amount} fichas removidas.`);

    admin();
  } catch (error) {
    note(error.message);
  }
}

/* =========================================================
   SAIR DA PARTIDA
========================================================= */

function leaveMatch() {
  if (sock && match) {
    sock.emit('leaveMatch', {
      matchId: match.id
    });
  }

  match = null;
  game = null;
  canvas = null;
  ctx = null;

  resetAim();

  home();
}

/* =========================================================
   LOGOUT
========================================================= */

function logout() {
  try {
    if (sock) {
      sock.disconnect();
    }
  } catch (_) {}

  token = null;
  me = null;
  match = null;
  game = null;
  challengeBox = null;

  localStorage.removeItem('token');

  login();
}

/* =========================================================
   UTILITÁRIOS DE DESENHO
========================================================= */

function roundRect(
  context,
  x,
  y,
  width,
  height,
  radius
) {
  const r = Math.min(
    radius,
    width / 2,
    height / 2
  );

  context.beginPath();

  context.moveTo(x + r, y);

  context.arcTo(
    x + width,
    y,
    x + width,
    y + height,
    r
  );

  context.arcTo(
    x + width,
    y + height,
    x,
    y + height,
    r
  );

  context.arcTo(
    x,
    y + height,
    x,
    y,
    r
  );

  context.arcTo(
    x,
    y,
    x + width,
    y,
    r
  );

  context.closePath();
}

/* =========================================================
   ATUALIZAÇÃO DA TELA QUANDO A JANELA MUDA
========================================================= */

window.addEventListener('resize', () => {
  if (!canvas) return;

  draw();
});

/* =========================================================
   TECLADO
========================================================= */

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (pointerDown) {
      pointerDown = false;
      pointerId = null;

      resetAim();
      draw();
    }
  }
});

/* =========================================================
   INÍCIO
========================================================= */

if (token) {
  boot();
} else {
  login();
}
