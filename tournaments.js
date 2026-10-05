/* ============================================================
   tournaments.js — the tournament calendar (table view)
   Name and location, divisions, dates, prize money, status.
   Selecting a row opens that tournament's page.
   ============================================================ */
const { esc, status, statusTag, fmtRange } = NR;
let all = [];
let filter = 'All';
const adm = () => !!(window.TournamentsAdmin && TournamentsAdmin.on);

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
  if (!rows.length) { root.innerHTML = (adm() ? '<p><button class="btn btn--solid" id="tadAdd">Add tournament</button></p>' : '') + '<p class="pad__empty">No tournaments here yet.</p>'; return; }

  root.innerHTML = `${adm() ? '<p><button class="btn btn--solid" id="tadAdd">Add tournament</button></p>' : ''}
  <div class="tt">
    <div class="tt__row tt__row--head">
      <span>Tournament</span><span>Divisions</span><span>Date</span><span>Prize money</span><span>Status</span>
    </div>
    ${rows.map(t => `
    <a class="tt__row" href="tournament.html?id=${encodeURIComponent(t.id)}">
      <span class="tt__name" data-l="Tournament">
        <strong>${esc(t.name)}</strong>
        <small>${esc(t.location)}</small>
        ${adm() ? `<span class="tt__admin"><button class="ent-edit" data-tedit="${esc(t.id)}" aria-label="Edit">\u270e</button><button class="ent-del" data-tdel="${esc(t.id)}" aria-label="Delete">\u00d7</button></span>` : ''}
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

document.addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b || !adm()) return;
  if (b.id === 'tadAdd') { TournamentsAdmin.add(all.map(t => t.id)); return; }
  const id = b.dataset.tedit || b.dataset.tdel; if (!id) return;
  ev.preventDefault(); ev.stopPropagation();
  const t = all.find(x => x.id === id); if (!t) return;
  if (b.dataset.tedit) TournamentsAdmin.edit(t);
  else { try { if (await TournamentsAdmin.remove(t)) location.reload(); } catch (err) { alert(err.message); } }
}, true);

NR.tournaments().then(async list => {
  all = list;
  await TournamentsAdmin.ready;
  renderFilters(); renderTable();
}).catch(() => {
  document.getElementById('tournaments-root').innerHTML =
    '<p class="pad__empty">The calendar could not be loaded. Please refresh.</p>';
});
