/* ============================================================
   rankings-admin.js — organiser tools on the Rankings page:
   import a ranking list from Word, Excel, CSV or a Google Sheet.
   Imported categories replace the same categories from the site's file.
   ============================================================ */
(function () {
  const PASS = 'nr-pass';
  const $ = id => document.getElementById(id);
  const e = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const root = $('rankings-admin');
  if (!root) return;
  const CATS = ['Boys Under 9', 'Boys Under 11', 'Boys Under 13', 'Boys Under 15', 'Boys Under 17', 'Boys Under 19',
    'Girls Under 9', 'Girls Under 11', 'Girls Under 13', 'Girls Under 15', 'Girls Under 17', 'Girls Under 19', 'Men', 'Women'];
  let rows = [];

  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS) || '' });
  async function check() {
    if (!sessionStorage.getItem(PASS)) return false;
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: headers(), body: '{}' });
      return r.ok && (await r.json()).name === 'Admin';
    } catch { return false; }
  }

  function normCategory(text) {
  const r = normCategory0(text);
  if (r) return r;
  const t = String(text || '').toLowerCase().replace(/\b(entry|entries|list|draw|category|division|event|players?|provisional|final|of|the)\b/g, ' ').replace(/[()\[\]:\u2013\u2014,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t && t !== String(text || '').toLowerCase().trim() ? normCategory0(t) : null;
}
function normCategory0(text) {
    const t = String(text || '').trim().toLowerCase().replace(/[._]/g, ' ').replace(/\bgirl[a-z]*\b/g, 'girls').replace(/\bboy[a-z]*\b/g, 'boys');
    if (!t || t.length > 40) return null;
    if (/^(open )?(men|mens|men's|male)\b/.test(t) && !/under|u\d/.test(t)) return 'Men';
    if (/^(open )?(women|womens|women's|ladies|female)\b/.test(t) && !/under|u\d/.test(t)) return 'Women';
    const m = t.match(/\b(boys?|girls?|b|g)\s*-?\s*(?:u|under|u-)?\s*-?\s*(9|11|13|15|17|19)\b/);
    if (m) return (m[1][0] === 'b' ? 'Boys' : 'Girls') + ' Under ' + m[2];
    const m2 = t.match(/\bunder\s*(9|11|13|15|17|19)\s*(boys?|girls?)\b/);
    if (m2) return (m2[2][0] === 'b' ? 'Boys' : 'Girls') + ' Under ' + m2[1];
    return null;
  }

  const script = src => new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = () => no(new Error('Could not load the file reader. Check your connection.')); document.head.appendChild(s);
  });

  function parseCsv(text) {
    return text.split(/\r?\n/).filter(l => l.trim()).map(l => {
      const out = []; let cur = '', q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if ((ch === ',' || ch === '\t' || ch === ';') && !q) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      out.push(cur.trim()); return out;
    }).map(r => ({ row: r }));
  }

  async function readDocx(file) {
    if (!window.JSZip) await script('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const textOf = el => Array.from(el.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join('').trim();
    const items = [];
    for (const node of doc.getElementsByTagNameNS(W, 'body')[0].children) {
      if (node.localName === 'p') { const t = textOf(node); if (t) items.push({ heading: t }); }
      else if (node.localName === 'tbl') for (const tr of node.getElementsByTagNameNS(W, 'tr')) items.push({ row: Array.from(tr.getElementsByTagNameNS(W, 'tc')).map(textOf) });
    }
    return items;
  }

  async function readExcel(file) {
    if (!window.XLSX) await script('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const items = [];
    for (const name of wb.SheetNames) {
      items.push({ heading: name });                       // a sheet called "Boys U13" sets the category
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })) items.push({ row: r.map(c => String(c ?? '').trim()) });
    }
    return items;
  }

  function extract(items) {
    const out = []; let cat = null, cols = null;
    const num = v => /^\d{1,4}$/.test(String(v).trim());
    const per = {};
    for (const it of items) {
      if (it.heading !== undefined) { const c = normCategory(it.heading); if (c) { cat = c; cols = cols && cols.fromHeader ? cols : null; } continue; }
      const row = it.row.map(c => String(c).trim());
      if (!row.some(Boolean)) continue;
      const low = row.map(c => c.toLowerCase());
      if (low.some(c => /\bnames?\b|^players?\b/.test(c))) {
        const f = re => low.findIndex(c => re.test(c));
        cols = { fromHeader: true, name: f(/\bnames?\b|^players?\b/), rank: f(/rank|^#$|^pos|^no\.?$/),
          club: f(/associat|club|dept|department|academy|team/), pts: f(/point|pts|score/), cat: f(/categ|division|event/) };
        continue;
      }
      if (!cols || !cols.fromHeader) cols = num(row[0]) ? { rank: 0, name: 1, club: 2, pts: 3, cat: -1 } : { rank: -1, name: 0, club: 1, pts: 2, cat: -1 };
      const name = row[cols.name];
      if (!name || /^\d+$/.test(name)) continue;
      const rc = cols.cat >= 0 ? normCategory(row[cols.cat]) : null;
      if (!rc && row.filter(Boolean).length === 1) { const c = normCategory(name); if (c) { cat = c; continue; } }
      const category = rc || cat || '';
      per[category] = (per[category] || 0) + 1;
      out.push({ category, rank: cols.rank >= 0 && num(row[cols.rank]) ? row[cols.rank] : '', name,
        club: cols.club >= 0 ? row[cols.club] || '' : '', points: cols.pts >= 0 ? row[cols.pts] || '' : '', _n: per[category] });
    }
    out.forEach(r => { if (!r.rank) r.rank = String(r._n); delete r._n; });
    return out;
  }

  function build() {
    root.innerHTML = `<div class="res-admin"><div class="res-admin__bar">
      <label class="btn btn--solid" for="rkFile" style="cursor:pointer">Import Word / Excel / CSV</label>
      <input type="file" id="rkFile" accept=".docx,.xlsx,.xls,.csv" hidden>
      <button class="btn btn--ghost" id="rkSheetBtn" type="button">Import Google Sheet</button>
      <button class="btn btn--ghost" id="rkClear" type="button">Remove imported rankings</button>
    </div>
    <form class="res-admin__box" id="rkSheetForm" hidden>
      <label class="pad__field"><span>Google Sheet link (share it as "Anyone with the link can view"; the tab you have open is read)</span><input class="pad__name" name="url" placeholder="https://docs.google.com/spreadsheets/d/…" required></label>
      <button class="btn btn--solid" type="submit">Read sheet</button> <span class="pad__publish-state" id="rkSheetState"></span>
    </form>
    <p class="pad__publish-note">Columns: <b>Rank, Name, Club, Points</b> (and Category if the file mixes categories). In Excel, name each tab after its category (e.g. "Boys Under 13"); in Word, put the category as a heading above each table. Imported categories replace the ones already on the site.</p>
    <div class="res-admin__box" id="rkPreview" hidden></div></div>`;
  }

  function preview() {
    const box = $('rkPreview'); box.hidden = !rows.length;
    if (!rows.length) return;
    const missing = rows.filter(r => r.on !== false && !r.category).length;
    const cats = [...new Set(rows.filter(r => r.on !== false && r.category).map(r => r.category))];
    box.innerHTML = `<p class="pad__intro">${rows.length} players found in ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}: ${e(cats.join(', ') || 'none yet')}. Check, then import.</p>
      <table class="table plain-table"><thead><tr><th>Add</th><th>Rank</th><th>Name</th><th>Club</th><th>Points</th><th>Category</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" data-f="on" ${r.on !== false ? 'checked' : ''}></td><td>${e(r.rank)}</td><td>${e(r.name)}</td><td>${e(r.club)}</td><td>${e(r.points)}</td>
      <td><select class="pad__name" data-i="${i}" data-f="category"><option value="">— choose —</option>${CATS.map(c => `<option${c === r.category ? ' selected' : ''}>${e(c)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table>
      <button class="btn btn--solid" id="rkImport" ${missing ? 'disabled' : ''}>Import ${rows.filter(r => r.on !== false).length} players</button>
      <span class="pad__publish-state" id="rkState">${missing ? missing + ' still need a category.' : ''}</span>`;
  }

  async function save(players, manualCats) {
    const body = { players };
    if (manualCats) body.manualCats = manualCats;
    const r = await fetch('/api/rankings', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Sign in as organiser first.' : 'Could not save.');
  }
  async function existingCats() {
    try { const r = await fetch('/api/rankings', { cache: 'no-store' }); return r.ok ? (await r.json()).manualCats || [] : []; } catch { return []; }
  }
  async function existing() {
    try { const r = await fetch('/api/rankings', { cache: 'no-store' }); return r.ok ? (await r.json()).players || [] : []; } catch { return []; }
  }
  function show(items, label) {
    rows = extract(items);
    const box = $('rkPreview'); box.hidden = false;
    if (!rows.length) { box.innerHTML = '<p class="pad__empty">No players found in ' + e(label) + '. Check the column headings (Rank, Name, Club, Points).</p>'; return; }
    preview();
  }

  document.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.id === 'rkFile') {
      const f = t.files[0]; if (!f) return;
      const box = $('rkPreview'); box.hidden = false; box.innerHTML = '<p class="pad__empty">Reading…</p>';
      try {
        const items = /\.docx$/i.test(f.name) ? await readDocx(f) : /\.csv$/i.test(f.name) ? parseCsv(await f.text()) : await readExcel(f);
        show(items, f.name);
      } catch (err) { box.innerHTML = '<p class="pad__empty">Could not read the file: ' + e(err.message) + '</p>'; }
      t.value = '';
    } else if (t.dataset && t.dataset.i !== undefined && t.closest('#rkPreview')) {
      const r = rows[Number(t.dataset.i)];
      if (t.dataset.f === 'on') r.on = t.checked; else r.category = t.value;
      preview();
    }
  });

  document.addEventListener('click', async ev => {
    const id = ev.target.id;
    if (id === 'rkSheetBtn') $('rkSheetForm').hidden = !$('rkSheetForm').hidden;
    if (id === 'rkImport') {
      const st = $('rkState'); st.textContent = 'Saving…';
      const mine = rows.filter(r => r.on !== false && r.category).map(({ category, rank, name, club, points }) => ({ category, rank, name, club, points }));
      const cats = new Set(mine.map(p => p.category));
      try {
        const keep = (await existing()).filter(p => !cats.has(p.category));   // earlier imports for other categories stay
        await save(keep.concat(mine), [...new Set((await existingCats()).concat([...cats]))]); rows = []; $('rkPreview').hidden = true;
        await window.reloadRankings();
      } catch (err) { st.textContent = err.message; }
    }
    if (id === 'rkClear') {
      if (!confirm('Remove all imported rankings and go back to the ones saved in the site files?')) return;
      try { await save([], []); await window.reloadRankings(); } catch (err) { alert(err.message); }
    }
  });

  document.addEventListener('submit', async ev => {
    if (!ev.target.matches('#rkSheetForm')) return;
    ev.preventDefault();
    const st = $('rkSheetState'); st.textContent = 'Reading…';
    try {
      const r = await fetch('/api/sheet', { method: 'POST', headers: headers(), body: JSON.stringify({ url: new FormData(ev.target).get('url') }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not read the sheet.');
      st.textContent = ''; ev.target.hidden = true; show(parseCsv(j.csv), 'the sheet');
    } catch (err) { st.textContent = err.message; }
  });

  /* ---------- Edit on the page ----------
     Any change to a category saves that whole category as imported, so it replaces the file's copy. */
  let on = false;
  const field = (f, v, w) => `<input class="pad__name" data-f="${f}" value="${e(v)}" style="width:${w}">`;
  function editRow(r, i) {
    return `<td>${field('rank', r.rank, '56px')}</td><td>${field('name', r.name, '100%')}</td><td>${field('club', r.club, '100%')}</td><td>${field('points', r.points, '70px')}</td>
      <td style="white-space:nowrap"><button class="btn btn--solid" data-rksave="${i}">Save</button> <button class="btn btn--ghost" data-rkcancel="1">Cancel</button></td>`;
  }
  window.rankingsAfterRender = function (cat, rows) {
    if (!on) return;
    const root = $('rankings-root');
    let table = root.querySelector('table');
    if (!table) {
      root.innerHTML = '<h2 class="rk-title">' + e(cat) + '</h2><p class="pad__empty">No ranking for this category yet.</p>'
        + '<table class="table rk-table"><thead><tr><th>Rank</th><th>Player</th><th>Club</th><th>Points</th><th></th></tr></thead><tbody></tbody></table>';
      table = root.querySelector('table');
    } else {
      table.querySelector('thead tr').insertAdjacentHTML('beforeend', '<th></th>');
      table.querySelectorAll('tbody tr').forEach((tr, i) => tr.insertAdjacentHTML('beforeend',
        `<td style="white-space:nowrap"><button class="ent-edit" data-rkedit="${i}" aria-label="Edit">\u270e</button><button class="ent-del" data-rkdel="${i}" aria-label="Remove">\u00d7</button></td>`));
    }
    root.insertAdjacentHTML('beforeend', '<p><button class="btn btn--ghost" id="rkAddRow">Add player</button> <button class="btn btn--ghost" id="rkReset" hidden>Reset to the ranking worked out from results</button> <span class="pad__publish-state" id="rkEditState"></span></p>');
    existingCats().then(c => { const b = $('rkReset'); if (b && c.includes(cat)) b.hidden = false; });
  };
  async function saveCategory(cat, list) {
    const clean = list.map(p => ({ category: cat, rank: String(p.rank || '').trim(), name: String(p.name || '').trim(), club: String(p.club || '').trim(), points: String(p.points || '').trim() }))
      .filter(p => p.name)
      .sort((x, y) => (Number(x.rank) || 9999) - (Number(y.rank) || 9999));
    const keep = (await existing()).filter(p => p.category !== cat);
    await save(keep.concat(clean), [...new Set((await existingCats()).concat([cat]))]);
    await window.reloadRankings();
  }
  const curCat = () => ((document.querySelector('#catFilters .chip--on') || {}).dataset || {}).c || '';
  const read = tr => Object.fromEntries([...tr.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value]));
  const fail = err => { const s = $('rkEditState'); if (s) s.textContent = err.message; else alert(err.message); };

  document.addEventListener('click', async ev => {
    if (!on) return;
    const t = ev.target.closest('button'); if (!t) return;
    const rows = (window.rankingsRows || []).map(p => ({ ...p }));
    const cat = curCat();
    if (t.dataset.rkedit !== undefined) {
      const tr = t.closest('tr'); tr.innerHTML = editRow(rows[Number(t.dataset.rkedit)], t.dataset.rkedit);
    } else if (t.dataset.rkcancel) {
      window.reloadRankings();
    } else if (t.id === 'rkReset') {
      if (!confirm('Throw away the manual changes to ' + cat + ' and use the ranking worked out from results?')) return;
      try {
        const keep = (await existing()).filter(p => p.category !== cat);
        await save(keep, (await existingCats()).filter(c => c !== cat));
        await window.reloadRankings();
      } catch (err) { fail(err); }
    } else if (t.id === 'rkAddRow') {
      const tb = document.querySelector('#rankings-root tbody');
      tb.insertAdjacentHTML('beforeend', '<tr>' + editRow({ rank: String(rows.length + 1), name: '', club: '', points: '' }, 'new') + '</tr>');
      t.hidden = true; tb.lastElementChild.querySelector('[data-f=name]').focus();
    } else if (t.dataset.rksave !== undefined) {
      const v = read(t.closest('tr'));
      if (!String(v.name).trim()) return fail(new Error('Enter a name.'));
      if (t.dataset.rksave === 'new') rows.push(v); else rows[Number(t.dataset.rksave)] = v;
      try { await saveCategory(cat, rows); } catch (err) { fail(err); }
    } else if (t.dataset.rkdel !== undefined) {
      const i = Number(t.dataset.rkdel);
      if (!confirm('Remove ' + (rows[i] && rows[i].name) + ' from ' + cat + '?')) return;
      rows.splice(i, 1);
      try { await saveCategory(cat, rows); } catch (err) { fail(err); }
    }
  });

  async function init() {
    if (await check()) { on = true; build(); if (window.reloadRankings) window.reloadRankings(); return; }
    if (location.search.includes('admin')) {
      root.innerHTML = `<form class="res-admin__box" id="rkLogin"><div class="res-admin__grid"><label class="pad__field"><span>Admin password</span><input class="pad__name" type="password" name="pw" required></label></div><button class="btn btn--solid" type="submit">Sign in</button> <span class="pad__publish-state" id="rkLoginState"></span></form>`;
      $('rkLogin').addEventListener('submit', async ev => {
        ev.preventDefault();
        sessionStorage.setItem(PASS, new FormData(ev.target).get('pw'));
        if (await check()) init(); else { sessionStorage.removeItem(PASS); $('rkLoginState').textContent = 'Wrong password.'; }
      });
    }
  }
  window.addEventListener('load', init);
})();
