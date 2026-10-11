
const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gk2026-development-secret-change-in-production';

const db = new Database(path.join(__dirname, 'arena.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    chips INTEGER NOT NULL DEFAULT 100,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    p1 INTEGER NOT NULL,
    p2 INTEGER NOT NULL,
    stake INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    winner INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function user(id) {
  return db.prepare(`
    SELECT id, username, display_name, chips, wins, losses, is_admin
    FROM users WHERE id = ?
  `).get(id);
}

function transaction(userId, amount, type, description = '') {
  db.prepare(`
    INSERT INTO transactions (user_id, amount, type, description)
    VALUES (?, ?, ?, ?)
  `).run(userId, amount, type, description);
}

function tokenFor(u) {
  return jwt.sign(
    { id: u.id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Cria o administrador somente quando ainda não existe.
// Não altera a senha de um administrador já cadastrado.
if (!db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get()) {
  const hash = bcrypt.hashSync('gk2026', 12);
  db.prepare(`
    INSERT INTO users
      (username, display_name, password_hash, chips, is_admin)
    VALUES (?, ?, ?, ?, 1)
  `).run('admin', 'ADM GK', hash, 5000);

  console.log('Administrador inicial criado: admin');
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const currentUser = user(decoded.id);

    if (!currentUser) {
      return res.status(401).json({ error: 'Conta não encontrada.' });
    }

    req.u = currentUser;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.u || !req.u.is_admin) {
    return res.status(403).json({ error: 'Acesso exclusivo do ADM.' });
  }
  next();
}

function validInteger(value, min = 0, max = 1000000000) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function publicMatch(m) {
  if (!m) return null;

  const p1 = user(m.p1);
  const p2 = user(m.p2);

  return {
    id: m.id,
    p1: m.p1,
    p2: m.p2,
    p1_name: p1?.display_name || 'Jogador 1',
    p2_name: p2?.display_name || 'Jogador 2',
    stake: m.stake,
    status: m.status,
    winner: m.winner,
    created_at: m.created_at
  };
}

// --------------------------------------------------
// LOGIN E CADASTRO
// --------------------------------------------------

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      error: 'O usuário deve ter de 3 a 20 caracteres: letras, números ou _.'
    });
  }

  if (displayName.length < 2 || displayName.length > 30) {
    return res.status(400).json({ error: 'Informe um nome de 2 a 30 caracteres.' });
  }

  if (password.length < 4 || password.length > 100) {
    return res.status(400).json({ error: 'A senha deve ter de 4 a 100 caracteres.' });
  }

  try {
    const hash = bcrypt.hashSync(password, 12);

    const result = db.prepare(`
      INSERT INTO users
        (username, display_name, password_hash, chips)
      VALUES (?, ?, ?, 100)
    `).run(username, displayName, hash);

    transaction(result.lastInsertRowid, 100, 'bonus', 'Bônus de cadastro');

    const u = user(result.lastInsertRowid);

    return res.json({
      token: tokenFor(u),
      user: u,
      me: u
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Esse nome de usuário já existe.' });
    }

    console.error('Erro no cadastro:', error);
    return res.status(500).json({ error: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const found = db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).get(username);

  if (!found || !bcrypt.compareSync(password, found.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  const u = user(found.id);

  return res.json({
    token: tokenFor(u),
    user: u,
    me: u
  });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.u, me: req.u });
});

// --------------------------------------------------
// JOGADORES E HISTÓRICO
// --------------------------------------------------

app.get('/api/players', auth, (req, res) => {
  const players = db.prepare(`
    SELECT id, username, display_name, chips, wins, losses, is_admin
    FROM users
    WHERE id != ?
    ORDER BY display_name COLLATE NOCASE
  `).all(req.u.id);

  res.json({ players });
});

app.get('/api/history', auth, (req, res) => {
  const history = db.prepare(`
    SELECT m.*,
      u1.display_name AS p1_name,
      u2.display_name AS p2_name
    FROM matches m
    JOIN users u1 ON u1.id = m.p1
    JOIN users u2 ON u2.id = m.p2
    WHERE (m.p1 = ? OR m.p2 = ?)
      AND m.status IN ('finished', 'cancelled')
    ORDER BY m.id DESC
    LIMIT 100
  `).all(req.u.id, req.u.id);

  res.json({ history, matches: history });
});

// --------------------------------------------------
// ESTADO DAS PARTIDAS
// --------------------------------------------------

const TABLE_W = 1.75;
const TABLE_H = 1;
const BALL_R = 0.0255;
const POCKET_R = 0.065;
const FRICTION = 2.25;
const MAX_SPEED = 1.55;
const DT = 1 / 120;

const pockets = [
  { x: 0, y: 0 },
  { x: TABLE_W / 2, y: 0 },
  { x: TABLE_W, y: 0 },
  { x: 0, y: TABLE_H },
  { x: TABLE_W / 2, y: TABLE_H },
  { x: TABLE_W, y: TABLE_H }
];

const games = new Map();
const runningTimers = new Map();

function ballColor(id) {
  if (id === 0) return '#f5f0df';
  if (id === 8) return '#111111';
  if ([1, 9].includes(id)) return '#f0c92e';
  if ([2, 10].includes(id)) return '#315fd4';
  if ([3, 11].includes(id)) return '#d93636';
  if ([4, 12].includes(id)) return '#8d4bc4';
  if ([5, 13].includes(id)) return '#ed8435';
  if ([6, 14].includes(id)) return '#2e9a5b';
  return '#a92f36';
}

function makeBalls() {
  const balls = [{
    id: 0,
    x: 0.36,
    y: 0.5,
    vx: 0,
    vy: 0,
    pocketed: false
  }];

  const order = [1, 10, 2, 11, 8, 3, 12, 4, 13, 5, 14, 6, 15, 7, 9];
  const apexX = 1.26;
  const spacing = BALL_R * 2.04;
  let index = 0;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = order[index++];

      balls.push({
        id,
        x: apexX + row * spacing * 0.8660254,
        y: 0.5 + (col - row / 2) * spacing,
        vx: 0,
        vy: 0,
        pocketed: false
      });
    }
  }

  return balls;
}

