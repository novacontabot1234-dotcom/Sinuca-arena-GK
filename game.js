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
let aim = {active:false, angle:0, power:0, startX:0, startY:0, x:0, y:0};
let pointerDown = false;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const api = async (u, o = {}) => {
  o.headers = {
    ...(o.headers || {}),
    ...(token ? {Authorization:'Bearer ' + token} : {})
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
  note.timer = setTimeout(() => { T.style.display = 'none'; }, 2600);
};

function login(){
  A.innerHTML = `<div class="login card">
    <div class="brand-mark">GK</div>
    <h1>Sinuca <span class="gold">Arena</span> GK</h1>
    <p class="muted">Versão 0.3 • 1v1 online</p>
    <div class="actions">
      <button class="btn" onclick="loginForm()">Entrar</button>
      <button class="btn dark" onclick="regForm()">Criar conta</button>
    </div>
    <div id="f"></div>
  </div>`;
  loginForm();
}

function loginForm(){
  const f = document.getElementById('f');
  f.innerHTML = `<form>
    <input class="input" id="u" placeholder="Usuário" autocomplete="username"><br><br>
    <input class="input" id="p" type="password" placeholder="Senha" autocomplete="current-password"><br><br>
    <button class="btn full">Entrar</button>
  </form>`;
  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try{
      const d = await api('/api/login',{method:'POST',body:{username:u.value,password:p.value}});
      token = d.token;
      localStorage.token = token;
      await boot();
    }catch(x){ note(x.message); }
  };
}

function regForm(){
  const f = document.getElementById('f');
  f.innerHTML = `<form>
    <input class="input" id="n" placeholder="Nome"><br><br>
    <input class="input" id="u" placeholder="Usuário" autocomplete="username"><br><br>
    <input class="input" id="p" type="password" placeholder="Senha" autocomplete="new-password"><br><br>
    <button class="btn full">Criar conta +100 fichas</button>
  </form>`;
  f.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    try{
      const d = await api('/api/register',{method:'POST',body:{displayName:n.value,username:u.value,password:p.value}});
      token = d.token;
      localStorage.token = token;
      await boot();
    }catch(x){ note(x.message); }
  };
}

async function boot(){
  try{
    me = (await api('/api/me')).user;
    if (sock) sock.disconnect();
    sock = io({auth:{token}});

    sock.on('connect_error', err => note(err.message || 'Conexão indisponível.'));

    sock.on('challenge', d => {
      if (Number(d.to) !== Number(me.id)) return;
      pendingChallenge = d.matchId;
      showChallenge(d.matchId);
    });

    sock.on('wallet', async () => {
      try{
        me = (await api('/api/me')).user;
        if (!match) home();
      }catch(e){}
    });

    sock.on('matchAccepted', async d => {
      if (!d?.matchId) return;
      if (match?.id === d.matchId) return;
      note('🎱 Desafio aceito! Preparando a mesa...');
      try { await startMatch(d.matchId); } catch(e) { note(e.message); }
    });

    sock.on('gameState', d => {
      if (!match || d.matchId !== match.id) return;
      game = d;
      if (!aim.active) renderGame(); else draw();
    });

    sock.on('gameOver', d => {
      if (!match || d.matchId !== match.id) return;
      game = {...game, winner:d.winner, moving:false};
      draw();
      const win = Number(d.winner) === Number(me.id);
      note(win ? '🏆 Você venceu a partida!' : '💥 Você perdeu a partida.');
      setTimeout(() => {
        match = null;
        game = null;
        home();
      }, 4500);
    });

    sock.on('started', () => { if (match) note('🎱 Partida iniciada!'); });
    sock.on('finished', () => { if (match) note('🏆 Partida finalizada!'); });

    home();
  }catch(e){
    localStorage.removeItem('token');
    token = null;
    login();
  }
}

function nav(){
  return `<div class="nav">
    <button class="btn dark" onclick="home()">🏠 Lobby</button>
    <button class="btn dark" onclick="historyPage()">📜 Histórico</button>
    <button class="btn dark" onclick="invite()">🔗 Divulgar</button>
    ${me?.is_admin ? '<button class="btn dark" onclick="admin()">👑 ADM</button>' : ''}
    <button class="btn dark" onclick="logout()">Sair</button>
  </div>`;
}

