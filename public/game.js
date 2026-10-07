const A = document.getElementById('app');
const T = document.getElementById('toast');

let token = localStorage.token || null;
let me = null;
let sock = null;
let match = null;
let game = null;
let pendingChallenge = null;
let challengeBox = null;
let canvas = null;
let ctx = null;

let aim = {
  active: false,
  angle: 0,
  power: 0,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0
};

let pointerDown = false;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const api = async (u, o = {}) => {
  o.headers = {
    ...(o.headers || {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {})
  };

  if (o.body) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }

  const r = await fetch(u, o);
  const d = await r.json();

  if (!r.ok) throw Error(d.error || 'Erro');

  return d;
};

const note = x => {
  T.textContent = x;
  T.style.display = 'block';

  clearTimeout(note.timer);

  note.timer = setTimeout(() => {
    T.style.display = 'none';
  }, 2600);
};


/* =========================
   LOGIN
========================= */

function login() {
  A.innerHTML = `
    <div class="login card">

      <div class="brand-mark">GK</div>

      <h1>
        Sinuca <span class="gold">Arena</span> GK
      </h1>

      <p class="muted">
        Versão 0.3 • 1v1 online
      </p>

      <div class="actions">
        <button class="btn" onclick="loginForm()">
          Entrar
        </button>

        <button class="btn dark" onclick="regForm()">
          Criar conta
        </button>
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

      <input
        class="input"
        id="u"
        placeholder="Usuário"
        autocomplete="username">

      <br><br>

      <input
        class="input"
        id="p"
        type="password"
        placeholder="Senha"
        autocomplete="current-password">

      <br><br>

      <button class="btn full">
        Entrar
      </button>

    </form>
  `;

  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();

    try {
      const d = await api('/api/login', {
        method: 'POST',
        body: {
          username: u.value,
          password: p.value
        }
      });

      token = d.token;
      localStorage.token = token;

      await boot();

    } catch (x) {
      note(x.message);
    }
  };
}

function regForm() {
  const f = document.getElementById('f');

  f.innerHTML = `
    <form>

      <input
        class="input"
        id="n"
        placeholder="Nome">

      <br><br>

      <input
        class="input"
        id="u"
        placeholder="Usuário"
        autocomplete="username">

      <br><br>

      <input
        class="input"
        id="p"
        type="password"
        placeholder="Senha"
        autocomplete="new-password">

      <br><br>

      <button class="btn full">
        Criar conta +100 fichas
      </button>

    </form>
  `;

  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();

    try {
      const d = await api('/api/register', {
        method: 'POST',
        body: {
          displayName: n.value,
          username: u.value,
          password: p.value
        }
      });

      token = d.token;
      localStorage.token = token;

      await boot();

    } catch (x) {
      note(x.message);
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
      auth: { token }
    });

    sock.on('connect_error', err => {
      note(err.message || 'Conexão indisponível.');
    });

    sock.on('challenge', d => {
      if (Number(d.to) !== Number(me.id)) return;

      pendingChallenge = d.matchId;

      showChallenge(d.matchId);
    });

    sock.on('wallet', async () => {
      try {
        me = (await api('/api/me')).user;

        if (!match) {
          home();
        }
      } catch (e) {}
    });

    sock.on('matchAccepted', async d => {
      if (!d?.matchId) return;

      if (match?.id === d.matchId) return;

      note('🎱 Desafio aceito! Preparando a mesa...');

      try {
        await startMatch(d.matchId);
      } catch (e) {
        note(e.message);
      }
    });

    sock.on('gameState', d => {
      if (!match || d.matchId !== match.id) return;

      game = d;

      if (!canvas || !document.getElementById('poolCanvas')) {
        renderGame();
      } else {
        draw();
      }
    });

    sock.on('turn', d => {
      if (!game || !match || d.matchId !== match.id) return;

      game.currentPlayer = d.currentPlayer;
      game.moving = false;

      updateTurnBar();
      updateShotButton();
    });

    sock.on('gameOver', d => {
      if (!match || d.matchId !== match.id) return;

      game = {
        ...game,
        winner: d.winner,
        moving: false
      };

      draw();

      const win = Number(d.winner) === Number(me.id);

      note(
        win
          ? '🏆 Você venceu a partida!'
          : '💥 Você perdeu a partida.'
      );

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
   NAVEGAÇÃO
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
    const d = await api('/api/players');

    A.innerHTML = `
      <div class="wrap">

        ${nav()}

        <div class="hero card">

          <div>

            <div class="eyebrow">
              GK • 1V1 ONLINE
            </div>

            <h1>
              Desafie seus amigos
            </h1>

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
            d.players.map(p => `
              <div class="player-row">

                <div class="player-main">

                  <div class="avatar">
                    ${esc((p.display_name || '?').slice(0, 1).toUpperCase())}
                  </div>

                  <div>

                    <b>
                      ${esc(p.display_name)}
                    </b>

                    <div class="muted small">
                      ${p.wins}V / ${p.losses}D
                      • 🪙 ${p.chips}
                    </div>

                  </div>

                </div>

                <div class="challenge-actions">

                  <input
                    class="input stake-input"
                    id="s${p.id}"
                    type="number"
                    value="10"
                    min="10"
                    step="10">

                  <button
                    class="btn"
                    onclick="challenge(${p.id})">

                    Desafiar

                  </button>

                </div>

              </div>
            `).join('')
            ||
            '<p class="muted">Nenhum outro jogador cadastrado.</p>'
          }

        </div>

      </div>
    `;

  } catch (e) {
    note(e.message);
  }
}


/* =========================
   DESAFIO
========================= */