function newGame(m) {
  return {
    matchId: m.id,
    p1: m.p1,
    p2: m.p2,
    stake: m.stake,
    currentPlayer: m.p1,
    moving: false,
    winner: null,
    groups: { [m.p1]: null, [m.p2]: null },
    breakShot: true,
    balls: makeBalls(),
    beforePocketed: [],
    shotCount: 0
  };
}

function publicGame(g) {
  return {
    matchId: g.matchId,
    p1: g.p1,
    p2: g.p2,
    stake: g.stake,
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

function broadcastGame(g) {
  io.to(`m:${g.matchId}`).emit('gameState', publicGame(g));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function physicsStep(g) {
  for (const b of g.balls) {
    if (b.pocketed) continue;

    const speed = Math.hypot(b.vx, b.vy);

    if (speed > 0) {
      const newSpeed = Math.max(0, speed - FRICTION * DT);
      const ratio = speed > 0 ? newSpeed / speed : 0;
      b.vx *= ratio;
      b.vy *= ratio;
    }

    b.x += b.vx * DT;
    b.y += b.vy * DT;

    for (const p of pockets) {
      if (distance(b, p) < POCKET_R) {
        b.pocketed = true;
        b.vx = 0;
        b.vy = 0;
        break;
      }
    }

    if (b.pocketed) continue;

    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx) * 0.94;
    }

    if (b.x > TABLE_W - BALL_R) {
      b.x = TABLE_W - BALL_R;
      b.vx = -Math.abs(b.vx) * 0.94;
    }

    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy) * 0.94;
    }

    if (b.y > TABLE_H - BALL_R) {
      b.y = TABLE_H - BALL_R;
      b.vy = -Math.abs(b.vy) * 0.94;
    }
  }

  for (let i = 0; i < g.balls.length; i++) {
    const a = g.balls[i];
    if (a.pocketed) continue;

    for (let j = i + 1; j < g.balls.length; j++) {
      const b = g.balls[j];
      if (b.pocketed) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minDist = BALL_R * 2;

      if (dist >= minDist) continue;

      if (dist < 0.000001) {
        dx = 0.0001;
        dy = 0;
        dist = 0.0001;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;

      a.x -= nx * overlap / 2;
      a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2;
      b.y += ny * overlap / 2;

      const relVx = a.vx - b.vx;
      const relVy = a.vy - b.vy;
      const relative = relVx * nx + relVy * ny;

      if (relative > 0) {
        a.vx -= relative * nx;
        a.vy -= relative * ny;
        b.vx += relative * nx;
        b.vy += relative * ny;
      }
    }
  }
}