async function home(){
  if (match) { renderGame(); return; }
  try{
    const d = await api('/api/players');
    A.innerHTML = `<div class="wrap">
      ${nav()}
      <div class="hero card">
        <div>
          <div class="eyebrow">GK • 1V1 ONLINE</div>
          <h1>Desafie seus amigos</h1>
          <p class="muted">Mesa de sinuca com mira, taco, potência e tacada por arrastar.</p>
        </div>
        <div class="balance"><span>🪙</span><b>${me.chips}</b><small>fichas</small></div>
      </div>
      <div class="card">
        <h2>Jogadores</h2>
        ${d.players.map(p => `<div class="player-row">
          <div class="player-main">
            <div class="avatar">${esc((p.display_name||'?').slice(0,1).toUpperCase())}</div>
            <div><b>${esc(p.display_name)}</b><div class="muted small">${p.wins}V / ${p.losses}D • 🪙 ${p.chips}</div></div>
          </div>
          <div class="challenge-actions">
            <input class="input stake-input" id="s${p.id}" type="number" value="10" min="10" step="10">
            <button class="btn" onclick="challenge(${p.id})">Desafiar</button>
          </div>
        </div>`).join('') || '<p class="muted">Nenhum outro jogador cadastrado.</p>'}
      </div>
    </div>`;
  }catch(e){ note(e.message); }
}

async function challenge(id){
  try{
    const input = document.getElementById('s'+id);
    const stake = Number(input?.value || 0);
    if(!Number.isFinite(stake) || stake < 10) return note('A aposta mínima é 10 fichas.');
    const d = await api('/api/challenge',{method:'POST',body:{opponent:id,stake}});
    note('🎯 Desafio enviado! Aguarde a aceitação.');
  }catch(e){ note(e.message); }
}

async function showChallenge(matchId){
  try{
    if (challengeBox) challengeBox.remove();
    const d = await api('/api/match/'+matchId);
    const m = d.match;
    challengeBox = document.createElement('div');
    challengeBox.className = 'challenge-modal';
    challengeBox.innerHTML = `<div class="challenge-panel">
      <div class="duel-icon">🎱</div>
      <div class="eyebrow">DESAFIO 1V1</div>
      <h2>${esc(m.p1)} te desafiou</h2>
      <p class="muted">Prepare-se para a partida.</p>
      <div class="stake-card"><span>Aposta</span><strong>🪙 ${m.stake}</strong><small>Prêmio: ${m.stake*2} fichas</small></div>
      <div class="actions center">
        <button class="btn accept-btn" onclick="acceptChallenge('${matchId}')">✅ ACEITAR</button>
        <button class="btn dark" onclick="rejectChallenge('${matchId}')">❌ RECUSAR</button>
      </div>
    </div>`;
    document.body.appendChild(challengeBox);
    pendingChallenge = matchId;
  }catch(e){ note('Não foi possível carregar o desafio.'); }
}

async function acceptChallenge(id){
  try{
    challengeBox?.remove(); challengeBox=null;
    await api('/api/match/'+id+'/accept',{method:'POST'});
    pendingChallenge = null;
    await startMatch(id);
    note('🎱 Partida aceita!');
  }catch(e){ note(e.message); }
}

async function rejectChallenge(id){
  challengeBox?.remove(); challengeBox=null;
  pendingChallenge=null;
  try { await api('/api/match/'+id+'/reject',{method:'POST'}); } catch(e) {}
  note('Desafio recusado.');
}

async function startMatch(id){
  const d = await api('/api/match/'+id);
  match = d.match;
  const s = await new Promise(resolve => {
    const onState = st => { if(st.matchId === id){ sock.off('gameState', onState); clearTimeout(t); resolve(st); } };
    sock.on('gameState', onState);
    sock.emit('join', id);
    const t=setTimeout(() => { sock.off('gameState', onState); resolve(null); }, 1500);
  });
  game = s || {matchId:id,moving:false,currentPlayer:Number(match.p1_id || 0),winner:null,groups:{},balls:[]};
  renderGame();
}

