const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database('arena.db');

const SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.pragma('journal_mode=WAL');

/* =========================================================
   BANCO DE DADOS
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  display_name TEXT,
  password_hash TEXT,
  chips INTEGER DEFAULT 100,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches(
  id TEXT PRIMARY KEY,
  p1 INTEGER,
  p2 INTEGER,
  stake INTEGER,
  status TEXT,
  winner INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================================================
   FUNÇÕES GERAIS
========================================================= */

const user = id => {
  return db.prepare(`
    SELECT
      id,
      username,
      display_name,
      chips,
      wins,
      losses,
      is_admin
    FROM users
    WHERE id=?
  `).get(id);
};

const tx = (id, amount, type, description) => {
  return db.prepare(`
    INSERT INTO transactions(
      user_id,
      amount,
      type,
      description
    )
    VALUES(?,?,?,?)
  `).run(id, amount, type, description);
};

const tok = u => {
  return jwt.sign(
    {
      id: u.id,
      admin: !!u.is_admin
    },
    SECRET,
    {
      expiresIn: '7d'
    }
  );
};

const auth = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';

    const token = header.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'Não autenticado'
      });
    }

    req.u = jwt.verify(token, SECRET);

    next();

  } catch (e) {

    return res.status(401).json({
      error: 'Não autenticado'
    });
  }
};

/* =========================================================
   ADMIN PADRÃO
========================================================= */

const adminExistente = db
  .prepare('SELECT * FROM users WHERE username=?')
  .get('admin');

if (!adminExistente) {

  const hash = bcrypt.hashSync('gk2026', 10);

  const result = db.prepare(`
    INSERT INTO users(
      username,
      display_name,
      password_hash,
      chips,
      is_admin
    )
    VALUES(?,?,?,?,1)
  `).run(
    'admin',
    'Administrador',
    hash,
    5000
  );

  tx(
    result.lastInsertRowid,
    5000,
    'credit',
    'Saldo inicial do ADM'
  );

} else if (bcrypt.compareSync('1234', adminExistente.password_hash)) {

  db.prepare(`
    UPDATE users
    SET password_hash=?
    WHERE username=?
  `).run(
    bcrypt.hashSync('gk2026', 10),
    'admin'
  );
}

/* =========================================================
   CADASTRO
========================================================= */

