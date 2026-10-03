/* ============================================================
   referee.js — the referee's scoring pad

   Lives on referee.html, behind a password. Viewers never load
   this file; they see the read-only portal and scoreboard.

   A note on the password: this page asks for it so the controls
   are not left lying around, but the real protection is in the
   Worker — every publish is checked against DRAW_ADMIN_PASSWORD
   on the server, so nobody can push a fake score without it.
   ============================================================ */

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/* ============================================================
   REFEREE PAD
   PAR scoring: every rally is a point, the winner of the rally
   serves next, games go to 11 and must be won by two clear
   points. Match is best of five.
   ============================================================ */
const PAD_TARGET = 11;
const PAD_GAMES_TO_WIN = 3;

let pad = null;
let padLive = false;       // publishing to the site?
let padTimer = null;       // debounce handle for publishing

function padFresh() {
  const now = Date.now();
  return {
    score: [0, 0],         // points in the current game
    games: [],             // finished games, e.g. [[11,7],[9,11]]
    server: null,          // 0, 1, or null before the first rally
    done: false,
    rallies: [],           // every point, for the printed scoresheet
    started: now,          // match start, for the match clock
    gameStarted: now,      // current game start, for the game clock
    history: []
  };
}

function padSnapshot() {
  const { history, ...rest } = pad;
  return JSON.stringify(rest);
}

const val = id => (document.getElementById(id)?.value || '').trim();

function padCourt() {
  return val('padCourt') || '1';
}

function padMeta() {
  return {
    court: padCourt(),
    tournament: val('padTournament'),
    round: val('padRound'),
    players: [
      { name: val('padName0') || 'Player 1', dept: val('padDept0') },
      { name: val('padName1') || 'Player 2', dept: val('padDept1') }
    ]
  };
}

function padNames() {
  const m = padMeta();
  return [m.players[0].name, m.players[1].name];
}

function padGamesWon() {
  return [
    pad.games.filter(g => g[0] > g[1]).length,
    pad.games.filter(g => g[1] > g[0]).length
  ];
}

/* A game is won at 11+ with a lead of two or more. */
function padGameWinner() {
  const [a, b] = pad.score;
  if (a >= PAD_TARGET && a - b >= 2) return 0;
  if (b >= PAD_TARGET && b - a >= 2) return 1;
  return null;
}

function padPoint(i) {
  if (pad.done) return;
  pad.history.push(padSnapshot());
  pad.score[i]++;
  pad.server = i;                       // winner of the rally serves next
  pad.rallies.push({
    g: pad.games.length + 1,            // which game
    w: i,                               // who won the rally
    a: pad.score[0], b: pad.score[1]    // running score after it
  });

  const w = padGameWinner();
  if (w !== null) {
    pad.games.push([pad.score[0], pad.score[1]]);
    pad.score = [0, 0];
    pad.server = w;                     // game winner serves first next game
    pad.gameStarted = Date.now();       // game clock restarts
    if (padGamesWon()[w] >= PAD_GAMES_TO_WIN) {
      pad.done = true;
      padArchive();                     // keep it for the printed scoresheet
    }
  }
  padRender();
  padPublishSoon();
}

function padUndo() {
  const prev = pad.history.pop();
  if (!prev) return;
  const h = pad.history;
  Object.assign(pad, JSON.parse(prev));
  pad.history = h;
  padRender();
  padPublishSoon();
}

/* ---------- Completed matches, kept on this device for printing ---------- */
const PAD_STORE = 'nr-matches';

function padArchive() {
  try {
    const m = padMeta();
    const all = JSON.parse(localStorage.getItem(PAD_STORE) || '[]');
    all.unshift({
      id: 'm' + Date.now(),
      referee: sessionStorage.getItem(NAME_KEY) || '',
      tournament: m.tournament,
      round: m.round,
      players: m.players,
      games: pad.games,
      games_won: padGamesWon(),
      rallies: pad.rallies,
      started: pad.started,
      finished: Date.now()
    });
    localStorage.setItem(PAD_STORE, JSON.stringify(all.slice(0, 200)));
  } catch (err) {
    console.warn('Could not save the scoresheet on this device:', err);
  }
}

/* ---------- Publishing ---------- */
function padPayload() {
  const m = padMeta();
  const now = Date.now();
  return {
    live: !pad.done,
    court: m.court,
    tournament: m.tournament,
    round: m.round,
    players: m.players,
    score: pad.score,
    games: pad.games,
    games_won: padGamesWon(),
    server: pad.server,
    done: pad.done,
    started: pad.started,
    game_started: pad.gameStarted,
    rallies: pad.rallies.slice(-40),
    updated: now
  };
}

async function padPublish() {
  if (!padLive) return;
  const state = document.getElementById('padLiveState');
  try {
    const res = await fetch('/api/live?court=' + encodeURIComponent(padCourt()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': sessionStorage.getItem('nr-pass') || ''
      },
      body: JSON.stringify(padPayload())
    });
    if (res.status === 401) {
      padSetLive(false);
      state.textContent = 'Wrong password — publishing stopped.';
      state.className = 'pad__publish-state pad__publish-state--bad';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.textContent = 'Publishing live · last sent ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state.className = 'pad__publish-state pad__publish-state--good';
  } catch (err) {
    state.textContent = 'Could not reach the server — will retry on the next point.';
    state.className = 'pad__publish-state pad__publish-state--bad';
  }
}

/* Publishing is throttled so a fast rally sequence is not one write per tap. */
function padPublishSoon() {
  if (!padLive) return;
  clearTimeout(padTimer);
  padTimer = setTimeout(padPublish, 1200);
}

