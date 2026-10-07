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

let aim = {
  active: false,
  angle: 0,
  power: 0
};

const TABLE_W = 1.75;
const TABLE_H = 1;
const BALL_R = 0.0255;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    ...(token ? {Authorization:'Bearer '+token} : {})
  };

  if (options.body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro');
  }

  return data;
}

function note(message) {
  if (!T) return;

  T.textContent = message;
  T.style.display = 'block';

  clearTimeout(note.timer);

  note.timer = setTimeout(() => {
    T.style.display = 'none';
  }, 2800);
}


/* =========================
   LOGIN
========================= */

function login() {
  A.innerHTML = `
    <div class="login card">
      <div class="brand-mark">GK</div>

      <h1>Sinuca <span class="gold">Arena</span> GK</h1>

      <p class="muted">Versão 0.3 • 1v1 online</p>

      <div class="actions">
        <button class="btn" onclick="loginForm()">Entrar</button>
        <button class="btn dark" onclick="regForm()">Criar conta</button>
      </div>

      <div id="f"></div>
    </div>
  `;

  loginForm();
}

function loginForm() {
  const f = document.getElementById('f');

  f.innerHTML = `
    <form>
      <input class="input" id="u" placeholder="Usuário" autocomplete="username">
      <br><br>

      <input class="input" id="p" type="password"
        placeholder="Senha" autocomplete="current-password">
      <br><br>

      <button class="btn full">Entrar</button>
    </form>
  `;

  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();

    try {
      const d = await api('/api/login', {
        method:'POST',
        body:{
          username:document.getElementById('u').value,
          password:document.getElementById('p').value
        }
      });

      token = d.token;
      localStorage.token = token;

      await boot();

    } catch (e) {
      note(e.message);
    }
  };
}

function regForm() {
  const f = document.getElementById('f');

  f.innerHTML = `
    <form>
      <input class="input" id="n" placeholder="Nome">
      <br><br>

      <input class="input" id="u" placeholder="Usuário"
        autocomplete="username">
      <br><br>

      <input class="input" id="p" type="password"
        placeholder="Senha" autocomplete="new-password">
      <br><br>

      <button class="btn full">Criar conta +100 fichas</button>
    </form>
  `;

  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();

    try {
      const d = await api('/api/register', {
        method:'POST',
        body:{
          displayName:document.getElementById('n').value,
          username:document.getElementById('u').value,
          password:document.getElementById('p').value
        }
      });

      token = d.token;
      localStorage.token = token;

      await boot();

    } catch (e) {
      note(e.message);
    }
  };
}


/* =========================
   INICIALIZAÇÃO
========================= */

async function boot() {
  try {
    me = (await api('/api/me')).user;

    if (sock) {
      sock.disconnect();
    }

    sock = io({
      auth:{token}
    });

    sock.on('connect_error', err => {
      note(err.message || 'Conexão indisponível.');
    });

    sock.on('challenge', data => {
      if (Number(data.to) !== Number(me.id)) return;
      showChallenge(data.matchId);
    });

    sock.on('wallet', async () => {
      try {
        me = (await api('/api/me')).user;

        if (!match) {
          home();
        }
      } catch (e) {}
    });

    sock.on('matchAccepted', async data => {
      if (!data?.matchId) return;

      if (match?.id === data.matchId) return;

      try {
        await startMatch(data.matchId);
      } catch (e) {
        note(e.message);
      }
    });

    sock.on('gameState', data => {
      if (!match || data.matchId !== match.id) return;

      game = data;

      if (!canvas || !document.getElementById('poolCanvas')) {
        renderGame();
      } else {
        draw();
      }
    });

    sock.on('turn', data => {
      if (!match || !game) return;
      if (data.matchId !== match.id) return;

      game.currentPlayer = data.currentPlayer;
      game.moving = false;

      updateTurn();
      updateShotButton();
    });

    sock.on('gameOver', data => {
      if (!match || data.matchId !== match.id) return;

      game.winner = data.winner;
      game.moving = false;

      draw();

      if (Number(data.winner) === Number(me.id)) {
        note('🏆 Você venceu!');
      } else {
        note('💥 Você perdeu!');
      }

      setTimeout(() => {
        match = null;
        game = null;
        canvas = null;
        ctx = null;
        home();
      }, 4500);
    });

    home();

  } catch (e) {
    localStorage.removeItem('token');
    token = null;
    login();
  }
}