function anyMoving(g) {
  return g.balls.some(b =>
    !b.pocketed && Math.hypot(b.vx, b.vy) > 0.012
  );
}

function finishMatch(g, winnerId) {
  if (g.winner !== null) return false;

  const m = db.prepare(
    'SELECT * FROM matches WHERE id = ?'
  ).get(g.matchId);

  if (!m || m.status !== 'active') return false;

  const loserId = winnerId === m.p1 ? m.p2 : m.p1;
  const prize = m.stake * 2;

  const complete = db.transaction(() => {
    const updated = db.prepare(`
      UPDATE matches
      SET status = 'finished', winner = ?
      WHERE id = ? AND status = 'active'
    `).run(winnerId, m.id);

    if (updated.changes !== 1) return false;

    db.prepare(
      'UPDATE users SET chips = chips + ?, wins = wins + 1 WHERE id = ?'
    ).run(prize, winnerId);

    db.prepare(
      'UPDATE users SET losses = losses + 1 WHERE id = ?'
    ).run(loserId);

    transaction(winnerId, prize, 'prize', `Vitória na partida ${m.id}`);

    return true;
  });

  if (!complete()) return false;

  g.winner = winnerId;
  g.moving = false;

  const winner = user(winnerId);
  const loser = user(loserId);

  io.to(`m:${m.id}`).emit('gameOver', {
    matchId: m.id,
    winner: winnerId,
    winnerName: winner?.display_name || 'Vencedor',
    loserName: loser?.display_name || 'Adversário',
    prize
  });

  io.to(`u:${winnerId}`).emit('wallet', { chips: winner?.chips });
  io.to(`u:${loserId}`).emit('wallet', { chips: loser?.chips });

  return true;
}

function endTurn(g) {
  const shooter = g.currentPlayer;
  const opponent = shooter === g.p1 ? g.p2 : g.p1;

  const newlyPocketed = g.balls.filter(
    b => b.pocketed && !g.beforePocketed.includes(b.id)
  );

  const cueBall = g.balls.find(b => b.id === 0);
  const scratched = !!cueBall?.pocketed;

  const objectBalls = newlyPocketed.filter(b => b.id !== 0);
  const eightBallPocketed = objectBalls.some(b => b.id === 8);

  let foul = scratched;

  if (eightBallPocketed) {
    const group = g.groups[shooter];

    const remaining = group
      ? g.balls.filter(b =>
          !b.pocketed &&
          (group === 'solid' ? b.id >= 1 && b.id <= 7 : b.id >= 9 && b.id <= 15)
        )
      : [];

    const won = !foul && group !== null && remaining.length === 0;

    if (won) {
      finishMatch(g, shooter);
    } else {
      finishMatch(g, opponent);
    }

    return;
  }

  if (!g.breakShot && g.groups[shooter]) {
    const own = g.groups[shooter];

    if (objectBalls.some(b =>
      own === 'solid' ? b.id >= 9 && b.id <= 15 : b.id >= 1 && b.id <= 7
    )) {
      foul = true;
    }
  }

  if (g.breakShot && objectBalls.length > 0 && !foul) {
    g.breakShot = false;

    const first = objectBalls.find(b => b.id !== 8);

    if (first && !g.groups[g.p1] && !g.groups[g.p2]) {
      const group = first.id <= 7 ? 'solid' : 'stripe';
      g.groups[shooter] = group;
      g.groups[opponent] = group === 'solid' ? 'stripe' : 'solid';
    }
  } else {
    g.breakShot = false;
  }

  if (scratched && cueBall) {
    cueBall.pocketed = false;
    cueBall.x = 0.36;
    cueBall.y = 0.5;
    cueBall.vx = 0;
    cueBall.vy = 0;
  }

  const ownGroup = g.groups[shooter];

  const ownPocketed = ownGroup
    ? objectBalls.some(b =>
        ownGroup === 'solid' ? b.id >= 1 && b.id <= 7 : b.id >= 9 && b.id <= 15
      )
    : objectBalls.length > 0;

  if (foul || !ownPocketed) {
    g.currentPlayer = opponent;
  }

  g.moving = false;
}