function renderGame(){
  A.innerHTML = `<div class="game-wrap">
    <div class="game-topbar">
      <button class="btn dark mini" onclick="leaveMatch()">← Lobby</button>
      <div class="duel-names"><span>${esc(match?.p1 || 'Jogador 1')}</span><b>×</b><span>${esc(match?.p2 || 'Jogador 2')}</span></div>
      <div class="stake-pill">🪙 ${match?.stake || 0}</div>
    </div>
    <div class="turn-bar" id="turnBar">${turnText()}</div>
    <div class="table-shell">
      <canvas id="poolCanvas" width="1050" height="600"></canvas>
      <div class="touch-help" id="touchHelp">Arraste a partir da bola branca para mirar e puxar a tacada</div>
    </div>
    <div class="controls">
      <div class="power-info"><span>FORÇA</span><strong id="powerText">0%</strong></div>
      <div class="power-track"><div class="power-fill" id="powerFill"></div></div>
      <button class="btn dark" onclick="resetAim()">↺ Mira</button>
      <button class="btn shot-btn" id="shotBtn" onclick="shootNow()">TACADA</button>
    </div>
    <div class="game-tip muted">${groupsText()}</div>
  </div>`;
  canvas = document.getElementById('poolCanvas');
  ctx = canvas.getContext('2d');
  bindAimControls();
  resetAim();
  draw();
}

function turnText(){
  if (!game) return 'Carregando mesa...';
  if (game.winner) return Number(game.winner)===Number(me.id) ? '🏆 VOCÊ VENCEU' : '💥 SEU ADVERSÁRIO VENCEU';
  if (game.moving) return '🎱 Bolas em movimento...';
  return Number(game.currentPlayer)===Number(me.id) ? '🎯 SUA VEZ — ARRASTE A BOLA BRANCA' : '⏳ VEZ DO ADVERSÁRIO';
}

function groupsText(){
  if(!game?.groups) return 'Grupos ainda não definidos.';
  const g = game.groups;
  if(!g.p1 || !g.p2) return 'Mesa aberta • o primeiro grupo é definido pela primeira bola válida encaçapada.';
  const my = Number(g.p1?.userId)===Number(me.id) ? g.p1.type : Number(g.p2?.userId)===Number(me.id) ? g.p2.type : null;
  return my ? `Seu grupo: ${my === 'solid' ? 'Lisas' : 'Listradas'} • Bola 8 por último` : 'Grupos definidos • bola 8 por último';
}

function cueBall(){ return game?.balls?.find(b=>Number(b.id)===0 && !b.pocketed); }

function bindAimControls(){
  const down = ev => {
    if(!canShoot()) return;
    const p = point(ev);
    const c = cueBall();
    if(!c) return;
    const q = canvasToScreen(c.x,c.y);
    const d = Math.hypot(p.x-q.x,p.y-q.y);
    pointerDown = true;
    aim.active = true;
    aim.startX=q.x; aim.startY=q.y; aim.x=p.x; aim.y=p.y;
    aim.angle = Math.atan2(q.y-p.y,q.x-p.x);
    aim.power = clamp(d/180,0,1);
    updatePowerUI();
    draw();
    ev.preventDefault?.();
  };
  const move = ev => {
    if(!pointerDown || !canShoot()) return;
    const p = point(ev);
    const c = cueBall();
    if(!c) return;
    const q = canvasToScreen(c.x,c.y);
    aim.x=p.x; aim.y=p.y;
    aim.angle=Math.atan2(q.y-p.y,q.x-p.x);
    const dist=Math.hypot(p.x-q.x,p.y-q.y);
    aim.power=clamp(dist/190,0,1);
    updatePowerUI(); draw();
    ev.preventDefault?.();
  };
  const up = ev => {
    if(!pointerDown) return;
    pointerDown=false;
    if(aim.power>=0.08 && canShoot()) shootNow();
    else { aim.active=false; aim.power=0; updatePowerUI(); draw(); }
  };
  canvas.onpointerdown=down;
  canvas.onpointermove=move;
  canvas.onpointerup=up;
  canvas.onpointercancel=up;
  canvas.onpointerleave=up;
}

function point(ev){
  const r=canvas.getBoundingClientRect();
  return {x:(ev.clientX-r.left)*canvas.width/r.width,y:(ev.clientY-r.top)*canvas.height/r.height};
}

function worldToCanvas(x,y){
  const mx=34,my=34;
  const fw=canvas.width-mx*2, fh=canvas.height-my*2;
  return {x:mx+(x/1.75)*fw,y:my+y*fh};
}

function canShoot(){
  return !!(game && !game.moving && !game.winner && Number(game.currentPlayer)===Number(me.id) && cueBall());
}

function resetAim(){
  const c=cueBall();
  aim.active=false; aim.power=0;
  if(c) aim.angle=0;
  updatePowerUI(); draw();
}

function updatePowerUI(){
  const f=document.getElementById('powerFill');
  const t=document.getElementById('powerText');
  if(f) f.style.width=((aim.power||0)*100)+'%';
  if(t) t.textContent=Math.round((aim.power||0)*100)+'%';
  const btn=document.getElementById('shotBtn');
  if(btn) btn.disabled=!canShoot() || (aim.power||0)<0.05;
}