/* =========================
   MENU
========================= */

function nav() {
  return `
    <div class="nav">

      <button class="btn dark" onclick="home()">
        🏠 Lobby
      </button>

      <button class="btn dark" onclick="historyPage()">
        📜 Histórico
      </button>

      <button class="btn dark" onclick="invite()">
        🔗 Divulgar
      </button>

      ${
        me?.is_admin
        ? `
          <button class="btn dark" onclick="admin()">
            👑 ADM
          </button>
        `
        : ''
      }

      <button class="btn dark" onclick="logout()">
        Sair
      </button>

    </div>
  `;
}


/* =========================
   LOBBY
========================= */

async function home() {
  if (match) {
    renderGame();
    return;
  }

  try {
    const data = await api('/api/players');

    A.innerHTML = `
      <div class="wrap">

        ${nav()}

        <div class="hero card">

          <div>
            <div class="eyebrow">GK • 1V1 ONLINE</div>

            <h1>Desafie seus amigos</h1>

            <p class="muted">
              Mesa de sinuca com mira, taco,
              potência e tacada por arrastar.
            </p>
          </div>

          <div class="balance">
            <span>🪙</span>
            <b>${me.chips}</b>
            <small>fichas</small>
          </div>

        </div>

        <div class="card">

          <h2>Jogadores</h2>

          ${
            data.players.length
            ? data.players.map(player => `
              <div class="player-row">

                <div class="player-main">

                  <div class="avatar">
                    ${esc(
                      (player.display_name || '?')
                      .slice(0,1)
                      .toUpperCase()
                    )}
                  </div>

                  <div>
                    <b>${esc(player.display_name)}</b>

                    <div class="muted small">
                      ${player.wins}V / ${player.losses}D
                      • 🪙 ${player.chips}
                    </div>
                  </div>

                </div>

                <div class="challenge-actions">

                  <input
                    class="input stake-input"
                    id="stake-${player.id}"
                    type="number"
                    value="10"
                    min="10"
                    step="10">

                  <button
                    class="btn"
                    onclick="challenge(${player.id})">
                    Desafiar
                  </button>

                </div>

              </div>
            `).join('')
            : '<p class="muted">Nenhum outro jogador cadastrado.</p>'
          }

        </div>

      </div>
    `;

  } catch (e) {
    note(e.message);
  }
}


/* =========================
   DESAFIOS
========================= */

async function challenge(opponent) {
  try {
    const input = document.getElementById('stake-' + opponent);
    const stake = Number(input?.value || 0);

    if (!Number.isFinite(stake) || stake < 10) {
      note('A aposta mínima é 10 fichas.');
      return;
    }

    await api('/api/challenge', {
      method:'POST',
      body:{
        opponent,
        stake
      }
    });

    note('🎯 Desafio enviado!');

  } catch (e) {
    note(e.message);
  }
}