async function challenge(id) {
  try {
    const input = document.getElementById('s' + id);

    const stake = Number(input?.value || 0);

    if (!Number.isFinite(stake) || stake < 10) {
      note('A aposta mínima é 10 fichas.');
      return;
    }

    await api('/api/challenge', {
      method: 'POST',
      body: {
        opponent: id,
        stake
      }
    });

    note('🎯 Desafio enviado! Aguarde a aceitação.');

  } catch (e) {
    note(e.message);
  }
}

async function showChallenge(matchId) {
  try {
    if (challengeBox) {
      challengeBox.remove();
    }

    const d = await api('/api/match/' + matchId);
    const m = d.match;

    challengeBox = document.createElement('div');

    challengeBox.className = 'challenge-modal';

    challengeBox.innerHTML = `
      <div class="challenge-panel">

        <div class="duel-icon">
          🎱
        </div>

        <div class="eyebrow">
          DESAFIO 1V1
        </div>

        <h2>
          ${esc(m.p1)} te desafiou
        </h2>

        <p class="muted">
          Prepare-se para a partida.
        </p>

        <div class="stake-card">

          <span>Aposta</span>

          <strong>
            🪙 ${m.stake}
          </strong>

          <small>
            Prêmio: ${m.stake * 2} fichas
          </small>

        </div>

        <div class="actions center">

          <button
            class="btn accept-btn"
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

    pendingChallenge = matchId;

  } catch (e) {
    note('Não foi possível carregar o desafio.');
  }
}

async function acceptChallenge(id) {
  try {
    challengeBox?.remove();
    challengeBox = null;

    await api('/api/match/' + id + '/accept', {
      method: 'POST'
    });

    pendingChallenge = null;

    await startMatch(id);

    note('🎱 Partida aceita!');

  } catch (e) {
    note(e.message);
  }
}

async function rejectChallenge(id) {
  challengeBox?.remove();

  challengeBox = null;
  pendingChallenge = null;

  try {
    await api('/api/match/' + id + '/reject', {
      method: 'POST'
    });
  } catch (e) {}

  note('Desafio recusado.');
}


/* =========================
   PARTIDA
========================= */

async function startMatch(id) {
  const d = await api('/api/match/' + id);

  match = d.match;

  const s = await new Promise(resolve => {
    let timer;

    const onState = st => {
      if (st.matchId === id) {
        sock.off('gameState', onState);
        clearTimeout(timer);
        resolve(st);
      }
    };

    sock.on('gameState', onState);

    sock.emit('join', id);

    timer = setTimeout(() => {
      sock.off('gameState', onState);
      resolve(null);
    }, 2500);
  });

  game = s || {
    matchId: id,
    moving: false,
    currentPlayer: Number(match.p1_id || 0),
    winner: null,
    groups: {},
    breakShot: true,
    balls: []
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

          <span>
            ${esc(match?.p1 || 'Jogador 1')}
          </span>

          <b>×</b>

          <span>
            ${esc(match?.p2 || 'Jogador 2')}
          </span>

        </div>

        <div class="stake-pill">
          🪙 ${match?.stake || 0}
        </div>

      </div>

      <div
        class="turn-bar"
        id="turnBar">

        ${turnText()}

      </div>

      <div class="table-shell">

        <canvas
          id="poolCanvas"
          width="1050"
          height="600">
        </canvas>

        <div
          class="touch-help"
          id="touchHelp">

          Arraste a partir da bola branca
          para mirar e puxar a tacada

        </div>

      </div>

      <div class="controls">

        <div class="power-info">

          <span>FORÇA</span>

          <strong id="powerText">
            0%
          </strong>

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

      <div class="game-tip muted">
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
   TEXTO DA VEZ
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
    return '🎯 SUA VEZ — arraste a bola branca para mirar';
  }

  return '⏳ Aguarde a vez do adversário';
}

function updateTurnBar() {
  const el = document.getElementById('turnBar');

  if (el) {
    el.textContent = turnText();
  }
}

function updateShotButton() {
  const b = document.getElementById('shotBtn');

  if (!b) return;

  const myTurn =
    game &&
    Number(game.currentPlayer) === Number(me?.id) &&
    !game.moving &&
    !game.winner;

  b.disabled = !myTurn;
}


/* =========================
   GRUPOS
========================= */

function groupsText() {
  if (!game?.groups) {
    return 'Após definir os grupos, sua meta será limpar suas bolas e depois a bola 8.';
  }

  const p1 = game.groups.p1;
  const p2 = game.groups.p2;

  if (!p1 && !p2) {
    return 'Grupos ainda não definidos.';
  }

  const typeText = t =>
    t === 'solid'
      ? 'Lisas'
      : t === 'stripe'
        ? 'Listradas'
        : 'Indefinido';

  const a = p1
    ? `${esc(playerName(p1.userId))}: ${typeText(p1.type)}`
    : '';

  const b = p2
    ? `${esc(playerName(p2.userId))}: ${typeText(p2.type)}`
    : '';

  return [a, b].filter(Boolean).join(' • ');
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
   CANVAS / MESA
========================= */

const TABLE_W = 1.75;
const TABLE_H = 1;
const BALL_R = 0.0255;

function worldToCanvas(x, y) {
  if (!canvas) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / TABLE_W * canvas.width,
    y: y / TABLE_H * canvas.height
  };
}

function canvasToWorld(x, y) {
  if (!canvas) {
    return { x: 0, y: 0 };
  }

  return {
    x: clamp(x / canvas.width * TABLE_W, 0, TABLE_W),
    y: clamp(y / canvas.height * TABLE_H, 0, TABLE_H)
  };
}

function canvasToScreen(x, y) {
  return worldToCanvas(x, y);
}

function ballScreenRadius() {
  if (!canvas) return 14;

  return BALL_R / TABLE_W * canvas.width;
}


/* =========================
  
