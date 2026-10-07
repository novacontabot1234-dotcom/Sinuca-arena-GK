const A=document.getElementById('app');
const T=document.getElementById('toast');

let token=localStorage.token;
let me=null;
let sock=null;
let match=null;
let pendingChallenge=null;

const api=async(u,o={})=>{
  o.headers={
    ...(o.headers||{}),
    ...(token?{Authorization:'Bearer '+token}:{})
  };

  if(o.body){
    o.headers['Content-Type']='application/json';
    o.body=JSON.stringify(o.body);
  }

  const r=await fetch(u,o);
  const d=await r.json();

  if(!r.ok)throw Error(d.error||'Erro');

  return d;
};

const note=x=>{
  T.textContent=x;
  T.style.display='block';

  setTimeout(()=>{
    T.style.display='none';
  },2500);
};


/* =========================
   LOGIN
========================= */

function login(){

  A.innerHTML=`
  <div class="login card">

    <h1>🎱 Sinuca <span class="gold">Arena</span></h1>

    <p class="muted">
      Versão 0.2 • 1v1 online
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

  </div>`;

  loginForm();
}


function loginForm(){

  f.innerHTML=`
  <form>

    <input class="input"
      id="u"
      placeholder="Usuário">

    <br><br>

    <input class="input"
      id="p"
      type="password"
      placeholder="Senha">

    <br><br>

    <button class="btn">
      Entrar
    </button>

  </form>`;

  f.querySelector('form').onsubmit=async e=>{

    e.preventDefault();

    try{

      const d=await api('/api/login',{
        method:'POST',
        body:{
          username:u.value,
          password:p.value
        }
      });

      token=d.token;

      localStorage.token=token;

      boot();

    }catch(x){

      note(x.message);

    }

  };

}


function regForm(){

  f.innerHTML=`
  <form>

    <input class="input"
      id="n"
      placeholder="Nome">

    <br><br>

    <input class="input"
      id="u"
      placeholder="Usuário">

    <br><br>

    <input class="input"
      id="p"
      type="password"
      placeholder="Senha">

    <br><br>

    <button class="btn">
      Criar +100 fichas
    </button>

  </form>`;

  f.querySelector('form').onsubmit=async e=>{

    e.preventDefault();

    try{

      const d=await api('/api/register',{
        method:'POST',
        body:{
          displayName:n.value,
          username:u.value,
          password:p.value
        }
      });

      token=d.token;

      localStorage.token=token;

      boot();

    }catch(x){

      note(x.message);

    }

  };

}


/* =========================
   INICIALIZAÇÃO
========================= */

async function boot(){

  try{

    me=(await api('/api/me')).user;

    sock=io({
      auth:{token}
    });


    /* DESAFIO RECEBIDO */

    sock.on('challenge',d=>{

      if(d.to!==me.id)return;

      pendingChallenge=d.matchId;

      showChallenge(d.matchId);

    });


    /* ATUALIZAÇÃO DE SALDO */

    sock.on('wallet',async()=>{

      try{

        me=(await api('/api/me')).user;

        if(!match){
          home();
        }

      }catch(e){}

    });


    /* PARTIDA INICIADA */

    sock.on('started',()=>{

      if(match){

        note('🎱 Partida iniciada!');

      }

    });


    /* PARTIDA FINALIZADA */

    sock.on('finished',d=>{

      if(!match)return;

      note('🏆 Partida finalizada!');

    });


    home();

  }catch(e){

    localStorage.removeItem('token');

    token=null;

    login();

  }

}


async function refresh(){

  me=(await api('/api/me')).user;

  home();

}


/* =========================
   NAVEGAÇÃO
========================= */

function nav(){

  return `
  <div class="nav">

    <button class="btn dark"
      onclick="home()">
      🏠 Lobby
    </button>

    <button class="btn dark"
      onclick="history()">
      📜 Histórico
    </button>

    <button class="btn dark"
      onclick="invite()">
      🔗 Divulgar
    </button>

    ${
      me.is_admin
      ?
      `<button class="btn dark"
        onclick="admin()">
        👑 ADM
      </button>`
      :
      ''
    }

    <button class="btn dark"
      onclick="logout()">
      Sair
    </button>

  </div>`;

}


/* =========================
   LOBBY
========================= */