function runShot(g, angle, power) {
  const cue = g.balls.find(b => b.id === 0);

  if (!cue || cue.pocketed || g.winner !== null) return;

  cue.vx = Math.cos(angle) * MAX_SPEED * power;
  cue.vy = Math.sin(angle) * MAX_SPEED * power;

  g.beforePocketed = g.balls
    .filter(b => b.pocketed)
    .map(b => b.id);

  g.moving = true;
  g.shotCount++;

  broadcastGame(g);

  const startedAt = Date.now();
  let ticks = 0;

  const timer = setInterval(() => {
    if (!games.has(g.matchId) || g.winner !== null) {
      clearInterval(timer);
      runningTimers.delete(g.matchId);
      return;
    }

    for (let i = 0; i < 4; i++) {
      physicsStep(g);
    }

    ticks++;

    if (ticks % 2 === 0) {
      broadcastGame(g);
    }

    if (!anyMoving(g) || Date.now() - startedAt > 30000) {
      clearInterval(timer);
      runningTimers.delete(g.matchId);

      for (const b of g.balls) {
        if (Math.hypot(b.vx, b.vy) < 0.012) {
          b.vx = 0;
          b.vy = 0;
        }
      }

      endTurn(g);
      broadcastGame(g);

      if (g.winner === null) {
        io.to(`m:${g.matchId}`).emit('turn', {
          currentPlayer: g.currentPlayer
        });
      }

      return;
    }
  }, 16);

  runningTimers.set(g.matchId, timer);
}

// --------------------------------------------------
// DESAFIOS
// --------------------------------------------------

app.post('/api/challenge', auth, (req, res) => {
  const opponentId = Number(req.body.opponentId ?? req.body.opponent);
  const stake = Number(req.body.stake);

  if (!validInteger(opponentId, 1) || opponentId === req.u.id) {
    return res.status(400).json({ error: 'Escolha outro jogador.' });
  }

  if (!validInteger(stake, 10, 1000000)) {
    return res.status(400).json({ error: 'A aposta deve ser de pelo menos 10 fichas.' });
  }

  const opponent = user(opponentId);

  if (!opponent) {
    return res.status(404).json({ error: 'Jogador não encontrado.' });
  }

  if (req.u.chips < stake) {
    return res.status(400).json({ error: 'Você não tem fichas suficientes.' });
  }

  if (opponent.chips < stake) {
    return res.status(400).json({ error: 'O adversário não tem fichas suficientes.' });
  }

  const result = db.prepare(`
    INSERT INTO matches (p1, p2, stake, status)
    VALUES (?, ?, ?, 'pending')
  `).run(req.u.id, opponentId, stake);

  const m = db.prepare('SELECT * FROM matches WHERE id = ?')
    .get(result.lastInsertRowid);

  io.to(`u:${opponentId}`).emit('challenge', {
    match: publicMatch(m),
    from: user(req.u.id)
  });

  res.json({ match: publicMatch(m), id: m.id });
});

app.get('/api/match/:id', auth, (req, res) => {
  const id = Number(req.params.id);

  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);

  if (!m) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  if (m.p1 !== req.u.id && m.p2 !== req.u.id) {
    return res.status(403).json({ error: 'Você não participa desta partida.' });
  }

  const g = games.get(m.id);

  res.json({
    match: publicMatch(m),
    game: g ? publicGame(g) : null
  });
});