app.post('/api/register', (req, res) => {

  const username = String(req.body.username || '')
    .toLowerCase()
    .trim();

  const password = String(req.body.password || '');

  /*
    O game.js novo pode enviar displayName.
    Caso não envie, usamos o próprio username.
  */

  const displayName = String(
    req.body.displayName ||
    req.body.display_name ||
    username
  )
    .trim()
    .slice(0, 30);

  if (!username || !password || password.length < 4) {

    return res.status(400).json({
      error: 'Preencha os dados corretamente.'
    });
  }

  try {

    const hash = bcrypt.hashSync(password, 10);

    const result = db.prepare(`
      INSERT INTO users(
        username,
        display_name,
        password_hash,
        chips
      )
      VALUES(?,?,?,100)
    `).run(
      username,
      displayName,
      hash
    );

    tx(
      result.lastInsertRowid,
      100,
      'credit',
      'Bônus de cadastro'
    );

    const u = user(result.lastInsertRowid);

    return res.json({
      token: tok(u),
      user: u
    });

  } catch (e) {

    return res.status(400).json({
      error: 'Usuário já existe.'
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post('/api/login', (req, res) => {

  const username = String(
    req.body.username || ''
  )
    .toLowerCase()
    .trim();

  const password = String(
    req.body.password || ''
  );

  const u = db.prepare(`
    SELECT *
    FROM users
    WHERE username=?
  `).get(username);

  if (
    !u ||
    !bcrypt.compareSync(
      password,
      u.password_hash
    )
  ) {

    return res.status(401).json({
      error: 'Login inválido.'
    });
  }

  return res.json({
    token: tok(u),
    user: user(u.id)
  });
});

/* =========================================================
   USUÁRIO LOGADO
========================================================= */

app.get('/api/me', auth, (req, res) => {

  const u = user(req.u.id);

  if (!u) {
    return res.status(404).json({
      error: 'Usuário não encontrado.'
    });
  }

  res.json({
    user: u
  });
});

/* =========================================================
   LISTA DE JOGADORES
========================================================= */

app.get('/api/players', auth, (req, res) => {

  const players = db.prepare(`
    SELECT
      id,
      username,
      display_name,
      chips,
      wins,
      losses
    FROM users
    WHERE id != ?
    ORDER BY wins DESC, id ASC
  `).all(req.u.id);

  res.json({
    players
  });
});

/* =========================================================
   HISTÓRICO
========================================================= */

app.get('/api/history', auth, (req, res) => {

  const matches = db.prepare(`
    SELECT
      m.*,
      a.display_name AS p1_name,
      b.display_name AS p2_name,
      w.display_name AS winner_name
    FROM matches m

    JOIN users a
      ON a.id = m.p1

    JOIN users b
      ON b.id = m.p2

    LEFT JOIN users w
      ON w.id = m.winner

    WHERE m.p1=? OR m.p2=?

    ORDER BY m.created_at DESC

    LIMIT 50
  `).all(
    req.u.id,
    req.u.id
  );

  const transactions = db.prepare(`
    SELECT *
    FROM transactions
    WHERE user_id=?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.u.id);

  res.json({
    matches,
    transactions
  });
});

/* =========================================================
   CRIAR DESAFIO
========================================================= */

app.post('/api/challenge', auth, (req, res) => {

  /*
    Compatibilidade com os dois formatos:

    novo game.js:
    opponentId

    código antigo:
    opponent
  */

  const opponentId = Number(
    req.body.opponentId ??
    req.body.opponent
  );

  const stake = Math.floor(
    Number(req.body.stake)
  );

  const p1 = user(req.u.id);
  const p2 = user(opponentId);

  if (!p1 || !p2) {

    return res.status(400).json({
      error: 'Jogador não encontrado.'
    });
  }

  if (p1.id === p2.id) {

    return res.status(400).json({
      error: 'Você não pode desafiar a si mesmo.'
    });
  }

  if (!Number.isFinite(stake) || stake < 10) {

    return res.status(400).json({
      error: 'A aposta mínima é 10 fichas.'
    });
  }

  if (p1.chips < stake) {

    return res.status(400).json({
      error: 'Você não possui fichas suficientes.'
    });
  }

  if (p2.chips < stake) {

    return res.status(400).json({
      error: 'O adversário não possui fichas suficientes.'
    });
  }

  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO matches(
      id,
      p1,
      p2,
      stake,
      status
    )
    VALUES(?,?,?,?,?)
  `).run(
    id,
    p1.id,
    p2.id,
    stake,
    'pending'
  );

  io.to('u:' + p2.id).emit(
    'challenge',
    {
      matchId: id,
      to: p2.id,
      from: p1.id,
      fromName: p1.display_name,
      stake
    }
  );

  res.json({
    matchId: id
  });
});

/* =========================================================
   CONSULTAR PARTIDA
========================================================= */

app.get('/api/match/:id', auth, (req, res) => {

  const m = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(req.params.id);

  if (
    !m ||
    ![m.p1, m.p2].includes(req.u.id)
  ) {

    return res.status(404).json({
      error: 'Partida não encontrada.'
    });
  }

  const p1 = user(m.p1);
  const p2 = user(m.p2);

  const g = games.get(m.id);

  res.json({
    match: {
      ...m,

      p1: p1?.display_name || String(m.p1),
      p2: p2?.display_name || String(m.p2),

      p1_id: m.p1,
      p2_id: m.p2
    },

    game: g ? publicGame(g) : null
  });
});

/* =========================================================
   ACEITAR DESAFIO
========================================================= */

app.post('/api/match/:id/accept', auth, (req, res) => {

  const m = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(req.params.id);

  if (
    !m ||
    m.p2 !== req.u.id ||
    m.status !== 'pending'
  ) {

    return res.status(400).json({
      error: 'Desafio inválido.'
    });
  }

  const p1 = user(m.p1);
  const p2 = user(m.p2);

  if (!p1 || !p2) {

    return res.status(400).json({
      error: 'Jogador inválido.'
    });
  }

  if (
    p1.chips < m.stake ||
    p2.chips < m.stake
  ) {

    return res.status(400).json({
      error: 'Saldo insuficiente.'
    });
  }

  const run = db.transaction(() => {

    db.prepare(`
      UPDATE users
      SET chips=chips-?
      WHERE id IN (?,?)
    `).run(
      m.stake,
      p1.id,
      p2.id
    );

    tx(
      p1.id,
      -m.stake,
      'debit',
      'Aposta da partida'
    );

    tx(
      p2.id,
      -m.stake,
      'debit',
      'Aposta da partida'
    );

    db.prepare(`
      UPDATE matches
      SET status='active'
      WHERE id=?
    `).run(m.id);
  });

  run();

  /*
    Cria o jogo imediatamente.
  */

  const activeMatch = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(m.id);

  if (!games.has(m.id)) {

    const g = newGame(activeMatch);

    games.set(m.id, g);
  }

  io.to('u:' + p1.id).emit(
    'matchAccepted',
    {
      matchId: m.id
    }
  );

  io.to('u:' + p2.id).emit(
    'matchAccepted',
    {
      matchId: m.id
    }
  );

  /*
    Atualiza carteira.
  */

  io.to('u:' + p1.id).emit(
    'wallet',
    {
      chips: user(p1.id)?.chips
    }
  );

  io.to('u:' + p2.id).emit(
    'wallet',
    {
      chips: user(p2.id)?.chips
    }
  );

  res.json({
    ok: true,
    matchId: m.id
  });
});

/* =========================================================
   REJEITAR DESAFIO
========================================================= */

app.post('/api/match/:id/reject', auth, (req, res) => {

  const m = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(req.params.id);

  if (
    !m ||
    m.p2 !== req.u.id ||
    m.status !== 'pending'
  ) {

    return res.status(400).json({
      error: 'Desafio inválido.'
    });
  }

  db.prepare(`
    UPDATE matches
    SET status='rejected'
    WHERE id=?
  `).run(m.id);

  io.to('u:' + m.p1).emit(
    'matchRejected',
    {
      matchId: m.id
    }
  );

  io.to('u:' + m.p2).emit(
    'matchRejected',
    {
      matchId: m.id
    }
  );

  res.json({
    ok: true
  });
});

/* =========================================================
   FINALIZAR PARTIDA POR API
========================================================= */

app.post('/api/match/:id/finish', auth, (req, res) => {

  const m = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(req.params.id);

  const winner = Number(
    req.body.winner
  );

  if (
    !m ||
    m.status !== 'active' ||
    ![m.p1, m.p2].includes(req.u.id) ||
    ![m.p1, m.p2].includes(winner)
  ) {

    return res.status(400).json({
      error: 'Partida inválida.'
    });
  }

  finishDb(
    m.id,
    winner
  );

  const g = games.get(m.id);

  if (g) {
    g.winner = winner;
    g.moving = false;
  }

  io.to('m:' + m.id).emit(
    'gameOver',
    {
      matchId: m.id,
      winner
    }
  );

  res.json({
    ok: true
  });
});

/* =========================================================
   ADMIN - LISTAR USUÁRIOS
========================================================= */

app.get('/api/admin/users', auth, (req, res) => {

  if (!req.u.admin) {

    return res.status(403).json({
      error: 'ADM somente.'
    });
  }

  const users = db.prepare(`
    SELECT
      id,
      username,
      display_name,
      chips,
      wins,
      losses
    FROM users
    ORDER BY id DESC
  `).all();

  res.json({
    users
  });
});

/* =========================================================
   ADMIN - LIBERAR / RETIRAR FICHAS
========================================================= */

app.post('/api/admin/chips', auth, (req, res) => {

  if (!req.u.admin) {

    return res.status(403).json({
      error: 'ADM somente.'
    });
  }

  const id = Number(
    req.body.userId
  );

  const amount = Math.floor(
    Number(req.body.amount)
  );

  /*
    Compatibilidade:

    action: add
    action: remove
  */

  const action = String(
    req.body.action || 'add'
  ).toLowerCase();

  const add = action === 'add';

  const u = user(id);

  if (!u) {

    return res.status(400).json({
      error: 'Usuário não encontrado.'
    });
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    return res.status(400).json({
      error: 'Quantidade inválida.'
    });
  }

  if (
    !add &&
    u.chips < amount
  ) {

    return res.status(400).json({
      error: 'O jogador não possui fichas suficientes.'
    });
  }

  const finalAmount = add
    ? amount
    : -amount;

  db.prepare(`
    UPDATE users
    SET chips=chips+?
    WHERE id=?
  `).run(
    finalAmount,
    id
  );

  tx(
    id,
    finalAmount,
    add ? 'credit' : 'debit',
    add
      ? 'Fichas liberadas pelo ADM'
      : 'Fichas retiradas pelo ADM'
  );

  const updated = user(id);

  io.to('u:' + id).emit(
    'wallet',
    {
      chips: updated.chips
    }
  );

  res.json({
    user: updated
  });
});

/* =========================================================
   MOTOR DE SINUCA 1V1
========================================================= */

const TABLE_W = 1.75;
const TABLE_H = 1;

const BALL_R = 0.0255;
const POCKET_R = 0.065;

const FRICTION = 2.25;
const MAX_SPEED = 1.55;

const DT = 1 / 120;

const pockets = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1.75, y: 0 },

  { x: 0, y: 1 },
  { x: 0.5, y: 1 },
  { x: 1.75, y: 1 }
];

const games = new Map();

const colors = {
  1: 'solid',
  2: 'solid',
  3: 'solid',
  4: 'solid',
  5: 'solid',
  6: 'solid',
  7: 'solid',

  9: 'stripe',
  10: 'stripe',
  11: 'stripe',
  12: 'stripe',
  13: 'stripe',
  14: 'stripe',
  15: 'stripe'
};

/* =========================================================
   CRIAR BOLAS
========================================================= */

function makeBalls() {

  const balls = [];

  /*
    Bola branca.
  */

  balls.push({
    id: 0,
    x: 0.36,
    y: 0.5,
    vx: 0,
    vy: 0,
    pocketed: false
  });

  /*
    Rack.
  */

  const rack = [
    1,
    10,
    2,
    11,
    8,
    3,
    12,
    4,
    13,
    5,
    14,
    6,
    15,
    7,
    9
  ];

  const spacing = BALL_R * 2.04;
  const apexX = 1.26;

  let k = 0;

  for (
    let row = 0;
    row < 5;
    row++
  ) {

    for (
      let col = 0;
      col <= row;
      col++
    ) {

      const x =
        apexX +
        row *
        spacing *
        0.86;

      const y =
        0.5 +
        (
          col -
          row / 2
        ) *
        spacing;

      balls.push({
        id: rack[k++],
        x,
        y,
        vx: 0,
        vy: 0,
        pocketed: false
      });
    }
  }

  return balls;
}

/* =========================================================
   NOVA PARTIDA
========================================================= */

function newGame(m) {

  return {
    matchId: m.id,

    p1: m.p1,
    p2: m.p2,

    stake: m.stake,

    /*
      Primeiro jogador começa.
    */

    currentPlayer: m.p1,

    moving: false,

    winner: null,

    groups: {
      p1: null,
      p2: null
    },

    breakShot: true,

    balls: makeBalls(),

    beforePocketed: []
  };
}

/* =========================================================
   ESTADO PÚBLICO DO JOGO
========================================================= */

function publicGame(g) {

  return {
    matchId: g.matchId,

    p1: g.p1,
    p2: g.p2,

    stake: g.stake,

    /*
      currentPlayer é usado pelo servidor.

      turn é enviado também para o
      game.js novo.
    */

    currentPlayer: g.currentPlayer,
    turn: g.currentPlayer,

    moving: g.moving,

    winner: g.winner,

    groups: g.groups,

    breakShot: g.breakShot,

    balls: g.balls.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      pocketed: b.pocketed
    }))
  };
}

