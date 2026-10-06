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

  /* ---------- Ranking from finishing positions ----------
     data = {config:{table:[[pos,points]...], levels:[{name,mult}], divisor}, tlevels:{tournamentId:level}, events:[...]}
     A player's points for an event = table points for the position reached x the tournament level.
     Ranking score = all points added up / divisor (default 10). */
  const DEFAULT_RANK_CONFIG = {
    table: [[1, 100], [2, 70], [3, 50], [5, 30], [9, 15], [17, 8], [33, 4]],
    levels: [{ name: 'Bronze', mult: 1 }, { name: 'Silver', mult: 1.5 }, { name: 'Gold', mult: 2 }, { name: 'Diamond', mult: 3 }],
    divisor: 10
  };
  function computeRanking(d) {
    const cfg = { ...DEFAULT_RANK_CONFIG, ...((d && d.config) || {}) };
    const table = (cfg.table || []).map(r => [Number(r[0]), Number(r[1])]).filter(r => r[0] > 0);
    const divisor = Number(cfg.divisor) > 0 ? Number(cfg.divisor) : 10;
    const pts = pos => { let k = -1, v = 0; table.forEach(([p, x]) => { if (pos >= p && p > k) { k = p; v = x; } }); return v; };
    const mult = lvl => { const l = (cfg.levels || []).find(x => x.name === lvl); return l ? Number(l.mult) || 0 : 1; };
    const cats = new Map();
    ((d && d.events) || []).filter(ev => ev.include !== false && ev.category).forEach(ev => {
      const m = mult((d.tlevels || {})[ev.tid] || ev.level);
      const c = cats.get(ev.category) || new Map();
      cats.set(ev.category, c);
      (ev.results || []).forEach(r => {
        const name = String(r.name || '').trim();
        const pos = Number(r.pos);
        if (!name || !(pos > 0)) return;
        const key = name.toLowerCase();
        const p = c.get(key) || { name, club: '', total: 0, played: 0 };
        p.total += pts(pos) * m; p.played += 1; if (r.club) p.club = r.club;
        c.set(key, p);
      });
    });
    const out = [];
    cats.forEach((c, category) => {
      const list = [...c.values()].map(p => ({ ...p, score: Math.round(p.total / divisor * 100) / 100 }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      list.forEach((p, i) => {
        const rank = i > 0 && p.score === list[i - 1].score ? out[out.length - 1].rank : String(i + 1);
        out.push({ category, rank, name: p.name, club: p.club, points: String(p.score), played: p.played, total: p.total });
      });
    });
    return out;
  }

  /* The file's rankings, with any imported ones replacing the categories they cover */
  async function loadRankings() {
    const base = await load('rankings');
    let extra = [];
    let manual = new Set();
    try {
      const r = await fetch('/api/rankings', { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); extra = d.players || []; manual = new Set(d.manualCats || []); }
    } catch { /* file only */ }
    /* categories worked out from finishing positions replace the others */
    try {
      const r = await fetch('/api/rankpoints', { cache: 'no-store' });
      if (r.ok) {
        const computed = computeRanking(await r.json()).filter(p => !manual.has(p.category));
        if (computed.length) {
          const cc = new Set(computed.map(p => p.category));
          extra = extra.filter(p => !cc.has(p.category)).concat(computed);
        }
      }
    } catch { /* optional */ }
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

  window.NR = { esc, day, fmtDate, fmtRange, fmtStamp, status, statusTag, STATUSES, load, loadRankings, computeRanking, DEFAULT_RANK_CONFIG, tournamentData, tournaments, slug };
})();
