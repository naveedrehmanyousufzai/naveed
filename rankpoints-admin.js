/* ============================================================
   rankpoints-admin.js — organiser: rankings from finishing positions

   1. "Load results from draws" reads every published draw and works out
      where each player finished (winner 1, final loser 2, semi-final
      losers 3, quarter-final losers 5, round of 16 losers 9, ...).
   2. Each tournament has a level; points = table points x level.
   3. Ranking score = all points added up / divisor (default 10).
   Anything can be corrected by hand before publishing.
   ============================================================ */
(function () {
  const PASS = 'nr-pass';
  const $ = id => document.getElementById(id);
  const e = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const root = $('rankpoints-admin');
  if (!root) return;

  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS) || '' });
  async function check() {
    if (!sessionStorage.getItem(PASS)) return false;
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: headers(), body: '{}' });
      return r.ok && (await r.json()).name === 'Admin';
    } catch { return false; }
  }

  let S = { config: JSON.parse(JSON.stringify(NR.DEFAULT_RANK_CONFIG)), tlevels: {}, events: [] };
  let open = new Set();

  function normCat(text) {
    const t = String(text || '').trim().toLowerCase().replace(/[._]/g, ' ').replace(/\bgirl[a-z]*\b/g, 'girls').replace(/\bboy[a-z]*\b/g, 'boys');
    const m = t.match(/\b(boys|girls|b|g)\s*-?\s*(?:u|under)?\s*-?\s*(9|11|13|15|17|19)\b/) || t.match(/\bunder\s*-?\s*(9|11|13|15|17|19)\s*(boys|girls)\b/);
    if (m) {
      const sex = isNaN(m[1]) ? m[1] : m[2], age = isNaN(m[1]) ? m[2] : m[1];
      return (sex[0] === 'b' ? 'Boys' : 'Girls') + ' Under ' + age;
    }
    if (/^(open )?(men|mens|men's|male)\b/.test(t)) return 'Men';
    if (/^(open )?(women|womens|women's|ladies|female)\b/.test(t)) return 'Women';
    return String(text || '').trim();
  }

  /* Finishing positions of a knockout schedule */
  function fromSchedule(s) {
    const ms = (s.matches || []).filter(m => m.ref && m.ref.ri !== undefined);
    if (!ms.length) return { results: [], complete: false, groups: true };
    const R = Math.max(...ms.map(m => m.ref.ri)) + 1;
    const out = new Map();
    let complete = false;
    ms.forEach(m => {
      if (m.status !== 'done' || !m.p1 || !m.p2 || (m.winner !== 0 && m.winner !== 1)) return;
      const win = m.winner === 0 ? m.p1 : m.p2, lose = m.winner === 0 ? m.p2 : m.p1;
      out.set(lose.name, { name: lose.name, club: lose.club || '', pos: Math.pow(2, R - m.ref.ri - 1) + 1 });
      if (m.ref.ri === R - 1) { out.set(win.name, { name: win.name, club: win.club || '', pos: 1 }); complete = true; }
    });
    return { results: [...out.values()].sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name)), complete };
  }

  async function loadFromDraws() {
    const st = $('rpState');
    st.textContent = 'Reading the draws…';
    try {
      const [sr, tr] = await Promise.all([fetch('/api/schedule', { cache: 'no-store' }), NR.tournaments()]);
      const schedules = sr.ok ? (await sr.json()).schedules || [] : [];
      const byT = new Map(tr.map(t => [t.id, t]));
      const old = new Map(S.events.map(ev => [ev.id, ev]));
      let added = 0;
      schedules.forEach(s => {
        const got = fromSchedule(s);
        const prev = old.get(s.id);
        const t = byT.get(s.tournamentId) || {};
        if (prev && prev.manual) return;                       // hand-corrected: leave alone
        const ev = {
          id: s.id, tid: s.tournamentId || '', tournament: s.tournament || t.name || '', date: t.start || '',
          division: s.event || '', category: prev ? prev.category : normCat(s.event),
          include: prev ? prev.include : got.complete, manual: false,
          note: got.groups ? 'Group draw — enter the positions by hand' : (got.complete ? '' : 'Not finished yet'),
          results: got.results
        };
        if (!prev) added++;
        old.set(s.id, ev);
      });
      S.events = [...old.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.division.localeCompare(b.division));
      S.events.forEach(ev => { if (ev.tid && !S.tlevels[ev.tid]) S.tlevels[ev.tid] = (S.config.levels[1] || S.config.levels[0] || {}).name || ''; });
      st.textContent = added ? added + ' new event(s) found. Check the levels, then Save.' : 'Up to date.';
    } catch (err) { st.textContent = 'Could not read the draws: ' + err.message; }
    render();
  }

  function render() {
    const lv = S.config.levels;
    const tids = [...new Set(S.events.map(ev => ev.tid))];
    const tname = tid => (S.events.find(ev => ev.tid === tid) || {}).tournament || tid || 'Other';
    const preview = NR.computeRanking(S);
    const cats = [...new Set(preview.map(p => p.category))];

    $('rpBody').innerHTML = `
    <div class="res-admin__box">
      <h3>1 · Points for finishing position</h3>
      <p class="pad__intro">A player who finishes at or below a position (and above the next one) gets those points. 3 = both semi-final losers, 5 = quarter-final losers, 9 = round of 16, and so on.</p>
      <div class="rp-grid">${S.config.table.map((r, i) => `
        <label class="pad__field"><span>Position ${e(r[0])}${i < S.config.table.length - 1 ? '–' + (S.config.table[i + 1][0] - 1) : '+'}</span>
          <input class="pad__name" type="number" min="0" step="any" data-tbl="${i}" value="${e(r[1])}"></label>`).join('')}</div>
    </div>
    <div class="res-admin__box">
      <h3>2 · Tournament levels</h3>
      <div class="rp-grid">${lv.map((l, i) => `
        <label class="pad__field"><span>${e(l.name)} ×</span><input class="pad__name" type="number" min="0" step="any" data-lvl="${i}" value="${e(l.mult)}"></label>`).join('')}
        <label class="pad__field"><span>Divide total by</span><input class="pad__name" type="number" min="1" step="1" id="rpDiv" value="${e(S.config.divisor)}"></label></div>
      <p class="pad__intro">Ranking score = (all points) ÷ ${e(S.config.divisor)}.</p>
    </div>
    <div class="res-admin__box">
      <h3>3 · Events</h3>
      <p><button class="btn btn--solid" id="rpLoad" type="button">Load results from draws</button>
      <button class="btn btn--ghost" id="rpAddEv" type="button">Add an event by hand</button></p>
      ${!S.events.length ? '<p class="pad__empty">No events yet. Press “Load results from draws”.</p>' : tids.map(tid => `
        <h4 class="rp-t">${e(tname(tid))}
          <select class="pad__name" data-tlevel="${e(tid)}">${lv.map(l => `<option${(S.tlevels[tid] || '') === l.name ? ' selected' : ''}>${e(l.name)}</option>`).join('')}</select></h4>
        ${S.events.map((ev, i) => ev.tid !== tid ? '' : `
        <div class="rp-ev${ev.include === false ? ' rp-ev--off' : ''}">
          <label class="rp-ev__inc"><input type="checkbox" data-inc="${i}" ${ev.include !== false ? 'checked' : ''}> count</label>
          <input class="pad__name" data-cat="${i}" value="${e(ev.category)}" aria-label="Ranking category" placeholder="Ranking category">
          <span class="rp-ev__meta">${e(ev.division)} · ${ev.results.length} players${ev.note ? ' · <em>' + e(ev.note) + '</em>' : ''}</span>
          <button class="btn btn--ghost" data-edit="${i}" type="button">${open.has(i) ? 'Close' : 'Edit results'}</button>
          <button class="ent-del" data-delev="${i}" type="button" aria-label="Remove event">×</button>
          ${open.has(i) ? `<table class="table plain-table rp-res"><thead><tr><th>Position</th><th>Player</th><th>Club</th><th></th></tr></thead><tbody>
            ${ev.results.map((r, j) => `<tr><td><input class="pad__name" type="number" min="1" data-r="${i}.${j}.pos" value="${e(r.pos)}"></td>
              <td><input class="pad__name" data-r="${i}.${j}.name" value="${e(r.name)}"></td>
              <td><input class="pad__name" data-r="${i}.${j}.club" value="${e(r.club)}"></td>
              <td><button class="ent-del" data-delr="${i}.${j}" type="button">×</button></td></tr>`).join('')}</tbody></table>
            <button class="btn btn--ghost" data-addr="${i}" type="button">Add player</button>` : ''}
        </div>`).join('')}`).join('')}
    </div>
    <div class="res-admin__box">
      <h3>4 · Preview and publish</h3>
      <p class="pad__intro">${cats.length ? cats.map(c => e(c) + ' (' + preview.filter(p => p.category === c).length + ')').join(' · ') : 'Nothing counts yet.'}</p>
      <button class="btn btn--solid" id="rpSave" type="button">Save and publish rankings</button>
      <span class="pad__publish-state" id="rpState2"></span>
    </div>`;
    if ($('rpState') && S._msg) $('rpState').textContent = S._msg;
  }

  function build() {
    root.innerHTML = `<details class="res-admin"><summary class="btn btn--ghost">Rankings from finishing positions (organiser)</summary>
      <p><span class="pad__publish-state" id="rpState"></span></p><div id="rpBody"></div></details>`;
    render();
  }

  root.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.tbl !== undefined) S.config.table[Number(t.dataset.tbl)][1] = Number(t.value) || 0;
    else if (t.dataset.lvl !== undefined) S.config.levels[Number(t.dataset.lvl)].mult = Number(t.value) || 0;
    else if (t.id === 'rpDiv') S.config.divisor = Number(t.value) || 10;
    else if (t.dataset.cat !== undefined) S.events[Number(t.dataset.cat)].category = t.value;
    else if (t.dataset.r) {
      const [i, j, f] = t.dataset.r.split('.');
      const ev2 = S.events[Number(i)]; ev2.results[Number(j)][f] = f === 'pos' ? Number(t.value) : t.value; ev2.manual = true;
    }
  });

  root.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.inc !== undefined) { S.events[Number(t.dataset.inc)].include = t.checked; render(); }
    else if (t.dataset.tlevel !== undefined) S.tlevels[t.dataset.tlevel] = t.value;
    else if (t.dataset.tbl !== undefined || t.dataset.lvl !== undefined || t.id === 'rpDiv' || t.dataset.cat !== undefined) render();
  });

  root.addEventListener('click', async ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.id === 'rpLoad') loadFromDraws();
    else if (t.id === 'rpAddEv') {
      S.events.unshift({ id: 'manual-' + Date.now(), tid: 'manual', tournament: 'Added by hand', date: '', division: '', category: '', include: true, manual: true, note: '', results: [{ name: '', club: '', pos: 1 }] });
      open = new Set([0]); render();
    } else if (t.dataset.edit !== undefined) {
      const i = Number(t.dataset.edit); open.has(i) ? open.delete(i) : open.add(i); render();
    } else if (t.dataset.delev !== undefined) {
      if (!confirm('Remove this event from the ranking?')) return;
      S.events.splice(Number(t.dataset.delev), 1); open = new Set(); render();
    } else if (t.dataset.addr !== undefined) {
      const ev2 = S.events[Number(t.dataset.addr)]; ev2.results.push({ name: '', club: '', pos: (ev2.results.length || 0) + 1 }); ev2.manual = true; render();
    } else if (t.dataset.delr !== undefined) {
      const [i, j] = t.dataset.delr.split('.').map(Number); S.events[i].results.splice(j, 1); S.events[i].manual = true; render();
    } else if (t.id === 'rpSave') {
      const st = $('rpState2'); st.textContent = 'Saving…';
      try {
        const res = await fetch('/api/rankpoints', { method: 'POST', headers: headers(), body: JSON.stringify({ config: S.config, tlevels: S.tlevels, events: S.events }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
        st.textContent = 'Published. The rankings page is updated.';
        if (window.reloadRankings) window.reloadRankings();
      } catch (err) { st.textContent = 'Could not save: ' + err.message; }
    }
  });

  async function init() {
    if (!(await check())) return;
    try {
      const r = await fetch('/api/rankpoints', { cache: 'no-store' });
      const d = r.ok ? await r.json() : {};
      if (d && Array.isArray(d.events)) S = { config: { ...S.config, ...d.config }, tlevels: d.tlevels || {}, events: d.events };
    } catch { /* start fresh */ }
    build();
  }
  window.addEventListener('load', init);
})();