/* =========================================================
   ENVIAR ESTADO
========================================================= */

function broadcastGame(g) {

  io
    .to('m:' + g.matchId)
    .emit(
      'gameState',
      publicGame(g)
    );
}

/* =========================================================
   FÍSICA
========================================================= */

function speed(b) {

  return Math.hypot(
    b.vx,
    b.vy
  );
}

function anyMoving(g) {

  return g.balls.some(
    b =>
      !b.pocketed &&
      speed(b) > 0.012
  );
}

/* =========================================================
   CAÇAPA
========================================================= */

function pocketBall(g, b) {

  b.pocketed = true;

  b.vx = 0;
  b.vy = 0;
}

/* =========================================================
   PASSO DA FÍSICA
========================================================= */

function physicsStep(g) {

  /*
    Movimento.
  */

  for (const b of g.balls) {

    if (b.pocketed) continue;

    b.x += b.vx * DT;
    b.y += b.vy * DT;

    /*
      Verifica caçapas.
    */

    for (const p of pockets) {

      if (
        Math.hypot(
          b.x - p.x,
          b.y - p.y
        ) < POCKET_R
      ) {

        pocketBall(g, b);

        break;
      }
    }

    if (b.pocketed) continue;

    /*
      Bordas.
    */

    if (b.x < BALL_R) {

      b.x = BALL_R;
      b.vx = Math.abs(b.vx) * 0.96;
    }

    if (
      b.x >
      TABLE_W - BALL_R
    ) {

      b.x =
        TABLE_W - BALL_R;

      b.vx =
        -Math.abs(b.vx) * 0.96;
    }

    if (b.y < BALL_R) {

      b.y = BALL_R;
      b.vy = Math.abs(b.vy) * 0.96;
    }

    if (
      b.y >
      TABLE_H - BALL_R
    ) {

      b.y =
        TABLE_H - BALL_R;

      b.vy =
        -Math.abs(b.vy) * 0.96;
    }
  }

  /*
    Colisões bola x bola.
  */

  for (
    let i = 0;
    i < g.balls.length;
    i++
  ) {

    const a = g.balls[i];

    if (a.pocketed) continue;

    for (
      let j = i + 1;
      j < g.balls.length;
      j++
    ) {

      const b = g.balls[j];

      if (b.pocketed) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;

      let dist =
        Math.hypot(dx, dy);

      const min =
        BALL_R * 2;

      if (dist === 0) {

        dx = min;
        dy = 0;
        dist = min;
      }

      if (dist < min) {

        const nx =
          dx / dist;

        const ny =
          dy / dist;

        const overlap =
          min - dist;

        /*
          Afasta as bolas.
        */

        a.x -=
          nx *
          overlap /
          2;

        a.y -=
          ny *
          overlap /
          2;

        b.x +=
          nx *
          overlap /
          2;

        b.y +=
          ny *
          overlap /
          2;

        /*
          Impulso.
        */

        const rvx =
          b.vx - a.vx;

        const rvy =
          b.vy - a.vy;

        const relativeVelocity =
          rvx * nx +
          rvy * ny;

        if (
          relativeVelocity < 0
        ) {

          const impulse =
            -relativeVelocity *
            0.985;

          a.vx -=
            impulse * nx;

          a.vy -=
            impulse * ny;

          b.vx +=
            impulse * nx;

          b.vy +=
            impulse * ny;
        }
      }
    }
  }

  /*
    Atrito.
  */

  const damp =
    Math.exp(
      -FRICTION * DT
    );

  for (const b of g.balls) {

    if (b.pocketed) continue;

    b.vx *= damp;
    b.vy *= damp;

    if (
      speed(b) < 0.006
    ) {

      b.vx = 0;
      b.vy = 0;
    }
  }
}

