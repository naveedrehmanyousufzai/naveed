/* ============================================================
   live.js — every match running right now

   Polls /api/live, which returns one entry per court, and draws
   a card for each. Read-only: nothing here changes a score.
   ============================================================ */

const POLL_MS = 5000;
const STALE_MS = 15 * 60 * 1000;   // a match nobody has touched is not live

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

function card(m) {
  const p = m.players || [];
  const score = m.score || [0, 0];
  const won = m.games_won || [0, 0];

  const side = i => `
    <div class="lm__side${m.server === i && !m.done ? ' lm__side--serving' : ''}">
      <div class="lm__who">
        <span class="lm__name">${esc(p[i]?.name || '')}${m.server === i && !m.done && m.side
          ? `<span class="lm__side-tag">serving ${esc(m.side)}</span>` : ''}</span>
        ${p[i]?.dept ? `<span class="lm__dept">${esc(p[i].dept)}</span>` : ''}
      </div>
      <span class="lm__pts">${esc(score[i])}</span>
    </div>`;

  const games = (m.games || [])
    .map((g, n) => `<li><b>G${n + 1}</b> ${esc(g[0])}–${esc(g[1])}</li>`).join('');

  return `
  <article class="lm">
    <header class="lm__head">
      <span class="lm__court">Court ${esc(m.court)}</span>
      <span class="${m.done ? 'tag tag--done' : 'tag tag--live'}">${m.done ? 'Finished'
        : m.phase === 'warmup' ? 'Warm-up' : m.phase === 'interval' ? 'Rest' : m.phase === 'ready' ? 'Starting' : 'Live'}</span>
    </header>

    <p class="lm__event">${esc(m.tournament || '')}${m.round ? ' · ' + esc(m.round) : ''}</p>

    ${side(0)}
    <div class="lm__games">
      <span>${esc(won[0])}–${esc(won[1])} games</span>
      ${games ? `<ul class="lm__history">${games}</ul>` : ''}
    </div>
    ${side(1)}

    <a class="lm__open" href="scoreboard.html?court=${encodeURIComponent(m.court)}">
      Open full screen
    </a>
  </article>`;
}

function render(list) {
  const root = document.getElementById('live-grid');

  if (!list.length) {
    root.innerHTML = `
      <div class="lm-empty">
        <p class="lm-empty__big">No matches are being played right now.</p>
        <p class="pad__empty">When a referee starts scoring, the match will appear here
        within a few seconds. You can leave this page open.</p>
      </div>`;
    return;
  }

  root.innerHTML = `<div class="lm-grid">${list.map(card).join('')}</div>`;
}

async function poll() {
  try {
    const res = await fetch('/api/live', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const fresh = (data.matches || []).filter(m =>
      m && m.updated && (Date.now() - m.updated < STALE_MS));
    render(fresh);
  } catch (err) {
    const root = document.getElementById('live-grid');
    if (!root.innerHTML.trim()) {
      root.innerHTML = `<p class="pad__empty">Live scores are not reachable right now.
      This page will keep trying.</p>`;
    }
  }
}

poll();
setInterval(poll, POLL_MS);


/* ---------- Today's matches, from the schedule ---------- */
const fmt = t => {
  if (!t) return '';
  const d = new Date(t);
  return isNaN(d) ? t : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

async function loadSchedule() {
  const root = document.getElementById('sched');
  if (!root) return;
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    const s = res.ok ? await res.json() : null;
    if (!s || !s.matches) { root.innerHTML = ''; return; }

    const rows = s.matches
      .filter(m => m.status !== 'bye' && (m.p1 || m.p2) && m.p1 && m.p2)
      .sort((a, b) => String(a.time || '~').localeCompare(String(b.time || '~')));
    if (!rows.length) { root.innerHTML = ''; return; }

    root.innerHTML = `
      <hr class="rule">
      <div class="section-head"><h2>Schedule</h2></div>
      <p class="pad__intro">${esc(s.tournament || '')}${s.event ? ' · ' + esc(s.event) : ''}</p>
      ${rows.map(m => `
        <div class="sched__row">
          <span class="sched__time">${esc(fmt(m.time) || 'Time to be set')}${m.court ? '<br>Court ' + esc(m.court) : ''}</span>
          <span class="sched__who">${esc(m.p1.name)} v ${esc(m.p2.name)}
            <span class="sched__meta">${esc(m.round)}${m.referee ? ' · Referee ' + esc(m.referee) : ''}</span></span>
          <span class="sched__res">${m.status === 'done' ? esc(m.score)
            : m.status === 'live' ? '<span class="tag tag--live">Live</span>' : ''}</span>
        </div>`).join('')}`;
  } catch { /* leave it as it was */ }
}
loadSchedule();
setInterval(loadSchedule, 30000);
