/* ============================================================
   results-admin.js — organiser tools on the Results page:
   add a tournament, or import a whole Excel sheet.
   Added results are kept on the server and shown with the file's.
   ============================================================ */
(function () {
  const PASS = 'nr-pass';
  const $ = id => document.getElementById(id);
  const e = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const root = $('results-admin');
  if (!root) return;

  const A = window.ResultsAdmin = { on: false, afterRender() {} };
  let preview = [];

  async function check() {
    const pw = sessionStorage.getItem(PASS);
    if (!pw) return false;
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': pw }, body: '{}' });
      return r.ok && (await r.json()).name === 'Admin';
    } catch { return false; }
  }

  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS) || '' });
  const isWin = r => /^(winner|champion)/i.test(r) ;

  async function saveAll(items) {
    const r = await fetch('/api/results', { method: 'POST', headers: headers(), body: JSON.stringify({ items }) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Sign in as organiser first.' : 'Could not save.');
    return (await r.json()).items;
  }
  const current = () => (window.resultsAdded || []).slice();

  /* ---------- Reading an Excel sheet ----------
     Row with a number in the first column = a tournament.
     The row under it, with only a place in the name column, = its venue. */
  function yearOf(dates) {
    const s = String(dates || '');
    let m = s.match(/(19|20)\d{2}/); if (m) return m[0];
    m = s.match(/[A-Za-z]{3,9}[-\s']+(\d{2})\b/); if (m) return '20' + m[1];
    m = s.match(/\b(\d{2})\b\s*$/); if (m) return '20' + m[1];
    return '';
  }

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* Excel sometimes hands over a real date: 2013-05-01 -> May 2013 */
  function tidyDates(d) {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? MON[Number(m[2]) - 1] + ' ' + m[1] : d;
  }

  function parseRows(rows) {
    let col = { n: 0, name: 1, dates: 2, cat: 3, res: 4 };
    const out = [];
    for (const raw of rows) {
      const row = raw.map(c => String(c ?? '').trim());
      if (!row.some(Boolean)) continue;
      const low = row.map(c => c.toLowerCase());
      if (low.some(c => /name of tournament|^tournament$/.test(c))) {
        const f = re => low.findIndex(c => re.test(c));
        col = { n: Math.max(0, f(/^#$|^no\.?$|^s\.?no/)), name: f(/tournament|name/), dates: f(/date/), cat: f(/categ/), res: f(/result/) };
        if (col.name < 0) col.name = 1;
        continue;
      }
      const isNew = /^\d+$/.test(row[col.n] || '');
      const rest = row.filter((c, i) => i !== col.name && i !== col.n && c).length;
      if (isNew) {
        let name = row[col.name] || '', venue = '';
        if (name.includes('\n')) { const p = name.split('\n'); name = p[0].trim(); venue = p.slice(1).join(', ').trim(); }
        const dates = tidyDates(col.dates >= 0 ? row[col.dates] : '');
        out.push({ tournament: name, venue, dates, category: col.cat >= 0 ? row[col.cat] : '', result: col.res >= 0 ? row[col.res] : '', year: yearOf(dates) });
      } else if (out.length && !out[out.length - 1].venue && row[col.name] && rest === 0) {
        out[out.length - 1].venue = row[col.name];
      }
    }
    return out.filter(r => r.tournament).map(r => ({ ...r, win: isWin(r.result) }));
  }

  async function readFile(file) {
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      return parseRows(text.split(/\r?\n/).map(l => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; }));
    }
    if (!window.XLSX) {
      await new Promise((ok, no) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = ok; s.onerror = () => no(new Error('Could not load the Excel reader. Check your connection.'));
        document.head.appendChild(s);
      });
    }
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return parseRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
  }

  /* ---------- Screen ---------- */
  function renderPreview() {
    const box = $('raPreview');
    if (!preview.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<p class="pad__intro">${preview.length} tournaments found. Untick any you do not want.</p>
      <table class="table plain-table"><thead><tr><th>Add</th><th>Year</th><th>Tournament</th><th>Venue</th><th>Result</th></tr></thead><tbody>
      ${preview.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.on === false ? '' : 'checked'}></td>
        <td>${e(r.year || '?')}</td><td>${e(r.tournament)}<small class="res__sub">${e([r.dates, r.category].filter(Boolean).join(' · '))}</small></td><td>${e(r.venue)}</td><td>${e(r.result)}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn btn--solid" id="raImport">Import ${preview.filter(r => r.on !== false).length} tournaments</button>
      <span class="pad__publish-state" id="raState"></span>`;
  }

  function build() {
    root.innerHTML = `<div class="res-admin">
      <div class="res-admin__bar">
        <button class="btn btn--solid" id="raAdd">Add tournament</button>
        <label class="btn btn--ghost" for="raFile" style="cursor:pointer">Import from Excel</label>
        <input type="file" id="raFile" accept=".xlsx,.xls,.csv" hidden>
      </div>
      <form class="res-admin__box" id="raForm" hidden>
        <div class="res-admin__grid">
          <label class="pad__field"><span>Tournament</span><input class="pad__name" name="tournament" required></label>
          <label class="pad__field"><span>Dates (e.g. 15-20 Oct 2026)</span><input class="pad__name" name="dates"></label>
          <label class="pad__field"><span>Year</span><input class="pad__name" name="year" inputmode="numeric" maxlength="4" required></label>
          <label class="pad__field"><span>Category</span><input class="pad__name" name="category" placeholder="International, Provincial…"></label>
          <label class="pad__field"><span>Venue</span><input class="pad__name" name="venue" placeholder="Karachi, Pakistan"></label>
          <label class="pad__field"><span>Result</span><input class="pad__name" name="result" placeholder="Winner, Runner up…" required></label>
        </div>
        <button class="btn btn--solid" type="submit">Save tournament</button>
        <span class="pad__publish-state" id="raFormState"></span>
      </form>
      <p class="pad__publish-note">Excel columns: <b>#, Name of Tournament, Dates, Category, Result</b>, with the place on the row under each name.</p>
      <div class="res-admin__box" id="raPreview" hidden></div>
    </div>`;
  }

  async function refresh() { await window.renderResults(); }

  root.addEventListener('click', async ev => {
    if (ev.target.id === 'raAdd') $('raForm').hidden = !$('raForm').hidden;
    if (ev.target.id === 'raImport') {
      const st = $('raState');
      const have = current();
      const add = preview.filter(r => r.on !== false).filter(r => !have.some(h => h.tournament.toLowerCase() === r.tournament.toLowerCase() && h.year === r.year));
      st.textContent = 'Saving…';
      try {
        await saveAll(have.concat(add.map(r => ({ year: r.year || String(new Date().getFullYear()), tournament: r.tournament, dates: r.dates, category: r.category, venue: r.venue, result: r.result, win: r.win }))));
        preview = []; $('raPreview').hidden = true; await refresh();
      } catch (err) { st.textContent = err.message; }
    }
  });
  root.addEventListener('change', async ev => {
    if (ev.target.id === 'raFile') {
      const f = ev.target.files[0]; if (!f) return;
      const box = $('raPreview'); box.hidden = false; box.innerHTML = '<p class="pad__empty">Reading…</p>';
      try {
        preview = await readFile(f);
        if (!preview.length) box.innerHTML = '<p class="pad__empty">No tournaments found. Check the column headings.</p>'; else renderPreview();
      } catch (err) { box.innerHTML = '<p class="pad__empty">Could not read the file: ' + e(err.message) + '</p>'; }
      ev.target.value = '';
    } else if (ev.target.dataset && ev.target.dataset.i !== undefined && ev.target.closest('#raPreview')) {
      preview[Number(ev.target.dataset.i)].on = ev.target.checked; renderPreview();
    }
  });
  root.addEventListener('submit', async ev => {
    if (ev.target.id !== 'raForm') return;
    ev.preventDefault();
    const f = new FormData(ev.target), st = $('raFormState');
    const r = Object.fromEntries(f.entries()); r.win = isWin(r.result || '');
    st.textContent = 'Saving…';
    try { await saveAll(current().concat([r])); ev.target.reset(); ev.target.hidden = true; st.textContent = ''; await refresh(); }
    catch (err) { st.textContent = err.message; }
  });

  document.addEventListener('click', async ev => {
    const d = ev.target.closest('[data-rdel]');
    if (!d || !confirm('Remove this tournament?')) return;
    try { await saveAll(current().filter(r => r.id !== d.dataset.rdel)); await refresh(); } catch (err) { alert(err.message); }
  });

  /* Organiser sign-in, only shown to people who ask for it (?admin or after a draw-maker sign-in) */
  async function init() {
    A.on = await check();
    if (A.on) { build(); await window.renderResults(); return; }
    if (location.search.includes('admin')) {
      root.innerHTML = `<form class="res-admin__box" id="raLogin"><div class="res-admin__grid"><label class="pad__field"><span>Admin password</span><input class="pad__name" type="password" name="pw" required></label></div><button class="btn btn--solid" type="submit">Sign in</button> <span class="pad__publish-state" id="raLoginState"></span></form>`;
      $('raLogin').addEventListener('submit', async ev => {
        ev.preventDefault();
        sessionStorage.setItem(PASS, new FormData(ev.target).get('pw'));
        if (await check()) { init(); } else { sessionStorage.removeItem(PASS); $('raLoginState').textContent = 'Wrong password.'; }
      });
    }
  }
  window.addEventListener('load', init);
})();