/* =========================================================
   BOLAS NOVAS QUE CAÍRAM
========================================================= */

function newPocketed(g) {

  return g.balls
    .filter(
      b =>
        b.pocketed &&
        !g.beforePocketed.includes(
          b.id
        )
    )
    .map(
      b => b.id
    );
}

/* =========================================================
   BOLAS RESTANTES DO GRUPO
========================================================= */

function remainingType(
  g,
  type,
  userId
) {

  const own =
    g.groups.p1?.userId === userId
      ? g.groups.p1.type
      : g.groups.p2?.userId === userId
        ? g.groups.p2.type
        : null;

  if (!own) return true;

  return g.balls.some(
    b =>
      !b.pocketed &&
      colors[b.id] === own
  );
}

/* =========================================================
   GRUPO DO JOGADOR
========================================================= */

function groupForUser(
  g,
  uid
) {

  if (
    g.groups.p1?.userId === uid
  ) {
    return g.groups.p1.type;
  }

  if (
    g.groups.p2?.userId === uid
  ) {
    return g.groups.p2.type;
  }

  return null;
}

/* =========================================================
   FINALIZAR NO BANCO
========================================================= */

function finishDb(
  matchId,
  winner
) {

  const m = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(matchId);

  if (
    !m ||
    m.status !== 'active'
  ) {
    return;
  }

  const prize =
    m.stake * 2;

  const loser =
    winner === m.p1
      ? m.p2
      : m.p1;

  const run = db.transaction(() => {

    /*
      Prêmio.
    */

    db.prepare(`
      UPDATE users
      SET
        chips=chips+?,
        wins=wins+1
      WHERE id=?
    `).run(
      prize,
      winner
    );

    /*
      Derrota.
    */

    db.prepare(`
      UPDATE users
      SET losses=losses+1
      WHERE id=?
    `).run(
      loser
    );

    /*
      Histórico financeiro.
    */

    tx(
      winner,
      prize,
      'credit',
      'Prêmio da vitória'
    );

    /*
      Finaliza partida.
    */

    db.prepare(`
      UPDATE matches
      SET
        status='finished',
        winner=?
      WHERE id=?
    `).run(
      winner,
      matchId
    );
  });

  run();

  /*
    Atualiza carteira dos jogadores.
  */

  const m2 = db.prepare(`
    SELECT *
    FROM matches
    WHERE id=?
  `).get(matchId);

  if (m2) {

    io.to('u:' + m2.p1).emit(
      'wallet',
      {
        chips: user(m2.p1)?.chips
      }
    );

    io.to('u:' + m2.p2).emit(
      'wallet',
      {
        chips: user(m2.p2)?.chips
      }
    );
  }
}