async function showChallenge(matchId) {
  try {
    challengeBox?.remove();

    const data = await api('/api/match/' + matchId);
    const m = data.match;

    challengeBox = document.createElement('div');
    challengeBox.className = 'challenge-modal';

    challengeBox.innerHTML = `
      <div class="challenge-panel">

        <div class="duel-icon">🎱</div>

        <div class="eyebrow">DESAFIO 1V1</div>

        <h2>${esc(m.p1)} te desafiou</h2>

        <p class="muted">
          Prepare-se para a partida.
        </p>

        <div class="stake-card">

          <span>Aposta</span>

          <strong>🪙 ${m.stake}</strong>

          <small>
            Prêmio: ${m.stake * 2} fichas
          </small>

        </div>

        <div class="actions center">

          <button
            class="btn"
            onclick="acceptChallenge('${matchId}')">
            ✅ ACEITAR
          </button>

          <button
            class="btn dark"
            onclick="rejectChallenge('${matchId}')">
            ❌ RECUSAR
          </button>

        </div>

      </div>
    `;

    document.body.appendChild(challengeBox);

  } catch (e) {
    note('Não foi possível carregar o desafio.');
  }
}

async function acceptChallenge(id) {
  try {
    challengeBox?.remove();
    challengeBox = null;

    await api('/api/match/' + id + '/accept', {
      method:'POST'
    });

    await startMatch(id);

    note('🎱 Partida aceita!');

  } catch (e) {
    note(e.message);
  }
}

async function rejectChallenge(id) {
  challengeBox?.remove();
  challengeBox = null;

  try {
    await api('/api/match/' + id + '/reject', {
      method:'POST'
    });
  } catch (e) {}

  note('Desafio recusado.');
}


/* =========================
   INICIAR PARTIDA
========================= */

async function startMatch(id) {
  const data = await api('/api/match/' + id);

  match = data.match;

  const initialState = await new Promise(resolve => {
    let timer;

    const receive = state => {
      if (state.matchId !== id) return;

      sock.off('gameState', receive);
      clearTimeout(timer);

      resolve(state);
    };

    sock.on('gameState', receive);
    sock.emit('join', id);

    timer = setTimeout(() => {
      sock.off('gameState', receive);
      resolve(null);
    }, 3000);
  });

  game = initialState || {
    matchId:id,
    p1:match.p1_id,
    p2:match.p2_id,
    currentPlayer:Number(match.p1_id),
    moving:false,
    winner:null,
    groups:{},
    breakShot:true,
    balls:[]
  };

  renderGame();
}


/* =========================
   MESA
========================= */

function renderGame() {
  A.innerHTML = `
    <div class="game-wrap">

      <div class="game-topbar">

        <button
          class="btn dark mini"
          onclick="leaveMatch()">
          ← Lobby
        </button>

        <div class="duel-names">

          <span>${esc(match?.p1 || 'Jogador 1')}</span>

          <b>×</b>

          <span>${esc(match?.p2 || 'Jogador 2')}</span>

        </div>

        <div class="stake-pill">
          🪙 ${match?.stake || 0}
        </div>

      </div>

      <div class="turn-bar" id="turnBar">
        ${turnText()}
      </div>

      <div class="table-shell">

        <canvas
          id="poolCanvas"
          width="1050"
          height="600">
        </canvas>

        <div class="touch-help">
          Arraste a partir da bola branca
          para mirar e puxar a tacada
        </div>

      </div>

      <div class="controls">

        <div class="power-info">

          <span>FORÇA</span>

          <strong id="powerText">0%</strong>

        </div>

        <div class="power-track">

          <div
            class="power-fill"
            id="powerFill">
          </div>

        </div>

        <button
          class="btn dark"
          onclick="resetAim()">
          ↺ Mira
        </button>

        <button
          class="btn shot-btn"
          id="shotBtn"
          onclick="shootNow()">
          TACADA
        </button>

      </div>

      <div class="game-tip muted" id="groupsText">
        ${groupsText()}
      </div>

    </div>
  `;

  canvas = document.getElementById('poolCanvas');
  ctx = canvas.getContext('2d');

  bindAimControls();
  resetAim();
  draw();
}


/* =========================
   TEXTO
========================= */

function turnText() {
  if (!game) {
    return 'Carregando mesa...';
  }

  if (game.winner) {
    return Number(game.winner) === Number(me.id)
      ? '🏆 Você venceu!'
      : '💥 Você perdeu!';
  }

  if (game.moving) {
    return '🎱 Bolas em movimento...';
  }

  if (Number(game.currentPlayer) === Number(me.id)) {
    return '🎯 SUA VEZ — arraste para mirar';
  }

  return '⏳ Aguarde a vez do adversário';
}

