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
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE,display_name TEXT,password_hash TEXT,chips INTEGER DEFAULT 100,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,is_admin INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,p1 INTEGER,p2 INTEGER,stake INTEGER,status TEXT,winner INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,amount INTEGER,type TEXT,description TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const adminExistente=db.prepare('SELECT * FROM users WHERE username=?').get('admin');
if(!adminExistente){
  const h=bcrypt.hashSync('gk2026',10);
  const r=db.prepare('INSERT INTO users(username,display_name,password_hash,chips,is_admin) VALUES(?,?,?,?,1)').run('admin','Administrador',h,5000);
  db.prepare('INSERT INTO transactions(user_id,amount,type,description) VALUES(?,?,?,?)').run(r.lastInsertRowid,5000,'credit','Saldo inicial do ADM');
}else if(bcrypt.compareSync('1234',adminExistente.password_hash)){
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync('gk2026',10),'admin');
}

const user=id=>db.prepare('SELECT id,username,display_name,chips,wins,losses,is_admin FROM users WHERE id=?').get(id);
const auth=(req,res,next)=>{try{req.u=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),SECRET);next();}catch(e){res.status(401).json({error:'Não autenticado'});}};
const tok=u=>jwt.sign({id:u.id,admin:!!u.is_admin},SECRET,{expiresIn:'7d'});
const tx=(id,a,t,d)=>db.prepare('INSERT INTO transactions(user_id,amount,type,description) VALUES(?,?,?,?)').run(id,a,t,d);