/* =========================================================
   FINAL DA TACADA
========================================================= */

function endTurn(g) {

  const pocketed =
    newPocketed(g);

  const uid =
    g.currentPlayer;

  const cuePocketed =
    pocketed.includes(0);

  const eight =
    pocketed.includes(8);

  const object =
    pocketed.filter(
      id =>
        id !== 0 &&
        id !== 8
    );

  let shooterType =
    groupForUser(
      g,
      uid
    );

  /*
    Define os grupos na primeira bola
    válida encaçapada.
  */

  if (
    !g.groups.p1 &&
    !g.groups.p2 &&
    object.length
  ) {

    const t =
      colors[object[0]];

    if (uid === g.p1) {

      g.groups.p1 = {
        userId: g.p1,
        type: t
      };

      g.groups.p2 = {
        userId: g.p2,
        type:
          t === 'solid'
            ? 'stripe'
            : 'solid'
      };

    } else {

      g.groups.p2 = {
        userId: g.p2,
        type: t
      };

      g.groups.p1 = {
        userId: g.p1,
        type:
          t === 'solid'
            ? 'stripe'
            : 'solid'
      };
    }

    shooterType = t;
  }

  /*
    Bola 8.
  */

  if (eight) {

    const legal =
      shooterType &&
      !remainingType(
        g,
        shooterType,
        uid
      );

    g.winner =
      legal && !cuePocketed
        ? uid
        : (
            uid === g.p1
              ? g.p2
              : g.p1
          );

    finishDb(
      g.matchId,
      g.winner
    );

    return true;
  }

  /*
    Saída da tacada inicial.
  */

  if (g.breakShot) {

    g.breakShot = false;

    if (
      object.length === 0
    ) {

      g.currentPlayer =
        uid === g.p1
          ? g.p2
          : g.p1;

    } else {

      g.currentPlayer =
        uid;
    }

    /*
      Reposiciona branca se caiu.
    */

    if (cuePocketed) {

      const cue =
        g.balls.find(
          b => b.id === 0
        );

      if (cue) {

        cue.pocketed = false;

        cue.x = 0.36;
        cue.y = 0.5;

        cue.vx = 0;
        cue.vy = 0;
      }
    }

    return false;
  }

  /*
    Verifica bola do próprio grupo.
  */

  const legalOwn =
    object.some(
      id =>
        shooterType &&
        colors[id] === shooterType
    );

  /*
    Falta.
  */

  const foul =
    cuePocketed ||
    (
      shooterType &&
      object.some(
        id =>
          colors[id] !== shooterType
      )
    );

  /*
    Se encaçapou corretamente,
    continua jogando.

    Caso contrário,
    passa para o adversário.
  */

  if (
    !foul &&
    legalOwn
  ) {

    g.currentPlayer =
      uid;

  } else {

    g.currentPlayer =
      uid === g.p1
        ? g.p2
        : g.p1;
  }

  /*
    Se a branca caiu,
    recoloca na mesa.
  */

  if (cuePocketed) {

    const cue =
      g.balls.find(
        b => b.id === 0
      );

    if (cue) {

      cue.pocketed = false;

      cue.x = 0.36;
      cue.y = 0.5;

      cue.vx = 0;
      cue.vy = 0;
    }
  }

  return false;
}

