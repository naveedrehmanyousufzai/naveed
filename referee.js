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
    side: null,            // 'L' or 'R': the box the server serves from
    sideFree: true,        // true while the server may still pick the side
    matchId: null,         // which scheduled match this is, if any
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

/* SERVING RULES
   - The server serves from L or R. If the server wins the rally, the
     next serve is from the other box.
   - If the receiver wins, they become the server and may choose
     either box, so the side is left open until the referee picks it.
   - The winner of a game serves first in the next, and chooses a box. */
function padCanScore() {
  return !pad.done && pad.server !== null && pad.side !== null;
}

function padPoint(i) {
  if (!padCanScore()) return;
  pad.history.push(padSnapshot());
  const before = { sv: pad.server, sd: pad.side };
  pad.score[i]++;
  pad.rallies.push({
    g: pad.games.length + 1,            // which game
    w: i,                               // who won the rally
    a: pad.score[0], b: pad.score[1],   // running score after it
    sv: before.sv, sd: before.sd        // who served, from which side
  });

  if (i === before.sv) {                // server won: other box next
    pad.side = before.sd === 'L' ? 'R' : 'L';
    pad.sideFree = false;
  } else {                              // receiver won: new server, free choice
    pad.server = i;
    pad.side = null;
    pad.sideFree = true;
  }

  const w = padGameWinner();
  if (w !== null) {
    pad.games.push([pad.score[0], pad.score[1]]);
    pad.score = [0, 0];
    pad.server = w;                     // game winner serves first next game
    pad.side = null;
    pad.sideFree = true;
    pad.gameStarted = Date.now();       // game clock restarts
    if (padGamesWon()[w] >= PAD_GAMES_TO_WIN) {
      pad.done = true;
      padArchive();                     // keep it for the printed scoresheet
      padReportResult(w);
    }
  }
  padRender();
  padPublishSoon();
}

function padPickServer(i) {
  if (pad.done || pad.score[0] || pad.score[1] || !pad.sideFree) return;
  pad.server = i;
  padRender();
  padPublishSoon();
}

function padPickSide(side) {
  if (pad.done || pad.server === null || !pad.sideFree) return;
  pad.side = side;
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
      match_id: pad.matchId,
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
    side: pad.side,
    match_id: pad.matchId,
    done: pad.done,
    started: pad.started,
    game_started: pad.gameStarted,
    rallies: pad.rallies.slice(-40),
    updated: now
  };
}

/* Nothing goes on the big screen until a match is chosen or the referee
   starts scoring — signing in alone must not put "Player 1 v Player 2" up. */
let padTouched = false;
function padActive() {
  return !!pad.matchId || padTouched || pad.server !== null || pad.games.length > 0 ||
         pad.score[0] > 0 || pad.score[1] > 0;
}

