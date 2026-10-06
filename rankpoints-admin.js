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
      S.events.forEach(ev => { if (ev.tid && !S.tlevels[ev.tid]) S.tlevels[ev.tid] = (S.config.levels[0] || {}).name || ''; });
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
      <h3>3 · Add results from a spreadsheet</h3>
      <p class="pad__intro">One sheet (tab) per category. Columns: Name, Association, then one column per tournament. Either use one sheet per category, or add a <b>Category</b> column (any position) to put all categories on one sheet. Put the tournament name, its date in brackets and its level in the column heading, e.g. “1st ABC National Junior Squash Championship 2025 (October 7 2025) Silver Event”. Each cell is how far the player got: <b>Winner, Runner Up, Semi Final, Quarter Final, Round of 16, Round of 32, Round of 64</b>.</p>
      <label class="btn btn--solid" for="rpFile" style="cursor:pointer">Choose Excel / CSV file</label>
      <input type="file" id="rpFile" accept=".xlsx,.xls,.csv" hidden>
      <button class="btn btn--ghost" id="rpTemplate" type="button">Download a template</button>
      <div id="rpImport"></div>
    </div>
    <div class="res-admin__box">
      <h3>4 · Events</h3>
      <p><button class="btn btn--solid" id="rpLoad" type="button">Load results from draws</button>
      <button class="btn btn--ghost" id="rpAddEv" type="button">Add an event by hand</button></p>
      ${!S.events.length ? '<p class="pad__empty">No events yet. Press “Load results from draws”.</p>' : tids.map(tid => `
        <h4 class="rp-t">${e(tname(tid))}
          <select class="pad__name" data-tlevel="${e(tid)}">${lv.map(l => `<option${(S.tlevels[tid] || '') === l.name ? ' selected' : ''}>${e(l.name)}</option>`).join('')}</select>
          <input class="pad__name" type="number" min="0" step="1000" data-prize="${e(tid)}" placeholder="or prize money per category (Rs)" value="${e((S.prize || {})[tid] || '')}" style="width:260px"></h4>
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
      <h3>5 · Preview and publish</h3>
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

  /* Prize money per category sets the level: up to 100,000 Bronze, up to 200,000 Silver,
     up to 300,000 Gold, above that Diamond. */
  const levelFromPrize = n => n <= 100000 ? 'Bronze' : n <= 200000 ? 'Silver' : n <= 300000 ? 'Gold' : 'Diamond';
  function ensureLevel(name) {
    if (name && !S.config.levels.some(l => l.name === name)) S.config.levels.push({ name, mult: 1 });
  }

  /* ---------- Spreadsheet import ---------- */
  const script = src => new Promise((ok, no) => {
    if (window.XLSX) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = () => no(new Error('Could not load the spreadsheet reader. Check your connection.')); document.head.appendChild(s);
  });
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const CATS = ['Boys Under 9', 'Boys Under 11', 'Boys Under 13', 'Boys Under 15', 'Boys Under 17', 'Boys Under 19',
    'Girls Under 9', 'Girls Under 11', 'Girls Under 13', 'Girls Under 15', 'Girls Under 17', 'Girls Under 19', 'Men', 'Women'];
  let IMP = null;

  /* What a cell says -> the position it means. Round N depends on the size of the draw:
     the deepest "Round N" in the column comes just before the quarter-finals. */
  function posFromText(text, maxRound) {
    let t = String(text || '').trim().toLowerCase().replace(/[._\-\u2013\u2014]/g, ' ').replace(/\s+/g, ' ');
    if (!t) return 0;
    t = t.replace(/\b(lost|lost in|out in|reached|exit|exited|eliminated|in the|the)\b/g, ' ').replace(/\bfinalists?\b/g, 'final').replace(/\s+/g, ' ').trim();
    if (/^\d+$/.test(t)) return Number(t);
    if (/^(winner|winners|champion|won|1st|first|gold|1st place)$/.test(t)) return 1;
    if (/^(runner ?ups?|final|2nd|second|silver|2nd place)$/.test(t)) return 2;
    if (/^(semi ?finals?|semis?|sf|3rd|third|4th|fourth|bronze|last 4|top 4|3rd place)$/.test(t)) return 3;
    if (/^(quarter ?finals?|quarters?|qf|last 8|top 8|1 4 final|1 4)$/.test(t)) return 5;
    if (/^((round of|round|last|top|r|1 8 final|1 8) ?16)$/.test(t) || /^1 8( final)?$/.test(t)) return 9;
    if (/^((round of|round|last|top|r) ?32)$/.test(t) || /^1 16( final)?$/.test(t)) return 17;
    if (/^((round of|round|last|top|r) ?64)$/.test(t) || /^1 32( final)?$/.test(t)) return 33;
    const m = t.match(/^(?:round|rd|r)\s*(\d+)$/);
    if (m && maxRound) return Math.pow(2, (maxRound + 3) - Number(m[1])) + 1;
    return 0;
  }

  function parseHeader(h) {
    const lines = String(h || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const flat = lines.join(' ').replace(/\s+/g, ' ');
    const lv = (flat.match(/\b(bronze|silver|gold|diamond)\b/i) || [])[1];
    const level = lv ? lv[0].toUpperCase() + lv.slice(1).toLowerCase() : '';
    let date = '';
    const dm = flat.match(/\(([^)]*\d{4}[^)]*)\)/);
    if (dm) { const d = new Date(dm[1]); if (!isNaN(d)) date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    const name = flat.replace(/\([^)]*\d{4}[^)]*\)/g, ' ').replace(/\b(bronze|silver|gold|diamond)\s*(event|level)?\b/ig, ' ').replace(/\s+/g, ' ').trim();
    return { name, level, date };
  }

  /* One sheet -> one or more groups (a group = one category). The category comes from a
     "Category" column if there is one, otherwise from the sheet's name. */
  function parseSheet(name, rows) {
    /* the heading row is the first one with a "Name" cell (there may be title rows above it) */
    let hr = rows.findIndex((r, i) => i < 15 && r.some(c => /^(names?|players?|athletes?)$/i.test(String(c ?? '').trim())));
    if (hr < 0) hr = 0;
    rows = rows.slice(hr);
    const head = (rows[0] || []).map(h => String(h ?? ''));
    const find = re => head.findIndex(h => re.test(h.trim()));
    let ci = find(/^(category|categories|division|event|class)$/i);
    let ni = find(/^(names?|players?|athletes?)$/i); if (ni < 0) ni = 0;
    let ai = find(/^(association|associations|club|clubs|team|province|dept|department)$/i); if (ai < 0) ai = ni === 0 ? 1 : 0;
    const tcols = [];
    head.forEach((h, j) => { if (j !== ci && j !== ni && j !== ai && h.trim()) tcols.push(j); });
    const body = rows.slice(1).filter(r => String(r[ni] ?? '').trim());
    const byCat = new Map();
    let lastCat = '';
    body.forEach(r => {
      let raw = ci >= 0 ? String(r[ci] ?? '').trim() : '';
      if (ci >= 0) { if (raw) lastCat = raw; else raw = lastCat; }   // merged / blank cells carry the category down
      const cat = ci >= 0 ? (normCat(raw) || raw) : normCat(name);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(r);
    });
    const groups = [];
    byCat.forEach((list, cat) => {
      const cols = tcols.map(j => {
        const h = parseHeader(head[j]);
        /* "Round N" depends on the size of this category's draw, so it is read per category */
        const maxRound = Math.max(0, ...list.map(r => { const m = String(r[j] ?? '').trim().toLowerCase().match(/^(?:round|rd|r)\s*(\d+)$/); return m ? Number(m[1]) : 0; }));
        const results = [], unknown = new Set();
        list.forEach(r => {
          const cell = String(r[j] ?? '').trim();
          if (!cell) return;
          const pos = posFromText(cell, maxRound);
          if (pos) results.push({ name: String(r[ni]).trim(), club: String(r[ai] ?? '').trim(), pos });
          else unknown.add(cell);
        });
        results.sort((x, y) => x.pos - y.pos || x.name.localeCompare(y.name));
        return { ...h, results, unknown: [...unknown] };
      }).filter(c => c.results.length || c.unknown.length);
      if (cols.length) groups.push({ sheet: name, category: cat, cols, rows: list.length });
    });
    return groups;
  }

  async function readFile(file) {
    const box = $('rpImport');
    box.innerHTML = '<p class="pad__empty">Reading…</p>';
    try {
      await script(XLSX_URL);
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      IMP = { sheets: wb.SheetNames.flatMap(n => parseSheet(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', blankrows: false }))) };
      if (!IMP.sheets.length) { box.innerHTML = '<p class="pad__empty">No tournament columns found. Column A should be Name, column B Association, and the tournaments from column C.</p>'; return; }
      renderImport();
    } catch (err) { box.innerHTML = '<p class="pad__empty">Could not read the file: ' + e(err.message) + '</p>'; }
  }

  function renderImport() {
    const box = $('rpImport');
    const lv = S.config.levels.map(l => l.name);
    const lvAll = [...new Set(lv.concat(['Bronze', 'Silver', 'Gold', 'Diamond']))];
    box.innerHTML = IMP.sheets.map((s, si) => `
      <div class="rp-imp">
        <h4>${e(s.sheet)} · ${s.rows} players → category
          <select class="pad__name" data-impcat="${si}"><option value="">— choose —</option>${[...new Set(CATS.concat(s.category ? [s.category] : []))].map(c => `<option${c === s.category ? ' selected' : ''}>${e(c)}</option>`).join('')}</select></h4>
        ${s.cols.map((c, ci) => `<div class="rp-imp__col">
          <strong>${e(c.name)}</strong>
          <span class="rp-ev__meta">${e(c.date || 'no date')} · ${c.results.length} players${c.unknown.length ? ' · <em>not understood: ' + e(c.unknown.join(', ')) + '</em>' : ''}</span>
          <select class="pad__name" data-implvl="${si}.${ci}"><option value="">Level?</option>${lvAll.map(l => `<option${c.level === l ? ' selected' : ''}>${e(l)}</option>`).join('')}</select>
        </div>`).join('')}
      </div>`).join('') + `<p><button class="btn btn--solid" id="rpImpApply" type="button" ${IMP.sheets.some(s => !s.category) || IMP.sheets.some(s => s.cols.some(c => !c.level)) ? 'disabled' : ''}>Add these results</button>
      <span class="pad__publish-state">${IMP.sheets.some(s => !s.category) ? 'Choose a category for each sheet. ' : ''}${IMP.sheets.some(s => s.cols.some(c => !c.level)) ? 'Choose a level for each tournament.' : ''}</span></p>`;
  }

  function applyImport() {
    let n = 0;
    IMP.sheets.forEach(s => s.cols.forEach(c => {
      ensureLevel(c.level);
      const tid = 'imp-' + slug(c.name);
      S.tlevels[tid] = c.level;
      const id = tid + '-' + slug(s.category);
      if (!c.results.length) return;
      const ev = { id, tid, tournament: c.name, date: c.date, division: s.category, category: s.category, include: true, manual: true, note: 'From spreadsheet', results: c.results };
      const i = S.events.findIndex(x => x.id === id);
      if (i >= 0) S.events[i] = ev; else S.events.push(ev);
      n++;
    }));
    S.events.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.division.localeCompare(b.division));
    S._msg = '';
    IMP = null; render();
    $('rpState').textContent = n + ' event(s) added. Check them below, then Save and publish.';
  }

  function downloadTemplate() {
    script(XLSX_URL).then(() => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Name', 'Association', 'Sindh Junior Championship 2026 (March 5 2026) Bronze Event', 'National Junior Championship 2026 (May 10 2026) Silver Event'],
        ['Player One', 'Sindh', 'Winner', 'Semi Final'],
        ['Player Two', 'Punjab', 'Runner Up', 'Winner'],
        ['Player Three', 'KPK', 'Semi Final', 'Quarter Final'],
        ['Player Four', 'Navy', 'Round of 16', 'Round of 32'],
        ['Player Five', 'Sindh', 'Round of 32', 'Round of 64']
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Girls Under 13');
      XLSX.writeFile(wb, 'ranking-results-template.xlsx');
    });
  }

  root.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'rpFile') { if (t.files[0]) readFile(t.files[0]); t.value = ''; return; }
    if (t.dataset.impcat !== undefined) { IMP.sheets[Number(t.dataset.impcat)].category = t.value; renderImport(); return; }
    if (t.dataset.implvl !== undefined) {
      const [si, ci] = t.dataset.implvl.split('.').map(Number);
      const nm = IMP.sheets[si].cols[ci].name;
      IMP.sheets.forEach(g => g.cols.forEach(c => { if (c.name === nm) c.level = t.value; }));   // same tournament, same level
      renderImport(); return;
    }
    if (t.dataset.prize !== undefined) {
      S.prize = S.prize || {}; S.prize[t.dataset.prize] = Number(t.value) || '';
      if (Number(t.value) > 0) { S.tlevels[t.dataset.prize] = levelFromPrize(Number(t.value)); ensureLevel(S.tlevels[t.dataset.prize]); }
      render(); return;
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
    else if (t.id === 'rpImpApply') applyImport();
    else if (t.id === 'rpTemplate') downloadTemplate();
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
        const res = await fetch('/api/rankpoints', { method: 'POST', headers: headers(), body: JSON.stringify({ config: S.config, tlevels: S.tlevels, prize: S.prize || {}, events: S.events }) });
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
      if (d && Array.isArray(d.events)) S = { config: { ...S.config, ...d.config }, tlevels: d.tlevels || {}, prize: d.prize || {}, events: d.events };
    } catch { /* start fresh */ }
    build();
  }
  window.addEventListener('load', init);
})();
