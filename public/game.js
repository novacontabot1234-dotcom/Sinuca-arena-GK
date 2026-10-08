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
  power: 0
};

const TABLE_W = 1.75;
const TABLE_H = 1;
const BALL_R = 0.0255;

const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));

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
    ...(token ? { Authorization:'Bearer ' + token } : {})
  };

  if (options.body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, options);

  let data = {};

  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    throw new Error(data.error || 'Erro na comunicação com o servidor.');
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


/* =========================================================
   LOGIN
========================================================= */

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


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function boot() {
  try {

    me = (await api('/api/me')).user;

    if (!me) {
      throw new Error('Usuário não carregado.');
    }

    if (sock) {
      sock.disconnect();
    }

    sock = io({
      auth:{ token }
    });

    sock.on('connect_error', err => {
      note(err.message || 'Conexão indisponível.');
    });

    sock.on('challenge', data => {

      if (Number(data.to) !== Number(me.id)) {
        return;
      }

      showChallenge(data.matchId);
    });

    sock.on('wallet', async () => {

      try {

        me = (await api('/api/me')).user;

        if (!match) {
          home();
        }

      } catch (_) {}
    });

    sock.on('matchAccepted', async data => {

      if (!data?.matchId) {
        return;
      }

      if (match?.id === data.matchId) {
        return;
      }

      try {
        await startMatch(data.matchId);
      } catch (e) {
        note(e.message);
      }
    });

    sock.on('gameState', data => {

      if (!match) {
        return;
      }

      if (data.matchId !== match.id) {
        return;
      }

      game = data;

      if (
        !canvas ||
        !document.getElementById('poolCanvas')
      ) {
        renderGame();
      } else {
        draw();
      }
    });

    sock.on('turn', data => {

      if (!match || !game) {
        return;
      }

      if (data.matchId !== match.id) {
        return;
      }

      game.currentPlayer =
        data.currentPlayer;

      game.moving = false;

      aim.power = 0;
      aim.active = false;

      updateTurn();
      updateShotButton();
      updatePowerUI();
      draw();
    });

    sock.on('gameOver', data => {

      if (!match) {
        return;
      }

      if (data.matchId !== match.id) {
        return;
      }

      game.winner = data.winner;
      game.moving = false;

      draw();

      if (
        Number(data.winner) ===
        Number(me.id)
      ) {
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
    me = null;

    login();
  }
}


/* =========================================================
   MENU
========================================================= */

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
          <button
            class="btn dark"
            onclick="admin()">
            👑 ADM
          </button>
        `
        : ''
      }

      <button
        class="btn dark"
        onclick="logout()">
        Sair
      </button>

    </div>
  `;
}


/* =========================================================
   LOBBY
========================================================= */

async function home() {

  if (!me) {
    login();
    return;
  }

  if (match) {
    renderGame();
    return;
  }

  try {

    const data =
      await api('/api/players');

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
              Mire, controle a força
              e faça sua tacada.
            </p>

          </div>

          <div class="balance">

            <span>🪙</span>

            <b>
              ${me?.chips ?? 0}
            </b>

            <small>
              fichas
            </small>

          </div>

        </div>

        <div class="card">

          <h2>
            Jogadores
          </h2>

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

                    <b>
                      ${esc(player.display_name)}
                    </b>

                    <div class="muted small">
                      ${player.wins}V /
                      ${player.losses}D
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

            : `
              <p class="muted">
                Nenhum outro jogador cadastrado.
              </p>
            `
          }

        </div>

      </div>
    `;

  } catch (e) {
    note(e.message);
  }
}


/* =========================================================
   DESAFIOS
========================================================= */

async function challenge(opponent) {

  try {

    const input =
      document.getElementById(
        'stake-' + opponent
      );

    const stake =
      Number(input?.value || 0);

    if (
      !Number.isFinite(stake) ||
      stake < 10
    ) {
      note(
        'A aposta mínima é 10 fichas.'
      );
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

    const data =
      await api('/api/match/' + matchId);

    const m = data.match;

    challengeBox =
      document.createElement('div');

    challengeBox.className =
      'challenge-modal';

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

          <span>
            Aposta
          </span>

          <strong>
            🪙 ${m.stake}
          </strong>

          <small>
            Prêmio:
            ${m.stake * 2} fichas
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

    document.body.appendChild(
      challengeBox
    );

  } catch (e) {

    note(
      'Não foi possível carregar o desafio.'
    );
  }
}

async function acceptChallenge(id) {

  try {

    challengeBox?.remove();
    challengeBox = null;

    await api(
      '/api/match/' + id + '/accept',
      {
        method:'POST'
      }
    );

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

    await api(
      '/api/match/' + id + '/reject',
      {
        method:'POST'
      }
    );

  } catch (_) {}

  note('Desafio recusado.');
}


/* =========================================================
   INICIAR PARTIDA
========================================================= */

async function startMatch(id) {

  const data =
    await api('/api/match/' + id);

  match = data.match;

  const initialState =
    await new Promise(resolve => {

      let timer;

      const receive = state => {

        if (state.matchId !== id) {
          return;
        }

        sock.off(
          'gameState',
          receive
        );

        clearTimeout(timer);

        resolve(state);
      };

      sock.on(
        'gameState',
        receive
      );

      sock.emit(
        'join',
        id
      );

      timer = setTimeout(() => {

        sock.off(
          'gameState',
          receive
        );

        resolve(null);

      }, 3000);
    });

  game =
    initialState || {
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


/* =========================================================
   INTERFACE DA PARTIDA
========================================================= */

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

        <div class="table-brand">
          <span>♛</span>
          GK
        </div>

        <canvas
          id="poolCanvas"
          width="1050"
          height="600">
        </canvas>

        <div class="touch-help">
          Arraste a partir da bola branca
          e solte para dar a tacada
        </div>

      </div>

      <div class="controls">

        <div class="power-info">

          <span>
            FORÇA
          </span>

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

      <div
        class="game-tip muted"
        id="groupsText">
        ${groupsText()}
      </div>

    </div>
  `;

  canvas =
    document.getElementById(
      'poolCanvas'
    );

  ctx =
    canvas.getContext('2d');

  bindAimControls();

  resetAim();

  draw();
}


/* =========================================================
   TEXTO DA VEZ
========================================================= */

function turnText() {

  if (!game) {
    return 'Carregando mesa...';
  }

  if (game.winner) {

    return Number(game.winner) ===
      Number(me.id)

      ? '🏆 Você venceu!'

      : '💥 Você perdeu!';
  }

  if (game.moving) {
    return '🎱 Bolas em movimento...';
  }

  if (
    Number(game.currentPlayer) ===
    Number(me.id)
  ) {
    return '🎯 SUA VEZ — arraste a partir da bola branca';
  }

  return '⏳ Aguarde a vez do adversário';
}

function updateTurn() {

  const element =
    document.getElementById(
      'turnBar'
    );

  if (element) {
    element.textContent =
      turnText();
  }
}

function canShoot() {

  return !!(
    game &&
    me &&
    Number(game.currentPlayer) ===
      Number(me.id) &&
    !game.moving &&
    !game.winner &&
    getCueBall()
  );
}

function updateShotButton() {

  const button =
    document.getElementById(
      'shotBtn'
    );

  if (!button) return;

  button.disabled =
    !canShoot();
}


/* =========================================================
   GRUPOS
========================================================= */

function groupsText() {

  if (!game?.groups) {
    return 'Grupos ainda não definidos.';
  }

  const p1 =
    game.groups.p1;

  const p2 =
    game.groups.p2;

  if (!p1 && !p2) {
    return 'Grupos ainda não definidos.';
  }

  function typeName(type) {

    if (type === 'solid') {
      return 'Lisas';
    }

    if (type === 'stripe') {
      return 'Listradas';
    }

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

  if (!match) {
    return 'Jogador';
  }

  if (
    Number(id) ===
    Number(match.p1_id)
  ) {
    return match.p1;
  }

  if (
    Number(id) ===
    Number(match.p2_id)
  ) {
    return match.p2;
  }

  return 'Jogador';
}


/* =========================================================
   COORDENADAS
========================================================= */

function worldToCanvas(x, y) {

  if (!canvas) {
    return {x:0,y:0};
  }

  return {
    x:
      (x / TABLE_W) *
      canvas.width,

    y:
      (y / TABLE_H) *
      canvas.height
  };
}

function canvasToWorld(x, y) {

  if (!canvas) {
    return {x:0,y:0};
  }

  return {

    x:clamp(
      (x / canvas.width) *
        TABLE_W,
      0,
      TABLE_W
    ),

    y:clamp(
      (y / canvas.height) *
        TABLE_H,
      0,
      TABLE_H
    )
  };
}

function ballRadius() {

  if (!canvas) {
    return 20;
  }

  return (
    BALL_R /
    TABLE_W *
    canvas.width
  );
}


/* =========================================================
   BOLA BRANCA
========================================================= */

function getCueBall() {

  if (!game?.balls) {
    return null;
  }

  return game.balls.find(
    b =>
      Number(b.id) === 0 &&
      !b.pocketed
  ) || null;
}

function getPointerPosition(event) {

  const rect =
    canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      (canvas.width / rect.width),

    y:
      (event.clientY - rect.top) *
      (canvas.height / rect.height)
  };
}


/* =========================================================
   MIRA / FORÇA
========================================================= */

function updateAim(event) {

  if (!canvas || !game) {
    return;
  }

  const cue =
    getCueBall();

  if (!cue) {
    return;
  }

  const point =
    getPointerPosition(event);

  const c =
    worldToCanvas(
      cue.x,
      cue.y
    );

  const dx =
    point.x - c.x;

  const dy =
    point.y - c.y;

  /*
    A direção da tacada é
    oposta à direção do arraste.
  */

  aim.angle =
    Math.atan2(
      c.y - point.y,
      c.x - point.x
    );

  const distance =
    Math.sqrt(
      dx * dx +
      dy * dy
    );

  aim.power =
    clamp(
      distance / 280,
      0.08,
      1
    );

  aim.active = true;

  updatePowerUI();
}

function resetAim() {

  aim.active = false;
  aim.power = 0;

  const cue =
    getCueBall();

  if (cue) {

    /*
      Mira inicial para a direita.
    */

    aim.angle = 0;
  }

  updatePowerUI();
  draw();
}

function updatePowerUI() {

  const text =
    document.getElementById(
      'powerText'
    );

  const fill =
    document.getElementById(
      'powerFill'
    );

  const percent =
    Math.round(
      aim.power * 100
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


/* =========================================================
   CONTROLES DE TOQUE / MOUSE
========================================================= */

function bindAimControls() {

  if (!canvas) {
    return;
  }

  canvas.onpointerdown =
    event => {

      if (!canShoot()) {
        return;
      }

      pointerDown = true;
      pointerId = event.pointerId;

      canvas.setPointerCapture?.(
        event.pointerId
      );

      updateAim(event);

      draw();

      event.preventDefault?.();
    };

  canvas.onpointermove =
    event => {

      if (!pointerDown) {
        return;
      }

      if (
        pointerId !== null &&
        event.pointerId !== pointerId
      ) {
        return;
      }

      updateAim(event);

      draw();

      event.preventDefault?.();
    };

  canvas.onpointerup =
    event => {

      if (!pointerDown) {
        return;
      }

      pointerDown = false;

      if (
        pointerId !== null &&
        event.pointerId !== pointerId
      ) {
        pointerId = null;
        return;
      }

      pointerId = null;

      updateAim(event);

      draw();

      event.preventDefault?.();

      /*
        AQUI ESTÁ A CORREÇÃO PRINCIPAL:
        ao soltar, a tacada é enviada.
      */

      if (aim.power >= 0.08) {
        shootNow();
      }
    };

  canvas.onpointercancel =
    () => {

      pointerDown = false;
      pointerId = null;
    };

  canvas.oncontextmenu =
    event => {
      event.preventDefault();
    };
}


/* =========================================================
   TACADA
========================================================= */

function shootNow() {

  if (!canShoot()) {
    return;
  }

  if (!sock) {
    note('Sem conexão com a partida.');
    return;
  }

  const power =
    clamp(
      aim.power,
      0.08,
      1
    );

  const angle =
    Number.isFinite(aim.angle)
      ? aim.angle
      : 0;

  game.moving = true;

  updateShotButton();
  updateTurn();

  sock.emit(
    'shot',
    {
      matchId:match.id,
      angle,
      power
    }
  );

  aim.power = 0;
  aim.active = false;

  updatePowerUI();
  draw();
}


/* =========================================================
   DESENHO PRINCIPAL
========================================================= */

function draw() {

  if (!canvas || !ctx || !game) {
    return;
  }

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

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
  updatePowerUI();

  const groupElement =
    document.getElementById(
      'groupsText'
    );

  if (groupElement) {
    groupElement.innerHTML =
      groupsText();
  }
}
/* =========================================================
   MESA PREMIUM GK
========================================================= */

function roundRect(ctx, x, y, width, height, radius) {

  const r = Math.min(
    radius,
    width / 2,
    height / 2
  );

  ctx.beginPath();

  ctx.moveTo(x + r, y);

  ctx.arcTo(
    x + width,
    y,
    x + width,
    y + height,
    r
  );

  ctx.arcTo(
    x + width,
    y + height,
    x,
    y + height,
    r
  );

  ctx.arcTo(
    x,
    y + height,
    x,
    y,
    r
  );

  ctx.arcTo(
    x,
    y,
    x + width,
    y,
    r
  );

  ctx.closePath();
}


function drawTable() {

  const w = canvas.width;
  const h = canvas.height;

  const pad = 34;

  /*
    SOMBRA DA MESA
  */

  ctx.save();

  ctx.shadowColor =
    'rgba(0,0,0,.75)';

  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 20;

  const wood =
    ctx.createLinearGradient(
      0,
      0,
      w,
      h
    );

  wood.addColorStop(
    0,
    '#5a351d'
  );

  wood.addColorStop(
    .25,
    '#a36a32'
  );

  wood.addColorStop(
    .5,
    '#4b2b18'
  );

  wood.addColorStop(
    .75,
    '#8a5529'
  );

  wood.addColorStop(
    1,
    '#24140b'
  );

  ctx.fillStyle = wood;

  roundRect(
    ctx,
    0,
    0,
    w,
    h,
    30
  );

  ctx.fill();

  ctx.restore();


  /*
    BORDA DOURADA
  */

  const gold =
    ctx.createLinearGradient(
      0,
      0,
      w,
      0
    );

  gold.addColorStop(
    0,
    '#6d4b1d'
  );

  gold.addColorStop(
    .2,
    '#d6b45f'
  );

  gold.addColorStop(
    .5,
    '#fff0ae'
  );

  gold.addColorStop(
    .8,
    '#c99e43'
  );

  gold.addColorStop(
    1,
    '#5a3d17'
  );

  ctx.fillStyle = gold;

  roundRect(
    ctx,
    10,
    10,
    w - 20,
    h - 20,
    25
  );

  ctx.fill();


  /*
    BORDA ESCURA INTERNA
  */

  ctx.fillStyle =
    '#321d10';

  roundRect(
    ctx,
    21,
    21,
    w - 42,
    h - 42,
    21
  );

  ctx.fill();


  /*
    PANO VERDE
  */

  const cloth =
    ctx.createLinearGradient(
      0,
      pad,
      0,
      h - pad
    );

  cloth.addColorStop(
    0,
    '#12845c'
  );

  cloth.addColorStop(
    .25,
    '#0b7953'
  );

  cloth.addColorStop(
    .55,
    '#086b49'
  );

  cloth.addColorStop(
    .8,
    '#075d40'
  );

  cloth.addColorStop(
    1,
    '#06472f'
  );

  ctx.fillStyle = cloth;

  roundRect(
    ctx,
    pad,
    pad,
    w - pad * 2,
    h - pad * 2,
    17
  );

  ctx.fill();


  /*
    BRILHO DO PANO
  */

  const shine =
    ctx.createLinearGradient(
      0,
      pad,
      0,
      h / 2
    );

  shine.addColorStop(
    0,
    'rgba(255,255,255,.13)'
  );

  shine.addColorStop(
    .35,
    'rgba(255,255,255,.025)'
  );

  shine.addColorStop(
    1,
    'rgba(0,0,0,.12)'
  );

  ctx.fillStyle = shine;

  roundRect(
    ctx,
    pad,
    pad,
    w - pad * 2,
    h - pad * 2,
    17
  );

  ctx.fill();


  /*
    TEXTURA DO PANO
  */

  ctx.save();

  ctx.globalAlpha = .055;

  ctx.strokeStyle =
    '#ffffff';

  ctx.lineWidth = 1;

  for (
    let x = pad;
    x < w - pad;
    x += 14
  ) {

    ctx.beginPath();

    ctx.moveTo(
      x,
      pad
    );

    ctx.lineTo(
      x,
      h - pad
    );

    ctx.stroke();
  }

  for (
    let y = pad;
    y < h - pad;
    y += 14
  ) {

    ctx.beginPath();

    ctx.moveTo(
      pad,
      y
    );

    ctx.lineTo(
      w - pad,
      y
    );

    ctx.stroke();
  }

  ctx.restore();


  /*
    LOGO GK NA MESA
  */

  ctx.save();

  ctx.globalAlpha = .14;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle =
    '#e0c77c';

  ctx.font =
    '900 94px Arial';

  ctx.fillText(
    'GK',
    w / 2,
    h / 2 - 18
  );

  ctx.font =
    'bold 17px Arial';

  ctx.fillText(
    'SINuca ARENA',
    w / 2,
    h / 2 + 48
  );

  ctx.restore();


  /*
    LINHA CENTRAL
  */

  ctx.save();

  ctx.strokeStyle =
    'rgba(255,255,255,.16)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    w / 2,
    pad
  );

  ctx.lineTo(
    w / 2,
    h - pad
  );

  ctx.stroke();

  ctx.restore();


  /*
    MARCA DE SAÍDA
  */

  ctx.save();

  ctx.strokeStyle =
    'rgba(255,255,255,.28)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.arc(
    w * .25,
    h / 2,
    42,
    -Math.PI / 2,
    Math.PI / 2
  );

  ctx.stroke();

  ctx.restore();


  /*
    PEQUENAS MARCAÇÕES DA TABELA
  */

  ctx.save();

  ctx.fillStyle =
    'rgba(235,210,145,.8)';

  const markerSize = 5;

  const markers = [
    [.18, .03],
    [.36, .03],
    [.50, .03],
    [.64, .03],
    [.82, .03],

    [.18, .97],
    [.36, .97],
    [.50, .97],
    [.64, .97],
    [.82, .97]
  ];

  markers.forEach(m => {

    ctx.beginPath();

    ctx.arc(
      w * m[0],
      h * m[1],
      markerSize,
      0,
      Math.PI * 2
    );

    ctx.fill();
  });

  ctx.restore();


  /*
    6 CAÇAPAS
  */

  const pockets = getPocketPositions();

  pockets.forEach(p => {

    const radius =
      Math.min(
        w,
        h
      ) * .047;

    /*
      sombra
    */

    ctx.save();

    ctx.shadowColor =
      'rgba(0,0,0,.9)';

    ctx.shadowBlur = 12;

    ctx.fillStyle =
      '#020403';

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();


    /*
      aro da caçapa
    */

    ctx.strokeStyle =
      'rgba(230,205,137,.5)';

    ctx.lineWidth = 4;

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      radius + 3,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  });
}


function getPocketPositions() {

  if (!canvas) {
    return [];
  }

  const w = canvas.width;
  const h = canvas.height;

  return [
    {
      x:34,
      y:34
    },

    {
      x:w / 2,
      y:30
    },

    {
      x:w - 34,
      y:34
    },

    {
      x:34,
      y:h - 34
    },

    {
      x:w / 2,
      y:h - 30
    },

    {
      x:w - 34,
      y:h - 34
    }
  ];
}


/* =========================================================
   BOLAS 3D
========================================================= */

const BALL_COLORS = {
  0:'#f4f4f1',
  1:'#f3c400',
  2:'#174aa8',
  3:'#d91d22',
  4:'#6e2a91',
  5:'#ef6d18',
  6:'#168447',
  7:'#8d171d',
  8:'#111111',
  9:'#e6bd16',
  10:'#2454a7',
  11:'#d52c32',
  12:'#71328e',
  13:'#e96f1c',
  14:'#23864b',
  15:'#8d2023'
};


function drawBall(ball) {

  if (!canvas || !ctx) {
    return;
  }

  const p =
    worldToCanvas(
      Number(ball.x) || 0,
      Number(ball.y) || 0
    );

  const r =
    ballRadius();

  const number =
    Number(ball.id) || 0;

  const base =
    BALL_COLORS[number] ||
    '#dddddd';

  /*
    SOMBRA
  */

  ctx.save();

  ctx.globalAlpha = .35;

  ctx.fillStyle =
    '#000';

  ctx.beginPath();

  ctx.ellipse(
    p.x + r * .22,
    p.y + r * .45,
    r * .92,
    r * .48,
    0,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.restore();


  /*
    GRADIENTE DA BOLA
  */

  const gradient =
    ctx.createRadialGradient(
      p.x - r * .35,
      p.y - r * .4,
      r * .12,
      p.x,
      p.y,
      r
    );

  gradient.addColorStop(
    0,
    '#ffffff'
  );

  gradient.addColorStop(
    .18,
    base
  );

  gradient.addColorStop(
    .72,
    base
  );

  gradient.addColorStop(
    1,
    '#050505'
  );

  ctx.fillStyle =
    gradient;

  ctx.beginPath();

  ctx.arc(
    p.x,
    p.y,
    r,
    0,
    Math.PI * 2
  );

  ctx.fill();


  /*
    LISTRAS
  */

  if (
    number >= 9 &&
    number <= 15
  ) {

    ctx.save();

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      r,
      0,
      Math.PI * 2
    );

    ctx.clip();

    ctx.fillStyle =
      'rgba(255,255,255,.9)';

    ctx.fillRect(
      p.x - r,
      p.y - r * .28,
      r * 2,
      r * .56
    );

    ctx.restore();
  }


  /*
    NÚMERO BRANCO
  */

  if (number !== 0) {

    ctx.fillStyle =
      '#f7f7f5';

    ctx.beginPath();

    ctx.arc(
      p.x,
      p.y,
      r * .43,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.fillStyle =
      '#111';

    ctx.textAlign =
      'center';

    ctx.textBaseline =
      'middle';

    ctx.font =
      `900 ${Math.max(
        9,
        r * .65
      )}px Arial`;

    ctx.fillText(
      number,
      p.x,
      p.y + .5
    );
  }


  /*
    BRILHO
  */

  ctx.fillStyle =
    'rgba(255,255,255,.7)';

  ctx.beginPath();

  ctx.arc(
    p.x - r * .34,
    p.y - r * .38,
    r * .13,
    0,
    Math.PI * 2
  );

  ctx.fill();


  /*
    CONTORNO
  */

  ctx.strokeStyle =
    'rgba(0,0,0,.55)';

  ctx.lineWidth = 1.5;

  ctx.beginPath();

  ctx.arc(
    p.x,
    p.y,
    r,
    0,
    Math.PI * 2
  );

  ctx.stroke();
}


/* =========================================================
   MIRA + LINHA DE TRAJETÓRIA
========================================================= */

function drawAim() {

  if (!canShoot()) {
    return;
  }

  const cue =
    getCueBall();

  if (!cue) {
    return;
  }

  const start =
    worldToCanvas(
      cue.x,
      cue.y
    );

  const angle =
    aim.angle || 0;

  const maxLength =
    Math.max(
      canvas.width,
      canvas.height
    );

  /*
    LINHA DE MIRA
  */

  ctx.save();

  ctx.setLineDash([
    12,
    10
  ]);

  ctx.strokeStyle =
    aim.active
      ? 'rgba(255,245,190,.95)'
      : 'rgba(255,255,255,.5)';

  ctx.lineWidth =
    aim.active
      ? 3
      : 2;

  ctx.beginPath();

  ctx.moveTo(
    start.x,
    start.y
  );

  ctx.lineTo(
    start.x +
      Math.cos(angle) *
      maxLength,

    start.y +
      Math.sin(angle) *
      maxLength
  );

  ctx.stroke();

  ctx.restore();


  /*
    PONTO DE IMPACTO VISUAL
  */

  const targetDistance =
    ballRadius() * 5;

  ctx.save();

  ctx.fillStyle =
    'rgba(255,245,190,.95)';

  ctx.beginPath();

  ctx.arc(
    start.x +
      Math.cos(angle) *
      targetDistance,

    start.y +
      Math.sin(angle) *
      targetDistance,

    4,

    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.restore();


  /*
    TACO
  */

  drawCue(
    start,
    angle
  );
}


/* =========================================================
   TACO
========================================================= */

function drawCue(start, angle) {

  const power =
    aim.power || 0;

  const cueLength =
    270 + power * 100;

  const gap =
    ballRadius() * 1.5 +
    power * 90;

  /*
    O taco fica atrás
    da bola na direção
    contrária da tacada.
  */

  const endX =
    start.x -
    Math.cos(angle) *
    (gap + cueLength);

  const endY =
    start.y -
    Math.sin(angle) *
    (gap + cueLength);

  const tipX =
    start.x -
    Math.cos(angle) *
    gap;

  const tipY =
    start.y -
    Math.sin(angle) *
    gap;

  ctx.save();

  ctx.lineCap =
    'round';

  /*
    sombra do taco
  */

  ctx.strokeStyle =
    'rgba(0,0,0,.5)';

  ctx.lineWidth = 12;

  ctx.beginPath();

  ctx.moveTo(
    endX + 5,
    endY + 7
  );

  ctx.lineTo(
    tipX + 5,
    tipY + 7
  );

  ctx.stroke();

  /*
    corpo dourado/madeira
  */

  const cueGradient =
    ctx.createLinearGradient(
      endX,
      endY,
      tipX,
      tipY
    );

  cueGradient.addColorStop(
    0,
    '#3b1b08'
  );

  cueGradient.addColorStop(
    .18,
    '#b77730'
  );

  cueGradient.addColorStop(
    .48,
    '#f0c36c'
  );

  cueGradient.addColorStop(
    .75,
    '#8a4b1e'
  );

  cueGradient.addColorStop(
    1,
    '#e9dfc7'
  );

  ctx.strokeStyle =
    cueGradient;

  ctx.lineWidth = 8;

  ctx.beginPath();

  ctx.moveTo(
    endX,
    endY
  );

  ctx.lineTo(
    tipX,
    tipY
  );

  ctx.stroke();

  /*
    detalhes metálicos
  */

  ctx.strokeStyle =
    '#e2bd67';

  ctx.lineWidth = 3;

  const ringDistance =
    cueLength * .23;

  const ringX =
    tipX -
    Math.cos(angle) *
    ringDistance;

  const ringY =
    tipY -
    Math.sin(angle) *
    ringDistance;

  ctx.beginPath();

  ctx.moveTo(
    ringX -
      Math.sin(angle) * 5,
    ringY +
      Math.cos(angle) * 5
  );

  ctx.lineTo(
    ringX +
      Math.sin(angle) * 5,
    ringY -
      Math.cos(angle) * 5
  );

  ctx.stroke();

  ctx.restore();
}
/* =========================================================
   HISTÓRICO
========================================================= */

async function historyPage() {

  if (!me) {
    login();
    return;
  }

  try {

    const data =
      await api('/api/history');

    A.innerHTML = `
      <div class="wrap">

        ${nav()}

        <div class="card">

          <h2>
            📜 Histórico de partidas
          </h2>

          ${
            data.matches?.length
            ? data.matches.map(m => `

              <div class="row">

                <div>

                  <b>
                    ${esc(m.p1)}
                    ×
                    ${esc(m.p2)}
                  </b>

                  <div class="muted small">
                    🪙 Aposta:
                    ${m.stake}
                  </div>

                </div>

                <div class="small">

                  ${
                    Number(m.winner_id) ===
                    Number(me.id)

                    ? `
                      <span class="gold">
                        🏆 Vitória
                      </span>
                    `

                    : Number(m.winner_id) !==
                      Number(me.id)

                    ? `
                      <span class="muted">
                        Derrota
                      </span>
                    `

                    : `
                      <span class="muted">
                        Em andamento
                      </span>
                    `
                  }

                </div>

              </div>

            `).join('')

            : `
              <p class="muted">
                Nenhuma partida encontrada.
              </p>
            `
          }

        </div>

      </div>
    `;

  } catch (e) {

    note(e.message);
  }
}


/* =========================================================
   DIVULGAR
========================================================= */

function invite() {

  const link =
    window.location.origin;

  A.innerHTML = `

    <div class="wrap">

      ${nav()}

      <div class="card">

        <div class="eyebrow">
          SINUCA ARENA GK
        </div>

        <h2>
          🔗 Divulgue o jogo
        </h2>

        <p class="muted">
          Envie esse link para seus amigos
          entrarem no Sinuca Arena GK.
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
            📲 Compartilhar
          </button>

        </div>

      </div>

    </div>
  `;
}

async function copyInvite() {

  const link =
    window.location.origin;

  try {

    await navigator.clipboard.writeText(
      link
    );

    note(
      '✅ Link copiado!'
    );

  } catch (e) {

    note(
      'Não foi possível copiar automaticamente.'
    );
  }
}

async function shareInvite() {

  const link =
    window.location.origin;

  try {

    if (
      navigator.share
    ) {

      await navigator.share({
        title:'Sinuca Arena GK',
        text:'🎱 Venha jogar Sinuca Arena GK comigo!',
        url:link
      });

    } else {

      await copyInvite();
    }

  } catch (_) {}
}


/* =========================================================
   ADM
========================================================= */

async function admin() {

  if (!me?.is_admin) {
    note('Acesso restrito ao ADM.');
    return;
  }

  try {

    const data =
      await api('/api/players');

    A.innerHTML = `

      <div class="wrap">

        ${nav()}

        <div class="card">

          <div class="eyebrow">
            ADMINISTRAÇÃO
          </div>

          <h2>
            👑 Controle de fichas
          </h2>

          <p class="muted">
            Libere ou retire fichas dos jogadores.
          </p>

        </div>

        <div class="card">

          ${
            data.players?.length

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

                    <b>
                      ${esc(player.display_name)}
                    </b>

                    <div class="muted small">
                      @${esc(player.username)}
                    </div>

                    <div class="gold small">
                      🪙 ${player.chips} fichas
                    </div>

                  </div>

                </div>

                <div class="admin-actions">

                  <input
                    class="input stake-input"
                    id="admin-${player.id}"
                    type="number"
                    min="1"
                    value="100">

                  <button
                    class="btn mini"
                    onclick="addChips(${player.id})">
                    + Fichas
                  </button>

                  <button
                    class="btn dark mini"
                    onclick="removeChips(${player.id})">
                    − Fichas
                  </button>

                </div>

              </div>

            `).join('')

            : `
              <p class="muted">
                Nenhum jogador cadastrado.
              </p>
            `
          }

        </div>

      </div>
    `;

  } catch (e) {

    note(e.message);
  }
}

async function addChips(userId) {

  const input =
    document.getElementById(
      'admin-' + userId
    );

  const amount =
    Number(input?.value || 0);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    note('Digite uma quantidade válida.');
    return;
  }

  try {

    await api(
      '/api/admin/chips',
      {
        method:'POST',
        body:{
          userId,
          amount
        }
      }
    );

    note(
      `✅ ${amount} fichas liberadas.`
    );

    admin();

  } catch (e) {

    note(e.message);
  }
}

async function removeChips(userId) {

  const input =
    document.getElementById(
      'admin-' + userId
    );

  const amount =
    Number(input?.value || 0);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    note('Digite uma quantidade válida.');
    return;
  }

  try {

    await api(
      '/api/admin/chips',
      {
        method:'POST',
        body:{
          userId,
          amount:-amount
        }
      }
    );

    note(
      `🪙 ${amount} fichas retiradas.`
    );

    admin();

  } catch (e) {

    note(e.message);
  }
}


/* =========================================================
   SAIR DA PARTIDA
========================================================= */

function leaveMatch() {

  if (!match) {
    home();
    return;
  }

  const confirmed =
    window.confirm(
      'Deseja realmente sair da partida?'
    );

  if (!confirmed) {
    return;
  }

  try {

    if (sock && match?.id) {
      sock.emit(
        'leave',
        match.id
      );
    }

  } catch (_) {}

  match = null;
  game = null;

  canvas = null;
  ctx = null;

  pointerDown = false;
  pointerId = null;

  aim.active = false;
  aim.power = 0;

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
  canvas = null;
  ctx = null;

  localStorage.removeItem(
    'token'
  );

  login();
}


/* =========================================================
   INICIALIZAÇÃO AUTOMÁTICA
========================================================= */

if (token) {

  boot();

} else {

  login();

}
