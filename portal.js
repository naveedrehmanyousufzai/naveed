/* ============================================================
   portal.js — the NR Squash Portal landing page

   Short on purpose: a ticker, the live-match bar, the next few
   tournaments, and the top three in every ranking category.
   Everything else lives on its own page.
   ============================================================ */
const { esc, status, statusTag, fmtRange } = NR;

/* ---------- Ticker ---------- */
function renderTicker(list) {
  const root = document.getElementById('ticker-root');
  if (!root) return;
  const items = list.filter(t => status(t) !== 'Completed');
  if (!items.length) { root.closest('.ticker').style.display = 'none'; return; }

  const one = items.map(t => `
    <a class="ticker__item" href="tournament.html?id=${encodeURIComponent(t.id)}">
      ${statusTag(status(t))}
      <strong>${esc(t.name)}</strong>
      <span class="ticker__meta">${esc(fmtRange(t.start, t.end))} · ${esc(t.location)}</span>
    </a>`).join('');

  /* The strip is printed twice so the loop has no visible gap. */
  root.innerHTML = one + one;
}

/* ---------- Next few tournaments ---------- */
function renderUpcoming(list) {
  const root = document.getElementById('upcoming-root');
  if (!root) return;
  const rank = { 'In play': 0, 'Upcoming': 1, 'Scheduled': 2 };
  const next = list
    .filter(t => status(t) !== 'Completed')
    .sort((a, b) => (rank[status(a)] - rank[status(b)]) || String(a.start).localeCompare(String(b.start)))
    .slice(0, 4);

  if (!next.length) { root.innerHTML = '<p class="pad__empty">No upcoming tournaments listed yet.</p>'; return; }

  root.innerHTML = next.map(t => `
    <a class="event event--link" href="tournament.html?id=${encodeURIComponent(t.id)}">
      <div class="event__head">
        ${statusTag(status(t))}
        <p class="event__dates">${esc(fmtRange(t.start, t.end))}</p>
      </div>
      <h3 class="event__name">${esc(t.name)}</h3>
      <p class="event__venue">${esc(t.location)}</p>
      <p class="event__divs">${(t.divisions || []).length} division${(t.divisions || []).length === 1 ? '' : 's'}${t.prize_money ? ' · ' + esc(t.prize_money) : ''}</p>
    </a>`).join('');
}

/* ---------- Top three per category ---------- */
function renderTop3(data) {
  const root = document.getElementById('rankings-root');
  if (!root) return;
  const cats = data.categories || [];
  const players = data.players || [];

  const group = name => /^boys/i.test(name) ? 'Boys' : /^girls/i.test(name) ? 'Girls' : 'Senior';
  const groups = {};
  cats.forEach(c => { (groups[group(c)] = groups[group(c)] || []).push(c); });

  root.innerHTML = ['Boys', 'Girls', 'Senior'].filter(g => groups[g]).map(g => `
    <h3 class="rk-group">${g === 'Senior' ? 'Men and women' : g}</h3>
    <div class="rk-grid">
      ${groups[g].map(c => {
        const top = players.filter(p => p.category === c)
          .sort((a, b) => Number(a.rank) - Number(b.rank)).slice(0, 3);
        return `
        <article class="rk-card">
          <h4 class="rk-card__name"><a href="rankings.html?cat=${encodeURIComponent(c)}">${esc(c)}</a></h4>
          ${top.length ? `<ol class="rk-card__list">
            ${top.map(p => `<li><span class="rk-card__rank">${esc(p.rank)}</span>
              <span class="rk-card__who">${esc(p.name)}<small>${esc(p.club || '')}</small></span>
              <span class="rk-card__pts">${esc(p.points || '')}</span></li>`).join('')}
          </ol>` : '<p class="pad__empty">No ranking yet.</p>'}
        </article>`;
      }).join('')}
    </div>`).join('');
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
    const list = await NR.tournaments();
    renderTicker(list);
    renderUpcoming(list);
  } catch (err) {
    console.error('Tournaments failed to load:', err);
    document.getElementById('upcoming-root').innerHTML =
      '<p class="pad__empty">Tournaments could not be loaded. Please refresh.</p>';
  }

  try {
    renderTop3(await NR.loadRankings());
  } catch (err) {
    console.error('Rankings failed to load:', err);
    document.getElementById('rankings-root').innerHTML =
      '<p class="pad__empty">Rankings could not be loaded. Please refresh.</p>';
  }
})();
