/* ============================================================
   portal.js — the NR Squash Portal
   Reads content/portal.json and draws: the event ticker, the
   event list, the tournament bracket and the rankings table.
   Also runs the referee scoring pad, which is self-contained
   and saves nothing anywhere.
   You should not need to edit this file; the content lives in
   content/portal.json and is editable from /admin.
   ============================================================ */

/* Escape anything that came from the CMS before it goes into the page. */
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/* A status word -> the CSS class that colours its badge. */
function statusClass(s) {
  const k = String(s || '').toLowerCase();
  if (k === 'live') return 'tag tag--live';
  if (k === 'completed') return 'tag tag--done';
  return 'tag tag--soon';
}

/* ---------- Ticker ---------- */
function renderTicker(data) {
  const root = document.getElementById('ticker-root');
  if (!root) return;
  const items = data.events || [];
  if (!items.length) { root.closest('.ticker').style.display = 'none'; return; }

  const one = items.map(e => `
    <span class="ticker__item">
      <span class="${statusClass(e.status)}">${esc(e.status)}</span>
      <strong>${esc(e.name)}</strong>
      <span class="ticker__meta">${esc(e.dates)} · ${esc(e.venue)}</span>
    </span>`).join('');

  /* The strip is printed twice so the loop has no visible gap. */
  root.innerHTML = one + one;
}

/* ---------- Event cards ---------- */
function renderEvents(data) {
  const root = document.getElementById('events-root');
  if (!root) return;
  const items = data.events || [];
  if (!items.length) { root.innerHTML = '<p class="pad__empty">No events listed yet.</p>'; return; }

  root.innerHTML = items.map(e => {
    const buttons = [];
    if (e.draw_url) buttons.push(`<a class="btn btn--solid" href="${esc(e.draw_url)}">View draw</a>`);
    if (e.live_url) buttons.push(`<a class="btn btn--ghost" href="${esc(e.live_url)}">Live scores</a>`);
    return `
    <article class="event">
      <div class="event__head">
        <span class="${statusClass(e.status)}">${esc(e.status)}</span>
        <p class="event__dates">${esc(e.dates)}</p>
      </div>
      <h3 class="event__name">${esc(e.name)}</h3>
      <p class="event__venue">${esc(e.venue)}</p>
      ${buttons.length ? `<div class="event__actions">${buttons.join('')}</div>` : ''}
    </article>`;
  }).join('');
}

