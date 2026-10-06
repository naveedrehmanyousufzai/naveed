/* ============================================================
   scoreboard.js — the big-screen venue display

   Polls /api/live and paints the current match. Read-only: there
   is nothing to press. The referee pad on /squash publishes to it.

   The game clock is worked out without comparing clocks between
   machines: each update tells us how long the game had been
   running when it was sent, and we count on locally from there.
   ============================================================ */

const POLL_MS = 3000;
const STALE_MS = 15 * 60 * 1000;   // give up on a match nobody has touched

const $ = id => document.getElementById(id);
const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

let clockBase = 0;        // ms the game had run at the last update
let clockTakenAt = 0;     // when we received that update (local clock)
let clockAnchor = 0;      // the d.updated we anchored to
let haveMatch = false;

function mmss(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

let cur = null;           // the match on screen
let leftBase = 0;         // ms left in a warm-up / rest, at the last update

/* Warm-up and rest count DOWN; a game counts UP. The announcement of the
   last decision stays up for a few seconds. */
function tickClock() {
  if (!haveMatch || !cur) return;
  const now = Date.now();
  const timed = cur.phase === 'warmup' || cur.phase === 'interval';

  if (timed) {
    const left = Math.max(0, leftBase - (now - clockTakenAt));
    txt('bClock', mmss(Math.ceil(left / 1000) * 1000));
    txt('bClockLabel', cur.phase === 'warmup' ? 'Warm-up left' : 'Rest left');
    $('bClock').classList.add('board__clocktime--count');

    const n = (cur.games || []).length + 1;
    const second = cur.phase === 'warmup' && left <= (cur.phase_len || 300000) / 2;
    $('bPhase').hidden = false;
    $('bPhase').innerHTML = cur.phase === 'warmup'
      ? `Warm-up<small>${left === 0 ? 'Warm-up over' : second ? 'Second half · switch sides' : 'First half'}</small>`
      : `Rest<small>${left === 0 ? 'Time — game ' + n + ' next' : 'Game ' + n + ' next'}</small>`;
  } else {
    $('bPhase').hidden = true;
    $('bClock').classList.remove('board__clocktime--count');
    txt('bClockLabel', 'Game time');
    txt('bClock', cur.game_started ? mmss(clockBase + (now - clockTakenAt)) : '0:00');
  }

  const call = $('bCall');
  const shown = cur.call && (cur.call.age + (now - clockTakenAt) < 8000);
  call.hidden = !shown;
  if (shown && call.textContent !== cur.call.text) call.textContent = cur.call.text;
}

function show(on) {
  if (!on) clockAnchor = 0;
  $('boardLive').hidden = !on;
  $('boardWaiting').hidden = on;
  haveMatch = on;
}

/* The tournament logo comes with the schedule, so it is fetched once in a
   while rather than sent with every point. */
let schedules = [];
let tournamentLogos = {};
async function loadSchedule() {
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    if (res.ok) schedules = (await res.json()).schedules || [];
  } catch { /* keep the last ones */ }
  try {
    const t = await (await fetch('/api/tournaments', { cache: 'no-store' }).then(r => r.ok ? r : fetch('content/tournaments.json'))).json();
    tournamentLogos = {};
    (t.tournaments || []).forEach(x => { if (x.logo) tournamentLogos[x.id] = x.logo; });
  } catch { /* optional */ }
}

const DEFAULT_LOGO = 'images/nr-logo.png';
function setLogo(d) {
  const img = $('bLogo');
  const sc = schedules.find(s => s.id === d.sched_id) ||
    schedules.find(s => d.tournament && String(s.tournament || '').trim().toLowerCase() === String(d.tournament).trim().toLowerCase());
  const own = sc && sc.logo;
  const fromTournament = tournamentLogos[d.tournament_id || (sc && sc.tournamentId)];
  const want = own || fromTournament || DEFAULT_LOGO;
  if (img.getAttribute('src') !== want) img.src = want;
  img.classList.toggle('board__logo--event', want !== DEFAULT_LOGO);
}