/* =========================================================
   EXECUTAR TACADA
========================================================= */

function runShot(
  g,
  angle,
  power
) {

  const cue =
    g.balls.find(
      b => b.id === 0
    );

  if (!cue) return;

  /*
    Velocidade da branca.
  */

  cue.vx =
    Math.cos(angle) *
    MAX_SPEED *
    power;

  cue.vy =
    Math.sin(angle) *
    MAX_SPEED *
    power;

  /*
    Guarda bolas que já estavam
    encaçapadas antes da tacada.
  */

  g.beforePocketed =
    g.balls
      .filter(
        b => b.pocketed
      )
      .map(
        b => b.id
      );

  g.moving = true;

  broadcastGame(g);

  let safety = 0;

  const timer =
    setInterval(() => {

      /*
        Quatro passos de física
        por atualização.
      */

      for (
        let i = 0;
        i < 4;
        i++
      ) {

        physicsStep(g);
      }

      safety++;

      /*
        Atualiza os jogadores
        frequentemente.
      */

      if (
        safety % 2 === 0
      ) {

        broadcastGame(g);
      }

      /*
        Terminou a tacada.
      */

      if (
        !anyMoving(g) ||
        safety > 900
      ) {

        clearInterval(timer);

        g.moving = false;

        endTurn(g);

        broadcastGame(g);

        /*
          Vitória.
        */

        if (g.winner) {

          io.to(
            'm:' + g.matchId
          ).emit(
            'gameOver',
            {
              matchId: g.matchId,
              winner: g.winner
            }
          );

        } else {

          /*
            Novo turno.
          */

          io.to(
            'm:' + g.matchId
          ).emit(
            'turn',
            {
              matchId: g.matchId,
              currentPlayer:
                g.currentPlayer
            }
          );
        }
      }

    }, 16);
}