function updateTurn() {
  const element = document.getElementById('turnBar');

  if (element) {
    element.textContent = turnText();
  }
}

function updateShotButton() {
  const button = document.getElementById('shotBtn');

  if (!button) return;

  const allowed =
    game &&
    me &&
    Number(game.currentPlayer) === Number(me.id) &&
    !game.moving &&
    !game.winner;

  button.disabled = !allowed;
}


/* =========================
   GRUPOS
========================= */

function groupsText() {
  if (!game?.groups) {
    return 'Grupos ainda não definidos.';
  }

  const p1 = game.groups.p1;
  const p2 = game.groups.p2;

  if (!p1 && !p2) {
    return 'Grupos ainda não definidos.';
  }

  function typeName(type) {
    if (type === 'solid') return 'Lisas';
    if (type === 'stripe') return 'Listradas';
    return 'Indefinido';
  }

  const result = [];

  if (p1) {
    result.push(
      `${esc(playerName(p1.userId))}: ${typeName(p1.type)}`
    );
  }

  if (p2) {
    result.push(
      `${esc(playerName(p2.userId))}: ${typeName(p2.type)}`
    );
  }

  return result.join(' • ');
}

function playerName(id) {
  if (!match) return 'Jogador';

  if (Number(id) === Number(match.p1_id)) {
    return match.p1;
  }

  if (Number(id) === Number(match.p2_id)) {
    return match.p2;
  }

  return 'Jogador';
}


/* =========================
   COORDENADAS
========================= */

function worldToCanvas(x, y) {
  if (!canvas) {
    return {x:0, y:0};
  }

  return {
    x:(x / TABLE_W) * canvas.width,
    y:(y / TABLE_H) * canvas.height
  };
}

function canvasToWorld(x, y) {
  if (!canvas) {
    return {x:0, y:0};
  }

  return {
    x:clamp((x / canvas.width) * TABLE_W, 0, TABLE_W),
    y:clamp((y / canvas.height) * TABLE_H, 0, TABLE_H)
  };
}

function ballRadius() {
  return BALL_R / TABLE_W * canvas.width;
}


/* =========================
   DESENHO DA MESA
========================= */

function draw() {
  if (!canvas || !ctx || !game) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawTable();

  if (Array.isArray(game.balls)) {
    game.balls.forEach(ball => {
      if (!ball.pocketed) {
        drawBall(ball);
      }
    });
  }

  drawAim();

  updateTurn();
  updateShotButton();

  const groupElement = document.getElementById('groupsText');

  if (groupElement) {
    groupElement.innerHTML = groupsText();
  }

  updatePowerUI();
}

function drawTable() {
  const w = canvas.width;
  const h = canvas.height;

  /* Campo */
  const cloth = ctx.createLinearGradient(0, 0, 0, h);

  cloth.addColorStop(0, '#0d7a50');
  cloth.addColorStop(.5, '#075e3e');
  cloth.addColorStop(1, '#06472f');

  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, w, h);

  /* Borda */
  ctx.strokeStyle = '#c9a957';
  ctx.lineWidth = 12;

  ctx.strokeRect(
    6,
    6,
    w - 12,
    h - 12
  );

  /* Bolsas */
  const pockets = [
    [0,0],
    [w/2,0],
    [w,0],
    [0,h],
    [w/2,h],
    [w,h]
  ];

  pockets.forEach(([x,y]) => {
    ctx.beginPath();
    ctx.fillStyle = '#020202';

    ctx.arc(
      x,
      y,
      Math.max(20, w * .027),
      0,
      Math.PI * 2
    );

    ctx.fill();
  });

  /* Linha central */
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(w/2, 15);
  ctx.lineTo(w/2, h-15);
  ctx.stroke();

  /* Marca */
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.arc(
    w * .72,
    h/2,
    4,
    0,
    Math.PI * 2
  );
  ctx.fill();
}