function paint(d) {
  const fresh = d && d.updated && (Date.now() - d.updated < STALE_MS);
  if (!fresh) { show(false); return; }

  /* Changing court restarts the clock anchor. */
  if (d.court !== undefined && d.court !== paint._court) {
    paint._court = d.court;
    clockAnchor = 0;
  }

  const p = d.players || [];
  const score = d.score || [0, 0];
  const won = d.games_won || [0, 0];

  txt('bTournament', d.tournament || '');
  setLogo(d);
  txt('bRound', [d.court ? 'Court ' + d.court : '', d.round || '']
    .filter(Boolean).join(' \u00b7 '));

  for (let i = 0; i < 2; i++) {
    txt('bName' + i, p[i]?.name || '');
    txt('bDept' + i, [p[i]?.dept, p[i]?.country].filter(Boolean).join(' \u00b7 '));
    txt('bPts' + i, score[i]);
    txt('bG' + i, won[i]);
    const serving = d.server === i && !d.done;
    $('bServe' + i).style.visibility = serving ? 'visible' : 'hidden';
    $('bServe' + i).innerHTML = serving
      ? '● serving' + (d.side
          ? `<span class="board__sideflag" aria-label="${d.side === 'L' ? 'left' : 'right'} box">${d.side}</span>`
          : '<span class="board__sideflag board__sideflag--wait">…</span>')
      : '';
    $('bSide' + i).classList.toggle('board__player--serving', d.server === i && !d.done);
  }

  /* Finished games, left to right */
  $('bHistory').innerHTML = (d.games || [])
    .map((g, n) => `<li><b>G${n + 1}</b> ${g[0]}–${g[1]}</li>`).join('');

  /* Status line */
  const state = $('bState');
  if (d.done) {
    const w = d.winner === 0 || d.winner === 1 ? d.winner : (won[0] > won[1] ? 0 : 1);
    state.textContent = `${p[w]?.name || 'Winner'} wins ${won[w]}–${won[1 - w]}` +
      (d.end_note === 'retired' ? ' (retirement)' : d.end_note === 'conduct' ? ' (conduct)' : '');
    state.className = 'board__result';
  } else if (d.phase === 'warmup' || d.phase === 'interval' || d.phase === 'ready') {
    state.textContent = d.phase === 'warmup' ? 'Warm-up'
      : d.phase === 'ready' ? 'Match about to start'
      : `Rest before game ${(d.games || []).length + 1}`;
    state.className = '';
  } else {
    const [a, b] = score;
    let note = `Game ${(d.games || []).length + 1} · first to 11, win by 2`;
    if (a >= 10 && b >= 10) note = 'Two clear points needed';
    else if (a >= 10 && a - b >= 1) note = `Game ball — ${p[0]?.name || ''}`;
    else if (b >= 10 && b - a >= 1) note = `Game ball — ${p[1]?.name || ''}`;
    state.textContent = note;
    state.className = '';
  }

  /* Clocks, anchored to the moment this update was produced */
  cur = d;
  if (d.updated && d.updated !== clockAnchor) {
    clockAnchor = d.updated;
    clockBase = d.game_started ? Math.max(0, d.updated - d.game_started) : 0;
    leftBase = d.phase_left || 0;
    clockTakenAt = Date.now();
  }

  txt('bStamp', 'Updated ' +
    new Date(d.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  show(true);
  tickClock();
}

/* ---------- Which match to show ----------
   scoreboard.html?court=2  pins that court.
   With no court, it cycles through everything that is live, so one
   screen can cover several courts. */
const pinned = new URLSearchParams(location.search).get('court');
let rotation = [];
let rotateAt = 0;
let shownCourt = null;

const ROTATE_MS = 20000;

function choose(matches) {
  const live = matches.filter(m => m && m.updated && (Date.now() - m.updated < STALE_MS));
  if (!live.length) return null;

  if (pinned) return live.find(m => String(m.court) === String(pinned)) || null;

  rotation = live.map(m => String(m.key || m.court));
  if (!shownCourt || !rotation.includes(shownCourt)) {
    shownCourt = rotation[0];
    rotateAt = Date.now() + ROTATE_MS;
  } else if (rotation.length > 1 && Date.now() > rotateAt) {
    const i = rotation.indexOf(shownCourt);
    shownCourt = rotation[(i + 1) % rotation.length];
    rotateAt = Date.now() + ROTATE_MS;
  }
  return live.find(m => String(m.key || m.court) === shownCourt) || live[0];
}

async function poll() {
  try {
    const url = pinned ? '/api/live?court=' + encodeURIComponent(pinned) : '/api/live';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    /* One court comes back as the match itself; the list comes back wrapped. */
    const matches = pinned ? (data ? [data] : []) : (data.matches || []);
    paint(choose(matches));
  } catch (err) {
    console.warn('Scoreboard poll failed:', err.message);
  }
}

loadSchedule().then(poll);
setInterval(loadSchedule, 60000);
setInterval(poll, POLL_MS);
setInterval(tickClock, 500);
