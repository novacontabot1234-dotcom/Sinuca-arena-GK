const express=require('express');
const http=require('http');
const path=require('path');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Database=require('better-sqlite3');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const db=new Database('arena.db');

const SECRET=process.env.JWT_SECRET||'CHANGE_THIS_SECRET';

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

db.pragma('journal_mode=WAL');

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

/* CRIA O ADM AUTOMATICAMENTE */
if(!db.prepare('SELECT id FROM users WHERE username=?').get('admin')){
  const h=bcrypt.hashSync('1234',10);

  const r=db.prepare(
    'INSERT INTO users(username,display_name,password_hash,chips,is_admin) VALUES(?,?,?,?,1)'
  ).run(
    'admin',
    'Administrador',
    h,
    5000
  );

  db.prepare(
    'INSERT INTO transactions(user_id,amount,type,description) VALUES(?,?,?,?)'
  ).run(
    r.lastInsertRowid,
    5000,
    'credit',
    'Saldo inicial do ADM'
  );
}

const user=id=>db.prepare(
  'SELECT id,username,display_name,chips,wins,losses,is_admin FROM users WHERE id=?'
).get(id);

const auth=(req,res,next)=>{
  try{
    req.u=jwt.verify(
      (req.headers.authorization||'').replace('Bearer ',''),
      SECRET
    );
    next();
  }catch(e){
    res.status(401).json({error:'Não autenticado'});
  }
};

const tok=u=>jwt.sign(
  {id:u.id,admin:!!u.is_admin},
  SECRET,
  {expiresIn:'7d'}
);

const tx=(id,a,t,d)=>db.prepare(
  'INSERT INTO transactions(user_id,amount,type,description) VALUES(?,?,?,?)'
).run(id,a,t,d);


/* CADASTRO */
app.post('/api/register',(q,s)=>{
  const {username,displayName,password}=q.body;

  if(!username||!displayName||!password||password.length<4)
    return s.status(400).json({
      error:'Preencha os dados corretamente.'
    });

  try{
    const r=db.prepare(
      'INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)'
    ).run(
      username.toLowerCase().trim(),
      displayName.trim().slice(0,30),
      bcrypt.hashSync(password,10)
    );

    tx(
      r.lastInsertRowid,
      100,
      'credit',
      'Bônus de cadastro'
    );

    const u=user(r.lastInsertRowid);

    s.json({
      token:tok(u),
      user:u
    });

  }catch(e){
    s.status(400).json({
      error:'Usuário já existe.'
    });
  }
});


/* LOGIN */
app.post('/api/login',(q,s)=>{
  const u=db.prepare(
    'SELECT * FROM users WHERE username=?'
  ).get(
    String(q.body.username||'').toLowerCase().trim()
  );

  if(!u||!bcrypt.compareSync(q.body.password||'',u.password_hash))
    return s.status(401).json({
      error:'Login inválido.'
    });

  s.json({
    token:tok(u),
    user:user(u.id)
  });
});


/* USUÁRIO LOGADO */
app.get('/api/me',auth,(q,s)=>{
  s.json({
    user:user(q.u.id)
  });
});


/* JOGADORES */
app.get('/api/players',auth,(q,s)=>{
  s.json({
    players:db.prepare(
      'SELECT id,display_name,chips,wins,losses FROM users WHERE id!=? ORDER BY wins DESC'
    ).all(q.u.id)
  });
});


/* HISTÓRICO */
app.get('/api/history',auth,(q,s)=>{
  s.json({
    matches:db.prepare(`
      SELECT
        m.*,
        a.display_name p1_name,
        b.display_name p2_name,
        w.display_name winner_name
      FROM matches m
      JOIN users a ON a.id=m.p1
      JOIN users b ON b.id=m.p2
      LEFT JOIN users w ON w.id=m.winner
      WHERE m.p1=? OR m.p2=?
      ORDER BY m.created_at DESC
      LIMIT 50
    `).all(q.u.id,q.u.id),

    transactions:db.prepare(
      'SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100'
    ).all(q.u.id)
  });
});


/* DESAFIO */
app.post('/api/challenge',auth,(q,s)=>{
  const stake=Math.floor(Number(q.body.stake));
  const p2=user(Number(q.body.opponent));
  const p1=user(q.u.id);

  if(!p2||stake<10||p1.chips<stake||p2.chips<stake)
    return s.status(400).json({
      error:'Aposta ou saldo inválido.'
    });

  const id=crypto.randomUUID();

  db.prepare(
    'INSERT INTO matches(id,p1,p2,stake,status) VALUES(?,?,?,?,?)'
  ).run(
    id,
    p1.id,
    p2.id,
    stake,
    'pending'
  );

  io.emit('challenge',{
    matchId:id,
    to:p2.id
  });

  s.json({
    matchId:id
  });
});