/* =========================================================
   SOCKET.IO - AUTENTICAÇÃO
========================================================= */

io.use((socket, next) => {

  try {

    const token =
      socket.handshake
        ?.auth
        ?.token;

    if (!token) {

      return next(
        new Error(
          'Não autenticado'
        )
      );
    }

    socket.user =
      jwt.verify(
        token,
        SECRET
      );

    next();

  } catch (e) {

    next(
      new Error(
        'Não autenticado'
      )
    );
  }
});

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
  'connection',
  socket => {

    /*
      Sala pessoal do usuário.
    */

    socket.join(
      'u:' + socket.user.id
    );

    /* =====================================================
       ENTRAR NA PARTIDA

       Aceita:
       joinMatch
       join
    ===================================================== */

    const joinMatch = matchId => {

      if (!matchId) return;

      const id =
        String(matchId);

      const m =
        db.prepare(`
          SELECT *
          FROM matches
          WHERE id=?
        `).get(id);

      if (
        !m ||
        ![m.p1, m.p2].includes(
          socket.user.id
        )
      ) {
        return;
      }

      socket.join(
        'm:' + id
      );

      /*
        Só entra no jogo ativo.
      */

      if (
        m.status !== 'active'
      ) {
        return;
      }

      /*
        Recupera o jogo existente
        ou cria um novo.
      */

      let g =
        games.get(id);

      if (!g) {

        g = newGame(m);

        games.set(
          id,
          g
        );
      }

      /*
        Envia estado imediatamente.
      */

      socket.emit(
        'gameState',
        publicGame(g)
      );
    };

    /*
      Novo game.js.
    */

    socket.on(
      'joinMatch',
      joinMatch
    );

    /*
      Compatibilidade com versão anterior.
    */

    socket.on(
      'join',
      joinMatch
    );

    /* =====================================================
       TACADA
    ===================================================== */

    socket.on(
      'shot',
      data => {

        if (
          !data ||
          !data.matchId
        ) {
          return;
        }

        const matchId =
          String(data.matchId);

        const g =
          games.get(matchId);

        if (!g) return;

        /*
          Não permite tacada durante
          outra tacada.
        */

        if (
          g.winner ||
          g.moving
        ) {
          return;
        }

        /*
          Confirma jogador.
        */

        if (
          ![
            g.p1,
            g.p2
          ].includes(
            socket.user.id
          )
        ) {
          return;
        }

        /*
          Confirma turno.
        */

        if (
          g.currentPlayer !==
          socket.user.id
        ) {
          return;
        }

        const angle =
          Number(data.angle);

        const power =
          clampServer(
            Number(data.power),
            0.08,
            1
          );

        if (
          !Number.isFinite(angle) ||
          !Number.isFinite(power)
        ) {
          return;
        }

        runShot(
          g,
          angle,
          power
        );
      }
    );

    /* =====================================================
       SAIR DA PARTIDA
    ===================================================== */

    socket.on(
      'leaveMatch',
      matchId => {

        if (!matchId) return;

        socket.leave(
          'm:' + String(matchId)
        );
      }
    );

    /*
      Compatibilidade com versão anterior.
    */

    socket.on(
      'leave',
      matchId => {

        if (!matchId) return;

        socket.leave(
          'm:' + String(matchId)
        );
      }
    );
  }
);

/* =========================================================
   LIMITADOR
========================================================= */

function clampServer(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

/* =========================================================
   LIMPEZA DE PARTIDAS FINALIZADAS
========================================================= */

setInterval(() => {

  for (
    const [matchId, g]
    of games
  ) {

    if (
      g.winner
    ) {

      /*
        Mantém o resultado por
        um pequeno período para
        os jogadores receberem
        o gameOver.
      */

      setTimeout(() => {

        const current =
          games.get(matchId);

        if (
          current === g
        ) {

          games.delete(
            matchId
          );
        }

      }, 30000);
    }
  }

}, 10000);

/* =========================================================
   SERVIDOR
========================================================= */

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      'Sinuca Arena GK online na porta ' +
      PORT
    );
  }
);