async function padPublish() {
  if (!padLive) return;
  const state = document.getElementById('padLiveState');
  if (!padActive()) {
    state.textContent = 'Ready. Nothing is shown on the site until you pick a match or start scoring.';
    state.className = 'pad__publish-state';
    return;
  }
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

function padRenderServeBar(names) {
  const bar = document.getElementById('padServeBar');
  if (!bar) return;
  if (pad.done) { bar.hidden = true; return; }
  bar.hidden = false;

  /* The server can be changed only before the first rally of a game. */
  const canPickServer = !pad.score[0] && !pad.score[1] && pad.sideFree;
  const chips = [0, 1].map(i => `
    <button class="pad__chip${pad.server === i ? ' pad__chip--on' : ''}" data-srv="${i}"
      ${canPickServer ? '' : 'disabled'}>${esc(names[i])}</button>`).join('');

  const sides = ['L', 'R'].map(sd => `
    <button class="pad__chip pad__chip--side${pad.side === sd ? ' pad__chip--on' : ''}" data-sd="${sd}"
      ${pad.sideFree && pad.server !== null ? '' : 'disabled'}
      aria-label="Serve from ${sd === 'L' ? 'left' : 'right'}">${sd}</button>`).join('');

  bar.innerHTML = `
    <div class="pad__serve-row"><span class="pad__serve-q">Server</span>${chips}</div>
    <div class="pad__serve-row"><span class="pad__serve-q">Serving from</span>${sides}</div>`;
}

function padRender() {
  const names = padNames();
  const won = padGamesWon();

  for (let i = 0; i < 2; i++) {
    document.getElementById('padScore' + i).textContent = pad.score[i];
    document.getElementById('padLabel' + i).textContent = names[i];
    const sv = document.getElementById('padServe' + i);
    sv.style.visibility = (pad.server === i && !pad.done) ? 'visible' : 'hidden';
    sv.textContent = pad.side ? 'serving from ' + pad.side : 'serving — pick a side';
    document.getElementById('padSide' + i).disabled = !padCanScore();
  }
  padRenderServeBar(names);

  document.getElementById('padGames').innerHTML =
    `<span class="pad__gamecount">${won[0]}</span>
     <span class="pad__gamelabel">games</span>
     <span class="pad__gamecount">${won[1]}</span>`;

  const st = document.getElementById('padStatus');
  if (!pad.done && !padCanScore()) {
    st.textContent = pad.server === null
      ? 'Choose who serves first, then the side.'
      : `${names[pad.server]} — choose L or R to serve from.`;
    st.className = 'pad__status pad__serve-need';
  } else if (pad.done) {
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

  document.getElementById('padServeBar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.srv !== undefined) padPickServer(Number(b.dataset.srv));
    if (b.dataset.sd) padPickSide(b.dataset.sd);
  });
  document.getElementById('padMineRefresh').addEventListener('click', loadMine);
  document.getElementById('padMineList').addEventListener('click', e => {
    const b = e.target.closest('[data-start]');
    if (b) startScheduled(b.dataset.start);
  });

  document.getElementById('padReset').addEventListener('click', () => {
    if (pad.games.length || pad.score[0] || pad.score[1]) {
      if (!confirm('Start a new match? The current score will be cleared.')) return;
    }
    pad = padFresh();
    padTouched = false;
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
      if (el) el.addEventListener('input', () => { padTouched = true; padRender(); padPublishSoon(); });
    });

  padRender();
}


/* ---------- Matches assigned to this referee ---------- */
let schedule = null;

const fmtTime = t => {
  if (!t) return 'time not set';
  const d = new Date(t);
  return isNaN(d) ? t : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

async function loadMine() {
  const box = document.getElementById('padMineList');
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    schedule = res.ok ? await res.json() : null;
  } catch { schedule = null; }

  if (!schedule || !schedule.matches) {
    box.innerHTML = '<p class="pad__empty">No schedule is published yet. You can still score a match by hand below.</p>';
    return;
  }

  const me = sessionStorage.getItem(NAME_KEY) || '';
  const mine = schedule.matches
    .filter(m => m.p1 && m.p2 && m.status !== 'done' && m.status !== 'bye')
    .filter(m => me === 'Admin' || m.referee === me)
    .sort((a, b) => String(a.time || '~').localeCompare(String(b.time || '~')));

  box.innerHTML = mine.length ? mine.map(m => `
    <div class="mine__card${pad && pad.matchId === m.id ? ' mine__card--on' : ''}">
      <div>
        <div class="mine__when">${esc(fmtTime(m.time))}${m.court ? ' · Court ' + esc(m.court) : ''}</div>
        <div class="mine__who">${esc(m.p1.name)} <span class="mine__meta">v</span> ${esc(m.p2.name)}</div>
        <div class="mine__meta">${esc(schedule.tournament || '')} · ${esc(m.round)}${me === 'Admin' && m.referee ? ' · ' + esc(m.referee) : ''}</div>
      </div>
      <button class="btn btn--solid" data-start="${esc(m.id)}">Score this match</button>
    </div>`).join('')
    : '<p class="pad__empty">Nothing is assigned to you right now. Matches appear here when both players are known.</p>';
}

function startScheduled(id) {
  const m = schedule && schedule.matches.find(x => x.id === id);
  if (!m) return;
  if (pad.matchId !== id && (pad.games.length || pad.score[0] || pad.score[1]) && !pad.done) {
    if (!confirm('Switch to this match? The score on the pad will be cleared.')) return;
  }
  const set = (f, v) => { const el = document.getElementById(f); if (el) el.value = v || ''; };
  set('padCourt', m.court || '1');
  set('padTournament', schedule.tournament);
  set('padRound', [schedule.event, m.round].filter(Boolean).join(' · '));
  set('padName0', m.p1.name); set('padDept0', m.p1.club);
  set('padName1', m.p2.name); set('padDept1', m.p2.club);

  pad = padFresh();
  pad.matchId = m.id;
  padTouched = true;
  padRender();
  padPublish();
  padReportLive();
  loadMine();
  window.scrollTo({ top: document.getElementById('padScore0').getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' });
}

/* Tell the server this match is live / finished, so the schedule and the
   draw update and the winner moves on to the next round. */
async function padReport(body) {
  if (!pad.matchId || !sessionStorage.getItem(PASS_KEY)) return;
  try {
    await fetch('/api/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS_KEY) },
      body: JSON.stringify({ id: pad.matchId, ...body })
    });
  } catch (err) { console.warn('Could not report the result:', err); }
}
const padReportLive = () => padReport({ status: 'live' });
async function padReportResult(winner) {
  const score = pad.games.map(g => g[0] + '-' + g[1]).join(', ');
  await padReport({ status: 'done', winner, score });
  loadMine();
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
  loadMine();
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