function shootNow(){
  if(!canShoot()) return note('Aguarde a sua vez.');
  const power=clamp(aim.power || Number(document.getElementById('powerFill')?.style.width?.replace('%','')||0)/100,0.08,1);
  sock.emit('shot',{matchId:match.id,angle:aim.angle,power});
  aim.active=false; aim.power=0; updatePowerUI(); draw();
}

function draw(){
  if(!ctx||!canvas) return;
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  drawTable(W,H);
  if(game?.balls?.length){ for(const b of game.balls) drawBall(b); }
  if(aim.active && canShoot()) drawAim();
  updatePowerUI();
  const tb=document.getElementById('turnBar'); if(tb) tb.textContent=turnText();
}

function drawTable(W,H){
  const rail=34, x0=rail, y0=rail, tw=W-rail*2, th=H-rail*2;
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0a8156'); g.addColorStop(1,'#07543b');
  ctx.fillStyle='#5a361d'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#754a27'; ctx.fillRect(12,12,W-24,H-24);
  ctx.fillStyle='#0b6d4a'; ctx.fillRect(x0,y0,tw,th);
  ctx.fillStyle=g; ctx.fillRect(x0+3,y0+3,tw-6,th-6);
  ctx.strokeStyle='#b98a52'; ctx.lineWidth=6; ctx.strokeRect(x0,y0,tw,th);
  const pockets=[
    [x0+5,y0+5],[W/2,y0+4],[W-x0-5,y0+5],
    [x0+5,H-y0-5],[W/2,H-y0-4],[W-x0-5,H-y0-5]
  ];
  for(const [x,y] of pockets){
    ctx.beginPath();ctx.arc(x,y,25,0,Math.PI*2);ctx.fillStyle='#070707';ctx.fill();
    ctx.beginPath();ctx.arc(x-5,y-5,16,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();
  }
  // head string / foot spot
  ctx.setLineDash([8,10]); ctx.strokeStyle='rgba(255,255,255,.16)'; ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(x0+tw*.23,y0);ctx.lineTo(x0+tw*.23,H-y0);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(x0+tw*.23,H/2,5,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.4)';ctx.fill();
  ctx.beginPath();ctx.arc(x0+tw*.77,H/2,5,0,Math.PI*2);ctx.fill();
}

function drawBall(b){
  const q=worldToCanvas(b.x,b.y); const x=q.x,y=q.y,r=BALL_RADIUS_PX();
  if(b.pocketed) return;
  // shadow
  ctx.beginPath();ctx.arc(x+4,y+6,r+1,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.28)';ctx.fill();
  const grad=ctx.createRadialGradient(x-r*.4,y-r*.45,r*.1,x,y,r);
  const col=ballColor(b.id);
  grad.addColorStop(0,'#fff');grad.addColorStop(.18,col);grad.addColorStop(1,shade(col,-.35));
  ctx.fillStyle=grad;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=1;ctx.stroke();
  if(b.id!==0){
    const stripe=(b.id>=9 && b.id<=15);
    if(stripe){
      ctx.save();ctx.beginPath();ctx.arc(x,y,r*.93,0,Math.PI*2);ctx.clip();
      ctx.fillStyle='#f8f8f5';ctx.fillRect(x-r,y-r*.32,2*r,r*.64);ctx.restore();
    }
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,r*.39,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#111';ctx.font=`bold ${Math.max(10,r*.72)}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(b.id,x,y+1);
  }
}

function BALL_RADIUS_PX(){ return (canvas.width-68)*.0255/1.75; }

function ballColor(id){
  const c={0:'#f4f1df',1:'#f4c542',2:'#2f6edb',3:'#d63b38',4:'#7f4bc2',5:'#ed7c2d',6:'#2b9e6d',7:'#a73535',8:'#111',9:'#f4c542',10:'#2f6edb',11:'#d63b38',12:'#7f4bc2',13:'#ed7c2d',14:'#2b9e6d',15:'#a73535'};
  return c[id]||'#ddd';
}
function shade(hex,f){
  const n=parseInt(hex.slice(1),16);const r=clamp((n>>16)+255*f,0,255),g=clamp(((n>>8)&255)+255*f,0,255),b=clamp((n&255)+255*f,0,255);
  return `rgb(${r},${g},${b})`;
}

function drawAim(){
  const c=cueBall(); if(!c) return;
  const q=worldToCanvas(c.x,c.y), x=q.x, y=q.y;
  const dx=Math.cos(aim.angle),dy=Math.sin(aim.angle);
  const len=900;
  ctx.save();
  ctx.setLineDash([12,10]);ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.82)';
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*len,y+dy*len);ctx.stroke();ctx.setLineDash([]);
  // ghost target
  const hit=firstBallHit(c,dx,dy);
  if(hit){
    const gx=hit.x,gy=hit.y,r=BALL_RADIUS_PX();
    ctx.beginPath();ctx.arc(gx,gy,r,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=2;ctx.stroke();
  }
  // cue stick
  const pull=70+aim.power*170;
  const back=x-dx*pull, by=y-dy*pull;
  const front=x-dx*22, fy=y-dy*22;
  const grd=ctx.createLinearGradient(back,by,front,fy);grd.addColorStop(0,'#6e3e1b');grd.addColorStop(.08,'#c98a4c');grd.addColorStop(.82,'#e9d2a4');grd.addColorStop(1,'#eee');
  ctx.strokeStyle=grd;ctx.lineWidth=11;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(back,by);ctx.lineTo(front,fy);ctx.stroke();
  ctx.strokeStyle='#3f2310';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(back,by);ctx.lineTo(front,fy);ctx.stroke();
  ctx.fillStyle='#f4f4f4';ctx.beginPath();ctx.arc(front,fy,5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

function firstBallHit(c,dx,dy){
  let best=null,bestT=Infinity;
  for(const b of (game?.balls||[])){
    if(Number(b.id)===0||b.pocketed) continue;
    const px=b.x-c.x,py=b.y-c.y;
    const proj=px*dx+py*dy;if(proj<=0)continue;
    const perp=Math.abs(px*dy-py*dx); if(perp>0.065)continue;
    if(proj<bestT){bestT=proj;best={x:(c.x+dx*proj)*canvas.width,y:(c.y+dy*proj)*canvas.height};}
  }
  return best;
}

function leaveMatch(){
  if(game?.moving){ note('Aguarde as bolas pararem.'); return; }
  match=null;game=null;aim.active=false;home();
}

async function historyPage(){
  const d=await api('/api/history');
  A.innerHTML=`<div class="wrap">${nav()}<div class="card"><h2>📜 Histórico</h2>${d.matches.map(m=>`<div class="row"><span>${esc(m.p1_name)} × ${esc(m.p2_name)}</span><b>${esc(m.status)}</b></div>`).join('')||'<p class="muted">Nenhuma partida.</p>'}</div><div class="card"><h2>🪙 Fichas</h2>${d.transactions.map(x=>`<div class="row"><span>${esc(x.description)}</span><b>${x.amount>0?'+':''}${x.amount}</b></div>`).join('')}</div></div>`;
}

function invite(){
  const u=location.origin;
  A.innerHTML=`<div class="wrap">${nav()}<div class="card"><h2>🔗 Divulgue a Sinuca Arena GK</h2><p class="muted">Envie este link para seus amigos.</p><div class="share-link">${u}</div><button class="btn" onclick="navigator.clipboard?.writeText('${u}').then(()=>note('Link copiado!'))">Copiar link</button></div></div>`;
}

async function admin(){
  try{
    const d=await api('/api/admin/users');
    A.innerHTML=`<div class="wrap">${nav()}<div class="card"><h2>👑 Painel ADM</h2>${d.users.map(u=>`<div class="row"><div><b>${esc(u.display_name)}</b><div class="muted small">@${esc(u.username)} • ${u.wins}V / ${u.losses}D</div></div><div class="admin-actions"><span class="gold">🪙 ${u.chips}</span>${Number(u.id)!==Number(me.id)?`<button class="btn mini" onclick="chip(${u.id},'add')">+ Fichas</button><button class="btn dark mini" onclick="chip(${u.id},'remove')">− Fichas</button>`:''}</div></div>`).join('')}</div></div>`;
  }catch(e){ note(e.message); }
}

async function chip(userId,action){
  const amount=Number(prompt('Quantidade de fichas:','100')||0);
  if(amount<=0)return;
  try{ await api('/api/admin/chips',{method:'POST',body:{userId,amount,action}}); note('Saldo atualizado.'); admin(); }catch(e){ note(e.message); }
}

function logout(){ localStorage.removeItem('token'); token=null; me=null; match=null;game=null; sock?.disconnect();sock=null;login(); }

boot();