app.post('/api/match/:id/accept', auth, (req, res) => {
  const id = Number(req.params.id);

  const result = db.transaction(() => {
    const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);

    if (!m) return { error: 'Partida não encontrada.', code: 404 };

    if (m.p2 !== req.u.id) {
      return { error: 'Somente o jogador convidado pode aceitar.', code: 403 };
    }

    if (m.status !== 'pending') {
      return { error: 'Este desafio não está mais disponível.', code: 409 };
    }

    const p1 = user(m.p1);
    const p2 = user(m.p2);

    if (!p1 || !p2) {
      return { error: 'Um dos jogadores não existe.', code: 400 };
    }

    if (p1.chips < m.stake || p2.chips < m.stake) {
      db.prepare(`
        UPDATE matches SET status = 'cancelled'
        WHERE id = ? AND status = 'pending'
      `).run(id);

      return { error: 'Um dos jogadores não tem fichas suficientes.', code: 400 };
    }

    const debit1 = db.prepare(`
      UPDATE users SET chips = chips - ?
      WHERE id = ? AND chips >= ?
    `).run(m.stake, m.p1, m.stake);

    const debit2 = db.prepare(`
      UPDATE users SET chips = chips - ?
      WHERE id = ? AND chips >= ?
    `).run(m.stake, m.p2, m.stake);

    if (debit1.changes !== 1 || debit2.changes !== 1) {
      throw new Error('Saldo insuficiente durante a aceitação.');
    }

    const updated = db.prepare(`
      UPDATE matches SET status = 'active'
      WHERE id = ? AND status = 'pending'
    `).run(id);

    if (updated.changes !== 1) {
      throw new Error('O desafio já foi respondido.');
    }

    transaction(m.p1, -m.stake, 'stake', `Aposta na partida ${id}`);
    transaction(m.p2, -m.stake, 'stake', `Aposta na partida ${id}`);

    return {
      match: db.prepare('SELECT * FROM matches WHERE id = ?').get(id)
    };
  })();

  if (result.error) {
    return res.status(result.code).json({ error: result.error });
  }

  const m = result.match;

  if (!games.has(m.id)) {
    games.set(m.id, newGame(m));
  }

  const g = games.get(m.id);

  io.to(`u:${m.p1}`).emit('matchAccepted', {
    match: publicMatch(m),
    game: publicGame(g)
  });

  io.to(`u:${m.p2}`).emit('matchAccepted', {
    match: publicMatch(m),
    game: publicGame(g)
  });

  io.to(`u:${m.p1}`).emit('wallet', { chips: user(m.p1)?.chips });
  io.to(`u:${m.p2}`).emit('wallet', { chips: user(m.p2)?.chips });

  res.json({ match: publicMatch(m), game: publicGame(g) });
});

app.post('/api/match/:id/reject', auth, (req, res) => {
  const id = Number(req.params.id);

  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);

  if (!m) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  if (m.p2 !== req.u.id) {
    return res.status(403).json({ error: 'Somente o jogador convidado pode recusar.' });
  }

  const result = db.prepare(`
    UPDATE matches SET status = 'cancelled'
    WHERE id = ? AND status = 'pending'
  `).run(id);

  if (result.changes !== 1) {
    return res.status(409).json({ error: 'Este desafio já foi respondido.' });
  }

  io.to(`u:${m.p1}`).emit('challengeRejected', { matchId: id });
  res.json({ ok: true });
});

// Não permita que o navegador escolha o vencedor.
// O resultado deve ser decidido pelo motor do jogo.
app.post('/api/match/:id/finish', auth, (req, res) => {
  res.status(403).json({
    error: 'O resultado é definido pelo servidor durante a partida.'
  });
});