async function home(){

  const d=await api('/api/players');

  A.innerHTML=`
  <div class="wrap">

    ${nav()}

    <div class="card">

      <h1>
        Desafie seus amigos
      </h1>

      <p class="muted">
        🪙 Seu saldo:
        <b class="gold">
          ${me.chips}
        </b>
        fichas
      </p>

    </div>


    <div class="card">

      <h2>
        Jogadores
      </h2>

      ${
        d.players.map(p=>`

        <div class="row">

          <div>

            <b>
              ${p.display_name}
            </b>

            <div class="muted">
              ${p.wins}V / ${p.losses}D
              • 🪙 ${p.chips}
            </div>

          </div>


          <div class="actions">

            <input
              class="input"
              style="width:90px"
              id="s${p.id}"
              type="number"
              value="10"
              min="10">

            <button
              class="btn"
              onclick="challenge(${p.id})">

              Desafiar

            </button>

          </div>

        </div>

        `).join('')
        ||
        '<p class="muted">Nenhum outro jogador online/cadastrado.</p>'
      }

    </div>

  </div>`;

}


/* =========================
   ENVIAR DESAFIO
========================= */

async function challenge(id){

  try{

    const input=document.getElementById('s'+id);

    const stake=Number(input.value);

    if(!Number.isFinite(stake)||stake<10){

      note('A aposta mínima é 10 fichas.');

      return;

    }


    const d=await api('/api/challenge',{
      method:'POST',
      body:{
        opponent:id,
        stake
      }
    });


    note('🎯 Desafio enviado! Aguarde o jogador aceitar.');

  }catch(e){

    note(e.message);

  }

}


/* =========================
   DESAFIO RECEBIDO
========================= */

async function showChallenge(matchId){

  try{

    const d=await api('/api/match/'+matchId);

    const m=d.match;

    const box=document.createElement('div');

    box.id='challengeBox';

    box.style.position='fixed';
    box.style.left='50%';
    box.style.top='50%';
    box.style.transform='translate(-50%,-50%)';
    box.style.zIndex='9999';
    box.style.width='min(420px,90%)';
    box.style.background='#0d1612';
    box.style.border='1px solid #dfc373';
    box.style.borderRadius='18px';
    box.style.padding='24px';
    box.style.boxShadow='0 20px 70px #000';

    box.innerHTML=`

      <h2>
        🎯 Desafio recebido!
      </h2>

      <p>
        <b>${m.p1}</b>
        desafiou você para uma partida.
      </p>

      <p class="muted">
        Aposta:
        <b class="gold">
          🪙 ${m.stake}
        </b>
        fichas
      </p>

      <div class="actions">

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

    `;

    document.body.appendChild(box);

    pendingChallenge=matchId;

  }catch(e){

    note('Não foi possível carregar o desafio.');

  }

}


/* =========================
   ACEITAR DESAFIO
========================= */

async function acceptChallenge(id){

  try{

    const box=document.getElementById('challengeBox');

    if(box)box.remove();


    await api('/api/match/'+id+'/accept',{
      method:'POST'
    });


    pendingChallenge=null;

    await startMatch(id);

    note('🎱 Desafio aceito!');

  }catch(e){

    note(e.message);

  }

}


/* =========================
   RECUSAR DESAFIO
========================= */

async function rejectChallenge(id){

  const box=document.getElementById('challengeBox');

  if(box)box.remove();

  pendingChallenge=null;

  note('Desafio recusado.');

}


/* =========================
   INICIAR PARTIDA
========================= */

async function startMatch(id){

  const d=await api('/api/match/'+id);

  match=d.match;

  sock.emit('join',id);

  renderTable();

}


/* =========================
   MESA
========================= */

function renderTable(){

  A.innerHTML=`

  <div class="wrap">

    ${nav()}

    <div class="card">

      <h2>
        🎱 ${match.p1} × ${match.p2}
      </h2>

      <p class="muted">

        Aposta 🪙 ${match.stake}

        •

        prêmio 🪙 ${match.stake*2}

      </p>


      <div class="tablebox">

        <div
          class="table"
          id="table">

          <i class="pocket a"></i>
          <i class="pocket b"></i>
          <i class="pocket c"></i>
          <i class="pocket d"></i>
          <i class="pocket e"></i>
          <i class="pocket f"></i>


          <i
            class="ball white"
            id="cue"
            style="left:18%;top:50%">
          </i>

          <i
            class="ball yellow"
            style="left:65%;top:48%">
          </i>

          <i
            class="ball red"
            style="left:70%;top:43%">
          </i>

          <i
            class="ball blue"
            style="left:70%;top:53%">
          </i>

          <i
            class="ball black"
            style="left:75%;top:48%">
          </i>

          <i
            class="cueLine"
            id="line">
          </i>

        </div>

      </div>


      <div class="power">

        <b>
          Potência da tacada
        </b>

        <input
          id="pow"
          type="range"
          min="1"
          max="100"
          value="50">


        <div
          class="actions"
          style="justify-content:center;margin-top:10px">

          <button
            class="btn"
            onclick="aim()">

            🎯 Mostrar mira

          </button>

          <button
            class="btn"
            onclick="shoot()">

            💥 TACADA

          </button>

        </div>

      </div>


      <p class="muted">

        Partida online 1v1.
        Ajuste a mira e escolha a potência.

      </p>

    </div>

  </div>`;



  document.getElementById('table').onclick=e=>{

    const r=e.currentTarget.getBoundingClientRect();

    const x=e.clientX-r.left;
    const y=e.clientY-r.top;

    const c=document
      .getElementById('cue')
      .getBoundingClientRect();

    const cx=c.left+c.width/2-r.left;
    const cy=c.top+c.height/2-r.top;

    const line=document.getElementById('line');

    const ang=Math.atan2(
      y-cy,
      x-cx
    );

    line.style.display='block';

    line.style.left=cx+'px';

    line.style.top=cy+'px';

    line.style.width=
      Math.hypot(x-cx,y-cy)+'px';

    line.style.transform=
      `rotate(${ang}rad)`;

  };

}


