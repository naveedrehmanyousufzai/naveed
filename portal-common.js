/* ============================================================
   portal-common.js — helpers shared by the portal pages
   (landing, tournaments, tournament, rankings).
   Content lives in content/tournaments.json and
   content/rankings.json and is edited from /admin.
   ============================================================ */
(function () {
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* "2026-10-21" -> a Date at local midnight (no timezone surprises) */
  function day(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function fmtDate(iso) {
    const d = day(iso);
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
  }

  /* "21–25 Oct 2026", "28 Oct – 1 Nov 2026", or one date if the same day */
  function fmtRange(a, b) {
    const s = day(a), e = day(b);
    if (!s) return '';
    if (!e || +s === +e) return fmtDate(a);
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
    }
    if (s.getFullYear() === e.getFullYear()) {
      return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${s.getFullYear()}`;
    }
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }

  /* "2026-10-12T12:00" -> "12 Oct 2026, 12:00" */
  function fmtStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const t = String(iso).includes('T')
      ? ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${t}`;
  }

  /* Scheduled, Upcoming, In play or Completed. Worked out from the dates
     unless the tournament has its own status set in the admin page. */
  const STATUSES = ['Scheduled', 'Upcoming', 'In play', 'Completed'];
  function status(t) {
    const set = String(t.status || '').trim();
    if (set && set.toLowerCase() !== 'auto') return set;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const s = day(t.start), e = day(t.end || t.start);
    if (!s) return 'Scheduled';
    if (now > e) return 'Completed';
    if (now >= s) return 'In play';
    return (s - now) / 86400000 <= 30 ? 'Upcoming' : 'Scheduled';
  }

  function statusTag(st) {
    const k = String(st).toLowerCase();
    const cls = k === 'in play' ? 'tag tag--live' : k === 'completed' ? 'tag tag--done'
      : k === 'upcoming' ? 'tag tag--up' : 'tag tag--soon';
    return `<span class="${cls}">${esc(st)}</span>`;
  }

  const cache = {};
  async function load(name) {
    if (!cache[name]) {
      cache[name] = fetch(`content/${name}.json`).then(r => {
        if (!r.ok) throw new Error(name + ' ' + r.status);
        return r.json();
      });
    }
    return cache[name];
  }

  /* The file's rankings, with any imported ones replacing the categories they cover */
  async function loadRankings() {
    const base = await load('rankings');
    let extra = [];
    try {
      const r = await fetch('/api/rankings', { cache: 'no-store' });
      if (r.ok) extra = (await r.json()).players || [];
    } catch { /* file only */ }
    if (!extra.length) return base;
    const over = new Set(extra.map(p => p.category));
    const categories = (base.categories || []).slice();
    over.forEach(c => { if (!categories.includes(c)) categories.push(c); });
    return { ...base, categories, players: (base.players || []).filter(p => !over.has(p.category)).concat(extra), imported: over };
  }

  /* The file's tournaments with the organiser's changes made on the page */
  async function tournamentData() {
    try {
      const r = await fetch('/api/tournaments', { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if (Array.isArray(d.tournaments)) return d; }
    } catch { /* fall back to the file */ }
    return load('tournaments');
  }

  async function tournaments() {
    const d = await tournamentData();
    return (d.tournaments || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  window.NR = { esc, day, fmtDate, fmtRange, fmtStamp, status, statusTag, STATUSES, load, loadRankings, tournamentData, tournaments, slug };
})();