/* =========================
   BOLAS
========================= */

function ballColor(id) {
  const colors = {
    0:'#ffffff',
    1:'#f4d21f',
    2:'#164de8',
    3:'#d92828',
    4:'#7136bd',
    5:'#ed791c',
    6:'#16833d',
    7:'#741b20',
    8:'#050505',
    9:'#f4d21f',
    10:'#164de8',
    11:'#d92828',
    12:'#7136bd',
    13:'#ed791c',
    14:'#16833d',
    15:'#741b20'
  };

  return colors[id] || '#ddd';
}

function drawBall(ball) {
  const p = worldToCanvas(ball.x, ball.y);
  const r = ballRadius();

  ctx.save();

  /* sombra */
  ctx.beginPath();

  ctx.fillStyle = 'rgba(0,0,0,.35)';

  ctx.arc(
    p.x + 3,
    p.y + 4,
    r,
    0,
    Math.PI * 2
  );

  ctx.fill();

  /* bola */
  ctx.beginPath();

  ctx.arc(
    p.x,
    p.y,
    r,
    0,
    Math.PI * 2
  );

  const gradient = ctx.createRadialGradient(
    p.x - r*.35,
    p.y - r*.4,
    r*.1,
    p.x,
    p.y,
    r
  );

  const color = ballColor(ball.id);

  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(.18, color);
  gradient.addColorStop(1, color);

  ctx.fillStyle = gradient;
  ctx.fill();

  /* Listradas */
  if (ball.id >= 9 && ball.id <= 15) {
    ctx.save();

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      r*.75,
      0,
      Math.PI*2
    );

    ctx.clip();

    ctx.fillStyle = '#fff';

    ctx.fillRect(
      p.x-r,
      p.y-r*.22,
      r*2,
      r*.44
    );

    ctx.restore();
  }

  /* Número */
  if (ball.id !== 0) {
    ctx.fillStyle = '#fff';

    ctx.font =
      `bold ${Math.max(8,r*.62)}px Arial`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(
      String(ball.id),
      p.x,
      p.y
    );
  }

  ctx.restore();
}


/* =========================
   MIRA E TACO
========================= */

function drawAim() {
  if (!game || !canvas) return;

  const cue = game.balls?.find(
    b => Number(b.id) === 0
  );

  if (!cue || cue.pocketed) return;

  if (
    !me ||
    Number(game.currentPlayer) !== Number(me.id) ||
    game.moving ||
    game.winner
  ) {
    return;
  }

  const cp = worldToCanvas(
    cue.x,
    cue.y
  );

  const r = ballRadius();

  const angle = aim.angle;

  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const lineLength =
    260 + aim.power * 180;

  /* linha de mira */
  ctx.save();

  ctx.setLineDash([8,8]);

  ctx.strokeStyle =
    'rgba(255,255,255,.70)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    cp.x,
    cp.y
  );

  ctx.lineTo(
    cp.x + dx*lineLength,
    cp.y + dy*lineLength
  );

  ctx.stroke();

  ctx.setLineDash([]);

  /* taco */
  const back =
    60 + aim.power*150;

  const backX =
    cp.x - dx*(r+back);

  const backY =
    cp.y - dy*(r+back);

  const frontX =
    cp.x - dx*r;

  const frontY =
    cp.y - dy*r;

  ctx.strokeStyle = '#d7b86b';
  ctx.lineWidth = Math.max(5,r*.30);

  ctx.beginPath();

  ctx.moveTo(
    backX,
    backY
  );

  ctx.lineTo(
    frontX,
    frontY
  );

  ctx.stroke();

  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    frontX,
    frontY
  );

  ctx.lineTo(
    cp.x-dx*r*.1,
    cp.y-dy*r*.1
  );

  ctx.stroke();

  ctx.restore();
}