/* =========================
   MIRA
========================= */

function aim(){

  document
    .getElementById('line')
    .style.display='block';

  note(
    '🎯 Mira ativada: toque na mesa para escolher a direção.'
  );

}


/* =========================
   TACADA
========================= */

function shoot(){

  if(!match){

    note('Nenhuma partida ativa.');

    return;

  }

  const power=Number(
    document.getElementById('pow').value
  );


  sock.emit('shot',{
    matchId:match.id,
    power
  });


  note(
    '💥 Tacada enviada com potência '+power
  );

}


/* =========================
   HISTÓRICO
========================= */

async function history(){

  const d=await api('/api/history');

  A.innerHTML=`

  <div class="wrap">

    ${nav()}

    <div class="card">

      <h2>
        📜 Histórico
      </h2>

      ${
        d.matches.map(m=>`

        <div class="row">

          <span>
            ${m.p1_name} × ${m.p2_name}
          </span>

          <b>
            ${m.status}
          </b>

        </div>

        `).join('')
        ||
        '<p class="muted">Nenhuma partida.</p>'
      }

    </div>


    <div class="card">

      <h2>
        🪙 Fichas
      </h2>

      ${
        d.transactions.map(x=>`

        <div class="row">

          <span>
            ${x.description}
          </span>

          <b>
            ${x.amount>0?'+':''}${x.amount}
          </b>

        </div>

        `).join('')
      }

    </div>

  </div>`;

}


/* =========================
   DIVULGAR
========================= */

function invite(){

  const u=location.origin;

  A.innerHTML=`

  <div class="wrap">

    ${nav()}

    <div class="card">

      <h2>
        🔗 Divulgue a Sinuca Arena
      </h2>

      <p class="muted">
        Envie este link para seus amigos.
      </p>

      <div class="card">
        ${u}
      </div>

      <button
        class="btn"
        onclick="navigator.clipboard.writeText('${u}');note('Link copiado!')">

        📋 Copiar link

      </button>

      <a
        class="btn"
        href="https://wa.me/?text=${encodeURIComponent('🎱 Venha jogar Sinuca Arena 1v1! '+u)}"
        target="_blank">

        WhatsApp

      </a>

    </div>

  </div>`;

}


/* =========================
   ADMIN
========================= */

async function admin(){

  const d=await api('/api/admin/users');

  A.innerHTML=`

  <div class="wrap">

    ${nav()}

    <div class="card">

      <h2>
        👑 Painel ADM — Liberação de fichas
      </h2>

      <p class="muted">
        Somente o ADM pode liberar ou retirar fichas.
      </p>

      ${
        d.users.map(u=>`

        <div class="row">

          <div>

            <b>
              ${u.display_name}
            </b>

            <div class="muted">
              @${u.username}
              • 🪙 ${u.chips}
            </div>

          </div>


          <div class="actions">

            <input
              class="input"
              style="width:90px"
              id="a${u.id}"
              value="100"
              type="number">


            <button
              class="btn"
              onclick="chips(${u.id},'add')">

              + Liberar

            </button>


            <button
              class="btn dark"
              onclick="chips(${u.id},'remove')">

              − Retirar

            </button>

          </div>

        </div>

        `).join('')
      }

    </div>

  </div>`;

}


async function chips(id,action){

  try{

    await api('/api/admin/chips',{
      method:'POST',
      body:{
        userId:id,
        amount:Number(
          document.getElementById('a'+id).value
        ),
        action
      }
    });

    note('Saldo atualizado.');

    admin();

  }catch(e){

    note(e.message);

  }

}


/* =========================
   SAIR
========================= */

function logout(){

  localStorage.removeItem('token');

  location.reload();

}


/* =========================
   INICIAR
========================= */

if(token){

  boot();

}else{

  login();

}