function padSetLive(on) {
  padLive = on;
  const btn = document.getElementById('padGoLive');
  const state = document.getElementById('padLiveState');
  btn.textContent = on ? 'Stop publishing' : 'Go live';
  btn.className = on ? 'btn btn--ghost' : 'btn btn--solid';
  if (!on) {
    state.textContent = 'Not publishing.';
    state.className = 'pad__publish-state';
  }
}

function padRender() {
  const names = padNames();
  const won = padGamesWon();

  for (let i = 0; i < 2; i++) {
    document.getElementById('padScore' + i).textContent = pad.score[i];
    document.getElementById('padLabel' + i).textContent = names[i];
    document.getElementById('padServe' + i).style.visibility =
      (pad.server === i && !pad.done) ? 'visible' : 'hidden';
    document.getElementById('padSide' + i).disabled = pad.done;
  }

  document.getElementById('padGames').innerHTML =
    `<span class="pad__gamecount">${won[0]}</span>
     <span class="pad__gamelabel">games</span>
     <span class="pad__gamecount">${won[1]}</span>`;

  const st = document.getElementById('padStatus');
  if (pad.done) {
    const w = won[0] > won[1] ? 0 : 1;
    st.textContent = `${names[w]} wins the match ${won[w]}–${won[1 - w]}`;
    st.className = 'pad__status pad__status--done';
  } else {
    const [a, b] = pad.score;
    let note = `Game ${pad.games.length + 1} · first to ${PAD_TARGET}, win by 2`;
    if (a >= PAD_TARGET - 1 && b >= PAD_TARGET - 1) note = `Game ${pad.games.length + 1} · two clear points needed`;
    else if (a >= PAD_TARGET - 1 && a - b >= 1) note = `Game ball — ${names[0]}`;
    else if (b >= PAD_TARGET - 1 && b - a >= 1) note = `Game ball — ${names[1]}`;
    st.textContent = note;
    st.className = 'pad__status';
  }

  const hist = document.getElementById('padHistory');
  hist.innerHTML = pad.games.length
    ? pad.games.map((g, n) => `
      <li><span class="pad__gameno">Game ${n + 1}</span>
      <span class="pad__gamescore">${g[0]}–${g[1]}</span></li>`).join('')
    : '<li class="pad__empty">No games finished yet.</li>';

  document.getElementById('padUndo').disabled = pad.history.length === 0;
}

function padInit() {
  if (!document.getElementById('padSide0')) return;
  pad = padFresh();

  document.querySelectorAll('.pad__side').forEach(btn => {
    btn.addEventListener('click', () => padPoint(Number(btn.dataset.player)));
  });
  document.getElementById('padUndo').addEventListener('click', padUndo);

  document.getElementById('padReset').addEventListener('click', () => {
    if (pad.games.length || pad.score[0] || pad.score[1]) {
      if (!confirm('Start a new match? The current score will be cleared.')) return;
    }
    pad = padFresh();
    padRender();
    padPublishSoon();
  });

  /* The password came from the login, so this is just an on/off switch. */
  document.getElementById('padGoLive').addEventListener('click', () => {
    if (padLive) { padSetLive(false); return; }
    if (!sessionStorage.getItem('nr-pass')) {
      const state = document.getElementById('padLiveState');
      state.textContent = 'Sign in again to publish.';
      state.className = 'pad__publish-state pad__publish-state--bad';
      return;
    }
    padSetLive(true);
    padPublish();
  });

  ['padName0', 'padName1', 'padDept0', 'padDept1', 'padTournament', 'padRound', 'padCourt']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { padRender(); padPublishSoon(); });
    });

  padRender();
}


/* ---------- Login gate ---------- */
const PASS_KEY = 'nr-pass';
const NAME_KEY = 'nr-referee';

function showPad() {
  document.getElementById('refLogin').hidden = true;
  document.getElementById('refPad').hidden = false;
  const who = document.getElementById('refWho');
  const name = sessionStorage.getItem(NAME_KEY);
  if (who && name) {
    who.hidden = false;
    document.getElementById('refWhoName').textContent = name;
  }
  padInit();
  padSetLive(true);
  padPublish();
}

async function tryLogin(pw) {
  const msg = document.getElementById('refLoginMsg');
  msg.textContent = 'Checking…';
  msg.className = 'ref-login__msg';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: '{}'
    });
    if (res.status === 401) {
      msg.textContent = 'Wrong password.';
      msg.className = 'ref-login__msg ref-login__msg--bad';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json().catch(() => ({}));
    sessionStorage.setItem(PASS_KEY, pw);
    sessionStorage.setItem(NAME_KEY, body.name || 'Referee');
    showPad();
  } catch (err) {
    msg.textContent = 'Could not reach the server. You can still score offline — ' +
                      'the match will save on this device but will not publish.';
    msg.className = 'ref-login__msg ref-login__msg--bad';
    document.getElementById('refOffline').hidden = false;
  }
}

document.getElementById('refLoginForm').addEventListener('submit', e => {
  e.preventDefault();
  const pw = document.getElementById('refPass').value;
  if (pw) tryLogin(pw);
});

document.getElementById('refOffline').addEventListener('click', () => {
  document.getElementById('refLogin').hidden = true;
  document.getElementById('refPad').hidden = false;
  padInit();
  padSetLive(false);
  document.getElementById('padLiveState').textContent =
    'Scoring offline. The match will save on this device but is not being published.';
});

/* Already signed in this session? Go straight in. */
if (sessionStorage.getItem(PASS_KEY)) showPad();

/* Signing out clears this device, so the next referee starts clean. */
const signOut = document.getElementById('refSignOut');
if (signOut) {
  signOut.addEventListener('click', () => {
    sessionStorage.removeItem(PASS_KEY);
    sessionStorage.removeItem(NAME_KEY);
    location.reload();
  });
}