/* ---------- Bracket ---------- */
function renderBracket(data) {
  const root = document.getElementById('bracket-root');
  if (!root) return;
  const b = data.bracket;
  if (!b || !(b.rounds || []).length) {
    root.innerHTML = '<p class="pad__empty">No draw published yet.</p>';
    return;
  }

  const slot = (name, seed, isWinner, decided) => {
    if (!name) return `<div class="slot slot--empty">To be decided</div>`;
    const cls = decided ? (isWinner ? ' slot--won' : ' slot--lost') : '';
    return `<div class="slot${cls}">
      <span class="slot__name">${esc(name)}</span>
      ${seed ? `<span class="slot__seed">[${esc(seed)}]</span>` : ''}
    </div>`;
  };

  const rounds = b.rounds.map(r => `
    <div class="bracket__col">
      <h3 class="bracket__round">${esc(r.name)}</h3>
      <div class="bracket__matches">
        ${(r.matches || []).map(m => {
          const decided = String(m.winner) === '1' || String(m.winner) === '2';
          return `
          <div class="match">
            <div class="match__status"><span class="${statusClass(m.status)}">${esc(m.status)}</span></div>
            ${slot(m.p1, m.s1, String(m.winner) === '1', decided)}
            ${slot(m.p2, m.s2, String(m.winner) === '2', decided)}
            ${m.score ? `<p class="match__score">${esc(m.score)}</p>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  root.innerHTML = `
    <div class="bracket__head">
      <h3 class="bracket__title">${esc(b.title)}</h3>
      ${b.subtitle ? `<p class="bracket__sub">${esc(b.subtitle)}</p>` : ''}
    </div>
    <p class="bracket__hint">Scroll sideways to see later rounds</p>
    <div class="bracket">${rounds}</div>`;
}

/* ---------- Rankings: filter by category, sort by any column ---------- */
let rankRows = [];
let rankSort = { key: 'rank', dir: 1 };
let rankFilter = 'all';

function drawRankings() {
  const body = document.getElementById('rank-body');
  if (!body) return;

  const num = v => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n; };

  const rows = rankRows
    .filter(r => rankFilter === 'all' || r.category === rankFilter)
    .sort((a, b) => {
      const x = a[rankSort.key], y = b[rankSort.key];
      const nx = num(x), ny = num(y);
      /* Numeric columns sort numerically, text columns alphabetically. */
      if (nx !== null && ny !== null) return (nx - ny) * rankSort.dir;
      return String(x).localeCompare(String(y)) * rankSort.dir;
    });

  body.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td data-col="rank" class="rank__pos">${esc(r.rank)}</td>
      <td data-col="name" class="rank__name">${esc(r.name)}</td>
      <td data-col="category">${esc(r.category)}</td>
      <td data-col="club">${esc(r.club)}</td>
      <td data-col="points" class="rank__pts">${esc(r.points)}</td>
    </tr>`).join('')
    : `<tr><td colspan="5" class="pad__empty">No players in this category.</td></tr>`;

  document.querySelectorAll('.table th[data-sort]').forEach(th => {
    th.setAttribute('aria-sort',
      th.dataset.sort === rankSort.key ? (rankSort.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

function renderRankings(data) {
  const root = document.getElementById('rankings-root');
  if (!root) return;
  rankRows = data.rankings || [];
  if (!rankRows.length) { root.innerHTML = '<p class="pad__empty">No rankings published yet.</p>'; return; }

  const cats = [...new Set(rankRows.map(r => r.category))];

  root.innerHTML = `
    <div class="years" id="rank-cats">
      <button class="is-active" data-cat="all">All categories</button>
      ${cats.map(c => `<button data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <table class="table rank">
      <thead>
        <tr>
          <th data-sort="rank">Rank</th>
          <th data-sort="name">Player</th>
          <th data-sort="category">Category</th>
          <th data-sort="club">Club</th>
          <th data-sort="points">Points</th>
        </tr>
      </thead>
      <tbody id="rank-body"></tbody>
    </table>`;

  document.getElementById('rank-cats').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#rank-cats button').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    rankFilter = btn.dataset.cat;
    drawRankings();
  });

  root.querySelectorAll('th[data-sort]').forEach(th => {
    th.tabIndex = 0;
    const go = () => {
      const k = th.dataset.sort;
      /* Same column again reverses the direction. */
      rankSort = { key: k, dir: rankSort.key === k ? -rankSort.dir : 1 };
      drawRankings();
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  drawRankings();
}

/* ============================================================
   LIVE PANEL — what viewers of /squash see while a match runs
   ============================================================ */
const LIVE_STALE_MS = 15 * 60 * 1000;   // hide a match nobody has updated in 15 min

function renderLive(list) {
  const root = document.getElementById('live-root');
  if (!root) return;

  if (!list.length) { root.hidden = true; root.innerHTML = ''; return; }

  const d = list[0];
  const p = d.players || [];
  const won = d.games_won || [0, 0];
  const side = i => `
    <div class="livebar__side${d.server === i ? ' livebar__side--serving' : ''}">
      <span class="livebar__name">${esc(p[i]?.name || '')}</span>
      ${p[i]?.dept ? `<span class="livebar__dept">${esc(p[i].dept)}</span>` : ''}
      <span class="livebar__pts">${esc((d.score || [0, 0])[i])}</span>
    </div>`;

  const more = list.length > 1
    ? `<a class="livebar__full" href="live.html">${list.length} matches live</a>`
    : `<a class="livebar__full" href="live.html">Full scoreboard</a>`;

  root.hidden = false;
  root.innerHTML = `
    <div class="livebar">
      <div class="wrap livebar__inner">
        <div class="livebar__meta">
          <span class="tag tag--live">Live</span>
          <span class="livebar__event">${d.court ? 'Court ' + esc(d.court) + ' \u00b7 ' : ''}${esc(d.tournament || '')}${d.round ? ' \u00b7 ' + esc(d.round) : ''}</span>
        </div>
        <div class="livebar__score">
          ${side(0)}
          <span class="livebar__games">${esc(won[0])}\u2013${esc(won[1])}<small>games</small></span>
          ${side(1)}
        </div>
        ${more}
      </div>
    </div>`;
}

async function pollLive() {
  try {
    const res = await fetch('/api/live', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const live = (data.matches || []).filter(m =>
      m && m.live && m.updated && (Date.now() - m.updated < LIVE_STALE_MS));
    renderLive(live);
  } catch { /* offline, or the API is not set up yet — leave the bar hidden */ }
}

/* ---------- Start ---------- */
(async function () {
  pollLive();
  setInterval(pollLive, 8000);
  try {
    const res = await fetch('content/portal.json');
    if (!res.ok) throw new Error('portal.json ' + res.status);
    const data = await res.json();
    renderTicker(data);
    renderEvents(data);
    renderBracket(data);
    renderRankings(data);
  } catch (err) {
    console.error('Portal content failed to load:', err);
    ['events-root', 'bracket-root', 'rankings-root'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="pad__empty">Content could not be loaded. Please refresh.</p>';
    });
  }
})();