/* =========================
   CONTROLES
========================= */

function canShoot() {
  return !!(
    game &&
    me &&
    !game.moving &&
    !game.winner &&
    Number(game.currentPlayer) === Number(me.id)
  );
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      canvas.width /
      rect.width,

    y:
      (event.clientY - rect.top) *
      canvas.height /
      rect.height
  };
}

function updateAim(event) {
  const cue = game?.balls?.find(
    b => Number(b.id) === 0
  );

  if (!cue) return;

  const p = pointerPosition(event);

  const cp = worldToCanvas(
    cue.x,
    cue.y
  );

  const dx = cp.x - p.x;
  const dy = cp.y - p.y;

  const distance = Math.hypot(dx,dy);

  if (distance < 3) return;

  aim.angle = Math.atan2(dy,dx);

  aim.power =
    clamp(distance / 280, .08, 1);

  updatePowerUI();
}

function bindAimControls() {
  if (!canvas) return;

  canvas.onpointerdown = event => {
    if (!canShoot()) return;

    pointerDown = true;

    canvas.setPointerCapture?.(
      event.pointerId
    );

    updateAim(event);
    draw();
  };

  canvas.onpointermove = event => {
    if (!pointerDown) return;

    updateAim(event);
    draw();
  };

  canvas.onpointerup = event => {
    if (!pointerDown) return;

    pointerDown = false;

    updateAim(event);
    draw();
  };

  canvas.onpointercancel = () => {
    pointerDown = false;
  };
}

function resetAim() {
  aim.active = false;
  aim.power = 0;
  aim.angle = 0;

  updatePowerUI();

  if (canvas) {
    draw();
  }
}

function updatePowerUI() {
  const text =
    document.getElementById('powerText');

  const fill =
    document.getElementById('powerFill');

  const percent =
    Math.round(
      clamp(aim.power,0,1)*100
    );

  if (text) {
    text.textContent =
      percent + '%';
  }

  if (fill) {
    fill.style.width =
      percent + '%';
  }
}


/* =========================
   TACADA
========================= */

function shootNow() {
  if (!canShoot()) {
    note('⏳ Aguarde a sua vez.');
    return;
  }

  if (!sock) {
    note('Conexão indisponível.');
    return;
  }

  if (aim.power < .08) {
    note('Puxe a mira para aumentar a força.');
    return;
  }

  sock.emit('shot', {
    matchId:match.id,
    angle:aim.angle,
    power:clamp(aim.power,.08,1)
  });

  aim.power = 0;

  updatePowerUI();
}


/* =========================
   SAIR
========================= */

function leaveMatch() {
  if (game?.moving) {
    note('Aguarde as bolas pararem.');
    return;
  }

  match = null;
  game = null;
  canvas = null;
  ctx = null;

  home();
}


/* =========================
   HISTÓRICO
========================= */

async function historyPage() {
  try {
    const data =
      await api('/api/history');

    A.innerHTML = `
      <div class="wrap">

        ${nav()}

        <div class="card">

          <h2>📜 Histórico</h2>

          ${
            data.matches?.length
            ? data.matches.map(m => `
              <div class="row">

                <div>
                  <b>
                    ${esc(m.p1_name)}
                    ×
                    ${esc(m.p2_name)}
                  </b>

                  <div class="muted small">
                    Aposta: 🪙 ${m.stake}
                  </div>
                </div>

                <div class="gold">
                  ${esc(m.status)}
                </div>

              </div>
            `).join('')
            : '<p class="muted">Nenhuma partida registrada.</p>'
          }

        </div>

        <div class="card">

          <h2>💰 Movimentações</h2>

          ${
            data.transactions?.length
            ? data.transactions.map(t => `
              <div class="row">

                <div>
                  <b>${esc(t.description)}</b>

                  <div class="muted small">
                    ${esc(t.created_at)}
                  </div>
                </div>

                <strong class="gold">
                  ${
                    Number(t.amount) >= 0
                    ? '+'
                    : ''
                  }${t.amount}
                </strong>

              </div>
            `).join('')
            : '<p class="muted">Nenhuma movimentação.</p>'
          }

        </div>

      </div>
    `;

  } catch (e) {
    note(e.message);
  }
}