// --------------------------------------------------
// PAINEL ADMINISTRATIVO
// --------------------------------------------------

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, display_name, chips, wins, losses, is_admin, created_at
    FROM users
    ORDER BY id DESC
  `).all();

  res.json({ users });
});

app.post('/api/admin/chips', auth, adminOnly, (req, res) => {
  const userId = Number(req.body.userId);
  const amount = Number(req.body.amount);
  const action = String(req.body.action || 'add');

  if (!validInteger(userId, 1)) {
    return res.status(400).json({ error: 'Jogador inválido.' });
  }

  if (!validInteger(amount, 1, 100000000)) {
    return res.status(400).json({ error: 'Quantidade de fichas inválida.' });
  }

  if (!['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  const target = user(userId);

  if (!target) {
    return res.status(404).json({ error: 'Jogador não encontrado.' });
  }

  const delta = action === 'add' ? amount : -amount;

  const result = db.transaction(() => {
    const changed = action === 'add'
      ? db.prepare(`
          UPDATE users SET chips = chips + ?
          WHERE id = ?
        `).run(amount, userId)
      : db.prepare(`
          UPDATE users SET chips = chips - ?
          WHERE id = ? AND chips >= ?
        `).run(amount, userId, amount);

    if (changed.changes !== 1) return false;

    transaction(
      userId,
      delta,
      action === 'add' ? 'admin_add' : 'admin_remove',
      `Alteração pelo ADM ${req.u.username}`
    );

    return true;
  })();

  if (!result) {
    return res.status(400).json({
      error: 'O jogador não possui fichas suficientes para essa retirada.'
    });
  }

  const updatedUser = user(userId);

  io.to(`u:${userId}`).emit('wallet', { chips: updatedUser.chips });

  res.json({
    ok: true,
    user: updatedUser,
    chips: updatedUser.chips
  });
});

// --------------------------------------------------
// SOCKET.IO: JOGO ONLINE
// --------------------------------------------------

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Faça login para jogar.'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const currentUser = user(decoded.id);

    if (!currentUser) {
      return next(new Error('Jogador não encontrado.'));
    }

    socket.user = currentUser;
    next();
  } catch {
    next(new Error('Sessão inválida. Entre novamente.'));
  }
});

io.on('connection', socket => {
  const player = socket.user;

  socket.join(`u:${player.id}`);

  socket.emit('connected', {
    user: user(player.id)
  });

  socket.on('join', () => {
    socket.join(`u:${player.id}`);
  });

  socket.on('joinMatch', data => {
    const matchId = Number(data?.matchId ?? data?.id);

    if (!validInteger(matchId, 1)) return;

    const m = db.prepare('SELECT * FROM matches WHERE id = ?')
      .get(matchId);

    if (!m) return;

    if (m.p1 !== player.id && m.p2 !== player.id) return;
    if (m.status !== 'active') return;

    if (!games.has(m.id)) {
      games.set(m.id, newGame(m));
    }

    socket.join(`m:${m.id}`);

    const g = games.get(m.id);

    socket.emit('gameState', publicGame(g));
    socket.to(`m:${m.id}`).emit('playerJoined', {
      userId: player.id,
      displayName: player.display_name
    });
  });

  socket.on('shot', data => {
    const matchId = Number(data?.matchId);
    const angle = Number(data?.angle);
    const power = Number(data?.power);

    if (!validInteger(matchId, 1)) return;
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return;

    const m = db.prepare('SELECT * FROM matches WHERE id = ?')
      .get(matchId);

    if (!m || m.status !== 'active') return;
    if (m.p1 !== player.id && m.p2 !== player.id) return;

    const g = games.get(matchId);

    if (!g || g.winner !== null || g.moving) return;
    if (g.currentPlayer !== player.id) return;

    const cue = g.balls.find(b => b.id === 0);

    if (!cue || cue.pocketed) return;

    const safePower = clamp(power, 0.08, 1);

    runShot(g, angle, safePower);
  });

  socket.on('leaveMatch', data => {
    const matchId = Number(data?.matchId ?? data?.id);

    if (validInteger(matchId, 1)) {
      socket.leave(`m:${matchId}`);
    }
  });

  socket.on('disconnect', () => {
    // A desconexão não encerra nem declara um vencedor automaticamente.
  });
});

// --------------------------------------------------
// INICIALIZAÇÃO
// --------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Sinuca Arena GK' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sinuca Arena GK rodando na porta ${PORT}`);
});
