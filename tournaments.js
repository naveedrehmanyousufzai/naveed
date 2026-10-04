/* ============================================================
   tournaments.js — the tournament calendar (table view)
   Name and location, divisions, dates, prize money, status.
   Selecting a row opens that tournament's page.
   ============================================================ */
const { esc, status, statusTag, fmtRange } = NR;
let all = [];
let filter = 'All';

function renderFilters() {
  const box = document.getElementById('statusFilters');
  const counts = {};
  all.forEach(t => { const s = status(t); counts[s] = (counts[s] || 0) + 1; });
  const items = ['All', ...NR.STATUSES];
  box.innerHTML = items.map(s => `
    <button class="chip${s === filter ? ' chip--on' : ''}" data-f="${esc(s)}">
      ${esc(s)}${s === 'All' ? ` (${all.length})` : counts[s] ? ` (${counts[s]})` : ''}
    </button>`).join('');
}

function renderTable() {
  const root = document.getElementById('tournaments-root');
  const rows = all.filter(t => filter === 'All' || status(t) === filter);
  if (!rows.length) { root.innerHTML = '<p class="pad__empty">No tournaments here yet.</p>'; return; }

  root.innerHTML = `
  <div class="tt">
    <div class="tt__row tt__row--head">
      <span>Tournament</span><span>Divisions</span><span>Date</span><span>Prize money</span><span>Status</span>
    </div>
    ${rows.map(t => `
    <a class="tt__row" href="tournament.html?id=${encodeURIComponent(t.id)}">
      <span class="tt__name" data-l="Tournament">
        <strong>${esc(t.name)}</strong>
        <small>${esc(t.location)}</small>
      </span>
      <span class="tt__divs" data-l="Divisions">${(t.divisions || []).map(d => `<i>${esc(d)}</i>`).join('') || '—'}</span>
      <span class="tt__date" data-l="Date">${esc(fmtRange(t.start, t.end))}</span>
      <span class="tt__prize" data-l="Prize money">${esc(t.prize_money || '—')}</span>
      <span class="tt__status" data-l="Status">${statusTag(status(t))}</span>
    </a>`).join('')}
  </div>`;
}

document.getElementById('statusFilters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  renderFilters(); renderTable();
});

NR.tournaments().then(list => {
  /* Newest first among finished ones, otherwise by start date */
  all = list;
  renderFilters(); renderTable();
}).catch(() => {
  document.getElementById('tournaments-root').innerHTML =
    '<p class="pad__empty">The calendar could not be loaded. Please refresh.</p>';
});