/* =========================
   DIVULGAR
========================= */

function invite() {
  const link = location.origin;

  A.innerHTML = `
    <div class="wrap">

      ${nav()}

      <div class="card">

        <div class="eyebrow">
          COMPARTILHE
        </div>

        <h2>🔗 Convide seus amigos</h2>

        <p class="muted">
          Envie este link para jogar Sinuca Arena GK.
        </p>

        <div class="share-link">
          ${esc(link)}
        </div>

        <div class="actions">

          <button
            class="btn"
            onclick="copyInvite()">
            📋 Copiar link
          </button>

          <button
            class="btn dark"
            onclick="shareInvite()">
            📤 Compartilhar
          </button>

        </div>

      </div>

    </div>
  `;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(
      location.origin
    );

    note('✅ Link copiado!');
  } catch (e) {
    note('Não foi possível copiar.');
  }
}

async function shareInvite() {
  try {
    if (navigator.share) {
      await navigator.share({
        title:'Sinuca Arena GK',
        text:'🎱 Venha jogar Sinuca Arena GK comigo!',
        url:location.origin
      });
    } else {
      await copyInvite();
    }
  } catch (e) {}
}


/* =========================
   ADMIN
========================= */

async function admin() {
  try {
    if (!me?.is_admin) {
      note('Acesso exclusivo do ADM.');
      return;
    }

    const data =
      await api('/api/admin/users');

    A.innerHTML = `
      <div class="wrap">

        ${nav()}

        <div class="card">

          <div class="eyebrow">
            ADMINISTRAÇÃO
          </div>

          <h2>👑 Gerenciar fichas</h2>

          ${
            data.users.map(user => `
              <div class="player-row">

                <div class="player-main">

                  <div class="avatar">
                    ${esc(
                      (user.display_name || '?')
                      .slice(0,1)
                      .toUpperCase()
                    )}
                  </div>

                  <div>

                    <b>
                      ${esc(user.display_name)}
                    </b>

                    <div class="muted small">
                      @${esc(user.username)}
                      • 🪙 ${user.chips}
                    </div>

                  </div>

                </div>

                <div class="admin-actions">

                  <input
                    class="input stake-input"
                    id="adm-${user.id}"
                    type="number"
                    min="1"
                    value="100">

                  <button
                    class="btn mini"
                    onclick="adminChip(${user.id},'add')">
                    + Fichas
                  </button>

                  <button
                    class="btn dark mini"
                    onclick="adminChip(${user.id},'remove')">
                    − Fichas
                  </button>

                </div>

              </div>
            `).join('')
          }

        </div>

      </div>
    `;

  } catch (e) {
    note(e.message);
  }
}

async function adminChip(userId, action) {
  try {
    const input =
      document.getElementById(
        'adm-' + userId
      );

    const amount =
      Number(input?.value || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      note('Digite uma quantidade válida.');
      return;
    }

    await api('/api/admin/chips', {
      method:'POST',
      body:{
        userId,
        amount,
        action
      }
    });

    note(
      action === 'add'
      ? '🪙 Fichas liberadas!'
      : '🪙 Fichas retiradas!'
    );

    await admin();

  } catch (e) {
    note(e.message);
  }
}


/* =========================
   LOGOUT
========================= */

function logout() {
  if (sock) {
    sock.disconnect();
    sock = null;
  }

  token = null;
  me = null;
  match = null;
  game = null;
  canvas = null;
  ctx = null;

  localStorage.removeItem('token');

  login();
}


/* =========================
   INICIAR APLICAÇÃO
========================= */

if (token) {
  boot();
} else {
  login();
}