app.post('/api/register',(q,s)=>{const {username,displayName,password}=q.body;if(!username||!displayName||!password||password.length<4)return s.status(400).json({error:'Preencha os dados corretamente.'});try{const r=db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)').run(username.toLowerCase().trim(),displayName.trim().slice(0,30),bcrypt.hashSync(password,10));tx(r.lastInsertRowid,100,'credit','Bônus de cadastro');const u=user(r.lastInsertRowid);s.json({token:tok(u),user:u});}catch(e){s.status(400).json({error:'Usuário já existe.'});}});
app.post('/api/login',(q,s)=>{const u=db.prepare('SELECT * FROM users WHERE username=?').get(String(q.body.username||'').toLowerCase().trim());if(!u||!bcrypt.compareSync(q.body.password||'',u.password_hash))return s.status(401).json({error:'Login inválido.'});s.json({token:tok(u),user:user(u.id)});});
app.get('/api/me',auth,(q,s)=>s.json({user:user(q.u.id)}));
app.get('/api/players',auth,(q,s)=>s.json({players:db.prepare('SELECT id,display_name,chips,wins,losses FROM users WHERE id!=? ORDER BY wins DESC').all(q.u.id)}));
app.get('/api/history',auth,(q,s)=>s.json({matches:db.prepare(`SELECT m.*,a.display_name p1_name,b.display_name p2_name,w.display_name winner_name FROM matches m JOIN users a ON a.id=m.p1 JOIN users b ON b.id=m.p2 LEFT JOIN users w ON w.id=m.winner WHERE m.p1=? OR m.p2=? ORDER BY m.created_at DESC LIMIT 50`).all(q.u.id,q.u.id),transactions:db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(q.u.id)}));

app.post('/api/challenge',auth,(q,s)=>{const stake=Math.floor(Number(q.body.stake)),p2=user(Number(q.body.opponent)),p1=user(q.u.id);if(!p2||p2.id===p1.id||stake<10||p1.chips<stake||p2.chips<stake)return s.status(400).json({error:'Aposta ou saldo inválido.'});const id=crypto.randomUUID();db.prepare('INSERT INTO matches(id,p1,p2,stake,status) VALUES(?,?,?,?,?)').run(id,p1.id,p2.id,stake,'pending');io.to('u:'+p2.id).emit('challenge',{matchId:id,to:p2.id});s.json({matchId:id});});

app.get('/api/match/:id',auth,(q,s)=>{const m=db.prepare('SELECT * FROM matches WHERE id=?').get(q.params.id);if(!m||![m.p1,m.p2].includes(q.u.id))return s.status(404).json({error:'Partida não encontrada'});const p1=user(m.p1),p2=user(m.p2);s.json({match:{...m,p1:p1?.display_name||m.p1,p2:p2?.display_name||m.p2,p1_id:m.p1,p2_id:m.p2}});});

app.post('/api/match/:id/accept',auth,(q,s)=>{const m=db.prepare('SELECT * FROM matches WHERE id=?').get(q.params.id);if(!m||m.p2!==q.u.id||m.status!=='pending')return s.status(400).json({error:'Desafio inválido'});const a=user(m.p1),b=user(m.p2);if(a.chips<m.stake||b.chips<m.stake)return s.status(400).json({error:'Saldo insuficiente'});const run=db.transaction(()=>{db.prepare('UPDATE users SET chips=chips-? WHERE id IN (?,?)').run(m.stake,a.id,b.id);tx(a.id,-m.stake,'debit','Aposta');tx(b.id,-m.stake,'debit','Aposta');db.prepare("UPDATE matches SET status='active' WHERE id=?").run(m.id);});run();io.to('u:'+a.id).emit('matchAccepted',{matchId:m.id});io.to('u:'+b.id).emit('matchAccepted',{matchId:m.id});s.json({ok:true});});

app.post('/api/match/:id/reject',auth,(q,s)=>{const m=db.prepare('SELECT * FROM matches WHERE id=?').get(q.params.id);if(!m||m.p2!==q.u.id||m.status!=='pending')return s.status(400).json({error:'Desafio inválido'});db.prepare("UPDATE matches SET status='rejected' WHERE id=?").run(m.id);io.to('u:'+m.p1).emit('matchRejected',{matchId:m.id});io.to('u:'+m.p2).emit('matchRejected',{matchId:m.id});s.json({ok:true});});

app.post('/api/match/:id/finish',auth,(q,s)=>{const m=db.prepare('SELECT * FROM matches WHERE id=?').get(q.params.id),w=Number(q.body.winner);if(!m||m.status!=='active'||![m.p1,m.p2].includes(q.u.id)||![m.p1,m.p2].includes(w))return s.status(400).json({error:'Partida inválida'});finishDb(m.id,w);s.json({ok:true});});

app.get('/api/admin/users',auth,(q,s)=>{if(!q.u.admin)return s.status(403).json({error:'ADM somente'});s.json({users:db.prepare('SELECT id,username,display_name,chips,wins,losses FROM users ORDER BY id DESC').all()});});
app.post('/api/admin/chips',auth,(q,s)=>{if(!q.u.admin)return s.status(403).json({error:'ADM somente'});const id=Number(q.body.userId),a=Math.floor(Number(q.body.amount)),add=q.body.action==='add',u=user(id);if(!u||a<=0||(!add&&u.chips<a))return s.status(400).json({error:'Operação inválida'});db.prepare('UPDATE users SET chips=chips+? WHERE id=?').run(add?a:-a,id);tx(id,add?a:-a,add?'credit':'debit',add?'Fichas liberadas pelo ADM':'Fichas retiradas pelo ADM');io.emit('wallet');s.json({user:user(id)});});

// ===========================
// MOTOR DE SINUCA 1V1
// ===========================
const TABLE_W=1.75,TABLE_H=1,BALL_R=.0255,POCKET_R=.065,FRICTION=2.25,MAX_SPEED=1.55,DT=1/120;
const pockets=[{x:0,y:0},{x:.5,y:0},{x:1.75,y:0},{x:0,y:1},{x:.5,y:1},{x:1.75,y:1}];
const games=new Map();
const colors={1:'solid',2:'solid',3:'solid',4:'solid',5:'solid',6:'solid',7:'solid',9:'stripe',10:'stripe',11:'stripe',12:'stripe',13:'stripe',14:'stripe',15:'stripe'};

function makeBalls(){
  const balls=[];balls.push({id:0,x:.36,y:.5,vx:0,vy:0,pocketed:false});
  const rack=[1,10,2,11,8,3,12,4,13,5,14,6,15,7,9];
  const spacing=BALL_R*2.04, apexX=1.26;
  let k=0;
  for(let row=0;row<5;row++){
    for(let col=0;col<=row;col++){
      const x=apexX+row*spacing*.86;
      const y=.5+(col-row/2)*spacing;
      balls.push({id:rack[k++],x,y,vx:0,vy:0,pocketed:false});
    }
  }
  return balls;
}
function newGame(m){return {matchId:m.id,p1:m.p1,p2:m.p2,stake:m.stake,currentPlayer:m.p1,moving:false,winner:null,groups:{p1:null,p2:null},breakShot:true,balls:makeBalls(),beforePocketed:[]};}
function publicGame(g){return {matchId:g.matchId,p1:g.p1,p2:g.p2,stake:g.stake,currentPlayer:g.currentPlayer,moving:g.moving,winner:g.winner,groups:g.groups,breakShot:g.breakShot,balls:g.balls.map(b=>({id:b.id,x:b.x,y:b.y,pocketed:b.pocketed})),};}
function broadcastGame(g){io.to('m:'+g.matchId).emit('gameState',publicGame(g));}
function speed(b){return Math.hypot(b.vx,b.vy);}
function anyMoving(g){return g.balls.some(b=>!b.pocketed&&speed(b)>.012);}
function pocketBall(g,b){b.pocketed=true;b.vx=0;b.vy=0;}
function physicsStep(g){
  for(const b of g.balls){
    if(b.pocketed) continue;
    b.x+=b.vx*DT;b.y+=b.vy*DT;
    for(const p of pockets){if(Math.hypot(b.x-p.x,b.y-p.y)<POCKET_R){pocketBall(g,b);break;}}
    if(b.pocketed) continue;
    if(b.x<BALL_R){b.x=BALL_R;b.vx=Math.abs(b.vx)*.96;}
    if(b.x>TABLE_W-BALL_R){b.x=TABLE_W-BALL_R;b.vx=-Math.abs(b.vx)*.96;}
    if(b.y<BALL_R){b.y=BALL_R;b.vy=Math.abs(b.vy)*.96;}
    if(b.y>TABLE_H-BALL_R){b.y=TABLE_H-BALL_R;b.vy=-Math.abs(b.vy)*.96;}
  }
  for(let i=0;i<g.balls.length;i++){
    const a=g.balls[i];if(a.pocketed)continue;
    for(let j=i+1;j<g.balls.length;j++){
      const b=g.balls[j];if(b.pocketed)continue;
      let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);
      const min=BALL_R*2;
      if(dist===0){dx=min;dy=0;dist=min;}
      if(dist<min){
        const nx=dx/dist,ny=dy/dist,over=min-dist;
        a.x-=nx*over/2;a.y-=ny*over/2;b.x+=nx*over/2;b.y+=ny*over/2;
        const rvx=b.vx-a.vx,rvy=b.vy-a.vy,rel=rvx*nx+rvy*ny;
        if(rel<0){const impulse=-rel*.985;a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;}
      }
    }
  }
  const damp=Math.exp(-FRICTION*DT);
  for(const b of g.balls){if(b.pocketed)continue;b.vx*=damp;b.vy*=damp;if(speed(b)<.006){b.vx=0;b.vy=0;}}
}
function newPocketed(g){return g.balls.filter(b=>b.pocketed && !g.beforePocketed.includes(b.id)).map(b=>b.id);}
function remainingType(g,type,userId){
  const own=(g.groups.p1?.userId===userId?g.groups.p1.type:g.groups.p2?.userId===userId?g.groups.p2.type:null);if(!own)return true;
  return g.balls.some(b=>!b.pocketed && colors[b.id]===own);
}
function groupForUser(g,uid){if(g.groups.p1?.userId===uid)return g.groups.p1.type;if(g.groups.p2?.userId===uid)return g.groups.p2.type;return null;}
function finishDb(matchId,winner){
  const m=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);if(!m||m.status!=='active')return;
  const prize=m.stake*2,loser=winner===m.p1?m.p2:m.p1;
  const run=db.transaction(()=>{db.prepare('UPDATE users SET chips=chips+?,wins=wins+1 WHERE id=?').run(prize,winner);db.prepare('UPDATE users SET losses=losses+1 WHERE id=?').run(loser);tx(winner,prize,'credit','Prêmio da vitória');db.prepare("UPDATE matches SET status='finished',winner=? WHERE id=?").run(winner,m.id);});run();
}
function endTurn(g){
  const pocketed=newPocketed(g),uid=g.currentPlayer;
  const cuePocketed=pocketed.includes(0),eight=pocketed.includes(8),object=pocketed.filter(id=>id!==0&&id!==8);
  let shooterType=groupForUser(g,uid);
  if(!g.groups.p1&&!g.groups.p2&&object.length){
    const t=colors[object[0]];
    g.groups.p1 = uid===g.p1 ? {userId:g.p1,type:t}:{userId:g.p1,type:t==='solid'?'stripe':'solid'};
    g.groups.p2 = uid===g.p2 ? {userId:g.p2,type:t}:{userId:g.p2,type:t==='solid'?'stripe':'solid'};
    shooterType=t;
  }
  if(eight){
    const legal = shooterType && !remainingType(g,shooterType,uid);
    g.winner=legal&&!cuePocketed?uid:(uid===g.p1?g.p2:g.p1);
    finishDb(g.matchId,g.winner);
    return true;
  }
  // On the break, don't assign a free turn bonus just because a ball fell.
  if(g.breakShot){g.breakShot=false;g.currentPlayer=uid; if(object.length===0)g.currentPlayer=uid===g.p1?g.p2:g.p1; return false;}
  const legalOwn=object.some(id=>shooterType && colors[id]===shooterType);
  const foul=cuePocketed || (shooterType && object.some(id=>colors[id]!==shooterType));
  if(!foul && legalOwn){g.currentPlayer=uid;}
  else {g.currentPlayer=uid===g.p1?g.p2:g.p1;}
  if(cuePocketed){const cue=g.balls.find(b=>b.id===0);cue.pocketed=false;cue.x=.36;cue.y=.5;cue.vx=0;cue.vy=0;}
  return false;
}
function runShot(g,angle,power){
  const cue=g.balls.find(b=>b.id===0);if(!cue)return;
  cue.vx=Math.cos(angle)*MAX_SPEED*power;cue.vy=Math.sin(angle)*MAX_SPEED*power;
  g.beforePocketed=g.balls.filter(b=>b.pocketed).map(b=>b.id);
  g.moving=true;broadcastGame(g);
  let safety=0;
  const timer=setInterval(()=>{
    for(let i=0;i<4;i++) physicsStep(g);
    safety++;
    if(safety%2===0) broadcastGame(g);
    if(!anyMoving(g)||safety>900){clearInterval(timer);g.moving=false;endTurn(g);broadcastGame(g);if(g.winner)io.to('m:'+g.matchId).emit('gameOver',{matchId:g.matchId,winner:g.winner});else io.to('m:'+g.matchId).emit('turn',{matchId:g.matchId,currentPlayer:g.currentPlayer});}
  },16);
}

io.use((socket,next)=>{try{const token=socket.handshake.auth?.token;if(!token)return next(new Error('Não autenticado'));socket.user=jwt.verify(token,SECRET);next();}catch(e){next(new Error('Não autenticado'));}});

io.on('connection',socket=>{
  socket.join('u:'+socket.user.id);
  socket.on('join',matchId=>{
    socket.join('m:'+matchId);
    const m=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
    if(m && m.status==='active' && [m.p1,m.p2].includes(socket.user.id)){
      let g=games.get(matchId);if(!g){g=newGame(m);games.set(matchId,g);}
      socket.emit('gameState',publicGame(g));
    }
  });
  socket.on('shot',data=>{
    if(!data?.matchId)return;
    const g=games.get(data.matchId);if(!g||g.winner||g.moving)return;
    if(![g.p1,g.p2].includes(socket.user.id)||g.currentPlayer!==socket.user.id)return;
    const angle=Number(data.angle),power=clampServer(Number(data.power),.08,1);
    if(!Number.isFinite(angle)||!Number.isFinite(power))return;
    runShot(g,angle,power);
  });
});

function clampServer(n,a,b){return Math.max(a,Math.min(b,n));}

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Sinuca Arena GK online na porta '+PORT));