/* CONSULTAR PARTIDA */
app.get('/api/match/:id',auth,(q,s)=>{
  const m=db.prepare(
    'SELECT * FROM matches WHERE id=?'
  ).get(q.params.id);

  if(!m||![m.p1,m.p2].includes(q.u.id))
    return s.status(404).json({
      error:'Partida não encontrada'
    });

  const p1=user(m.p1);
  const p2=user(m.p2);

  s.json({
    match:{
      ...m,
      p1:p1?.display_name||m.p1,
      p2:p2?.display_name||m.p2
    }
  });
});


/* ACEITAR PARTIDA */
app.post('/api/match/:id/accept',auth,(q,s)=>{
  const m=db.prepare(
    'SELECT * FROM matches WHERE id=?'
  ).get(q.params.id);

  if(!m||m.p2!==q.u.id||m.status!=='pending')
    return s.status(400).json({
      error:'Desafio inválido'
    });

  const a=user(m.p1);
  const b=user(m.p2);

  if(a.chips<m.stake||b.chips<m.stake)
    return s.status(400).json({
      error:'Saldo insuficiente'
    });

  const run=db.transaction(()=>{
    db.prepare(
      'UPDATE users SET chips=chips-? WHERE id IN (?,?)'
    ).run(
      m.stake,
      a.id,
      b.id
    );

    tx(
      a.id,
      -m.stake,
      'debit',
      'Aposta'
    );

    tx(
      b.id,
      -m.stake,
      'debit',
      'Aposta'
    );

    db.prepare(
      "UPDATE matches SET status='active' WHERE id=?"
    ).run(m.id);
  });

  run();

  io.to('m:'+m.id).emit('started');

  s.json({
    ok:true
  });
});


/* FINALIZAR PARTIDA */
app.post('/api/match/:id/finish',auth,(q,s)=>{
  const m=db.prepare(
    'SELECT * FROM matches WHERE id=?'
  ).get(q.params.id);

  const w=Number(q.body.winner);

  if(
    !m||
    m.status!=='active'||
    ![m.p1,m.p2].includes(q.u.id)||
    ![m.p1,m.p2].includes(w)
  )
    return s.status(400).json({
      error:'Partida inválida'
    });

  const prize=m.stake*2;
  const l=w===m.p1?m.p2:m.p1;

  const run=db.transaction(()=>{
    db.prepare(
      'UPDATE users SET chips=chips+?,wins=wins+1 WHERE id=?'
    ).run(
      prize,
      w
    );

    db.prepare(
      'UPDATE users SET losses=losses+1 WHERE id=?'
    ).run(l);

    tx(
      w,
      prize,
      'credit',
      'Prêmio da vitória'
    );

    db.prepare(
      "UPDATE matches SET status='finished',winner=? WHERE id=?"
    ).run(
      w,
      m.id
    );
  });

  run();

  io.to('m:'+m.id).emit('finished',{
    winner:w
  });

  s.json({
    ok:true
  });
});


/* PAINEL DO ADM */
app.get('/api/admin/users',auth,(q,s)=>{
  if(!q.u.admin)
    return s.status(403).json({
      error:'ADM somente'
    });

  s.json({
    users:db.prepare(
      'SELECT id,username,display_name,chips,wins,losses FROM users ORDER BY id DESC'
    ).all()
  });
});


/* LIBERAR / RETIRAR FICHAS */
app.post('/api/admin/chips',auth,(q,s)=>{
  if(!q.u.admin)
    return s.status(403).json({
      error:'ADM somente'
    });

  const id=Number(q.body.userId);
  const a=Math.floor(Number(q.body.amount));
  const add=q.body.action==='add';
  const u=user(id);

  if(!u||a<=0||(!add&&u.chips<a))
    return s.status(400).json({
      error:'Operação inválida'
    });

  db.prepare(
    'UPDATE users SET chips=chips+? WHERE id=?'
  ).run(
    add?a:-a,
    id
  );

  tx(
    id,
    add?a:-a,
    add?'credit':'debit',
    add?'Fichas liberadas pelo ADM':'Fichas retiradas pelo ADM'
  );

  io.emit('wallet');

  s.json({
    user:user(id)
  });
});


/* SOCKET.IO */
io.use((socket,next)=>{
  try{
    const token=socket.handshake.auth?.token;

    if(!token)
      return next(new Error('Não autenticado'));

    socket.user=jwt.verify(token,SECRET);

    next();
  }catch(e){
    next(new Error('Não autenticado'));
  }
});


io.on('connection',socket=>{

  socket.on('join',matchId=>{
    socket.join('m:'+matchId);
  });

  socket.on('shot',data=>{
    if(!data||!data.matchId)
      return;

    io.to('m:'+data.matchId).emit('shot',{
      userId:socket.user.id,
      power:Number(data.power)||0
    });
  });

});


/* SERVIDOR */
const PORT=process.env.PORT||3000;

server.listen(PORT,'0.0.0.0',()=>{
  console.log('Sinuca Arena GK online na porta '+PORT);
});
