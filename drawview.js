/* ============================================================
   drawview.js — draws a draw

   Shared by drawmaker.html (while building one) and draw.html
   (the public view), so both always look the same.
   ============================================================ */

(function () {
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  /* Court and time of a match, from the schedule (if any) */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function whenHTML(sched, id) {
    const m = sched && (sched.matches || []).find(x => x.id === id);
    if (!m || m.status === 'bye') return '';
    const bits = [];
    if (m.court) bits.push('Court ' + esc(m.court));
    if (m.time) {
      const d = new Date(m.time);
      if (!isNaN(d)) {
        const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
        bits.push(`${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh % 12 || 12}:${mm} ${hh < 12 ? 'am' : 'pm'}`);
      }
    }
    return bits.length ? `<p class="match__when">${bits.join(' · ')}</p>` : '';
  }

  /* ---------- Knockout ---------- */
  function knockoutHTML(draw, sched) {
    const slots = draw.slots || [];
    const pairs = [];
    for (let i = 0; i < slots.length; i += 2) pairs.push([slots[i], slots[i + 1]]);

    const line = s => {
      const at = s && s.position ? ` data-slot="${s.position - 1}"` : '';
      if (s && s.open) return `<div class="slot slot--empty"${at}>${s.spot ? `<span class="slot__seed">[${esc(s.spot)}]</span> ` : ''}To be decided</div>`;
      if (!s || !s.player) return `<div class="slot slot--empty"${at}>Bye</div>`;
      return `<div class="slot"${at}>
        <span class="slot__name">${esc(s.player.name)}</span>
        ${s.player.club ? `<span class="slot__club">${esc(s.player.club)}</span>` : ''}
        ${s.seed ? `<span class="slot__seed">[${esc(s.seed)}]</span>` : ''}
      </div>`;
    };

    const first = (draw.rounds && draw.rounds[0] && draw.rounds[0].name) || 'Round 1';

    const firstRound = `
      <div class="bracket__col">
        <h3 class="bracket__round">${esc(first)}</h3>
        <div class="bracket__matches">
          ${pairs.map((p, i) => `
            <div class="match" data-mid="r1m${i + 1}">
              <div class="match__no">${i + 1}</div>
              ${line(p[0])}
              ${line(p[1])}
              ${draw.rounds?.[0]?.matches?.[i]?.score ? `<p class="match__score">${esc(draw.rounds[0].matches[i].score)}</p>` : ''}
              ${whenHTML(sched, 'r1m' + (i + 1))}
            </div>`).join('')}
        </div>
      </div>`;

    /* Later rounds start empty and fill in as results come in. */
    const later = (draw.rounds || []).slice(1).map((r, ri) => `
      <div class="bracket__col">
        <h3 class="bracket__round">${esc(r.name)}</h3>
        <div class="bracket__matches">
          ${(r.matches || []).map((m, mi) => `
            <div class="match" data-mid="r${ri + 2}m${mi + 1}">
              ${m.p1 ? `<div class="slot"><span class="slot__name">${esc(m.p1)}</span></div>`
                     : `<div class="slot slot--empty">To be decided</div>`}
              ${m.p2 ? `<div class="slot"><span class="slot__name">${esc(m.p2)}</span></div>`
                     : `<div class="slot slot--empty">To be decided</div>`}
              ${m.score ? `<p class="match__score">${esc(m.score)}</p>` : ''}
              ${whenHTML(sched, 'r' + (ri + 2) + 'm' + (mi + 1))}
            </div>`).join('')}
        </div>
      </div>`).join('');

    return `
      <p class="bracket__hint">${draw.size}-player draw${draw.byes ? ` · ${draw.byes} bye${draw.byes === 1 ? '' : 's'}` : ''} · scroll sideways for later rounds</p>
      <div class="bracket">${firstRound}${later}</div>`;
  }

  /* ---------- Round robin groups ---------- */
  function groupsHTML(draw, sched) {
    const L = window.DrawLogic;

    return `<div class="groups">` + (draw.groups || []).map((g, gi) => {
      const table = L ? L.standings(g) : [];
      return `
      <section class="group">
        <h3 class="group__name">${esc(g.name)}</h3>

        <table class="table group__table">
          <thead>
            <tr><th>Player</th><th>P</th><th>W</th><th>L</th><th>Games</th></tr>
          </thead>
          <tbody>
            ${table.map((r, i) => `
              <tr${i < 2 ? ' class="group__through"' : ''}>
                <td data-col="tournament">
                  <span class="group__player">${esc(r.name)}</span>
                  ${r.club ? `<span class="slot__club">${esc(r.club)}</span>` : ''}
                </td>
                <td data-col="venue">${r.played}</td>
                <td data-col="venue">${r.won}</td>
                <td data-col="venue">${r.lost}</td>
                <td data-col="result">${r.gf}–${r.ga}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <ul class="group__fixtures">
          ${(g.matches || []).map((m, n) => `
            <li data-mid="g${gi + 1}m${n + 1}">
              <span class="group__fx">${esc(m.p1)} v ${esc(m.p2)}${whenHTML(sched, 'g' + (gi + 1) + 'm' + (n + 1))}</span>
              <span class="group__sc">${m.score ? esc(m.score) : '—'}</span>
            </li>`).join('')}
        </ul>
      </section>`;
    }).join('') + `</div>`;
  }

  /* ---------- Click a match: details popup ---------- */
  let tournamentsCache = null;
  async function tournamentOf(id) {
    if (!tournamentsCache) {
      try { tournamentsCache = (await (await fetch('/api/tournaments', { cache: 'no-store' }).then(r => r.ok ? r : fetch('content/tournaments.json'))).json()).tournaments || []; }
      catch { tournamentsCache = []; }
    }
    return tournamentsCache.find(t => t.id === id) || null;
  }

  function matchInfo(draw, sched, id) {
    const sm = sched && (sched.matches || []).find(x => x.id === id);
    const name = p => (p && typeof p === 'object') ? p.name : (p || '');
    let round = '', p1 = '', p2 = '', no = '';
    const km = /^r(\d+)m(\d+)$/.exec(id), gm = /^g(\d+)m(\d+)$/.exec(id);
    if (km) {
      const ri = Number(km[1]) - 1, mi = Number(km[2]) - 1;
      round = draw.rounds?.[ri]?.name || 'Round ' + km[1];
      no = km[2];
      if (ri === 0) { p1 = name(draw.slots?.[mi * 2]?.player); p2 = name(draw.slots?.[mi * 2 + 1]?.player); }
      else { p1 = name(draw.rounds?.[ri]?.matches?.[mi]?.p1); p2 = name(draw.rounds?.[ri]?.matches?.[mi]?.p2); }
    } else if (gm) {
      const g = draw.groups?.[Number(gm[1]) - 1];
      const f = g?.matches?.[Number(gm[2]) - 1];
      round = g?.name || 'Group'; no = gm[2]; p1 = f?.p1 || ''; p2 = f?.p2 || '';
    }
    if (sm) { p1 = name(sm.p1) || p1; p2 = name(sm.p2) || p2; round = sm.round || round; no = sm.no || no; }
    return { sm, round, no, p1, p2 };
  }

  function fmtWhen(t) {
    const d = t ? new Date(t) : null;
    if (!d || isNaN(d)) return '';
    const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh % 12 || 12}:${mm} ${hh < 12 ? 'am' : 'pm'}`;
  }

  let adminCache = null;
  async function isAdmin() {
    if (adminCache !== null) return adminCache;
    const pw = sessionStorage.getItem('nr-pass');
    if (!pw) return (adminCache = false);
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': pw }, body: '{}' });
      adminCache = r.ok && (await r.json()).name === 'Admin';
    } catch { adminCache = false; }
    return adminCache;
  }

  async function openMatch(draw, sched, id) {
    const info = matchInfo(draw, sched, id);
    if (!info.p1 && !info.p2) return;
    const t = await tournamentOf(draw.tournamentId);
    const sm = info.sm || {};
    const venue = t ? [t.venue, t.venue_address].filter(Boolean).join(', ') : '';
    const row = (k, v) => `<div class="mm__row"><dt>${k}</dt><dd>${v ? esc(v) : '<span class="mm__tbd">To be announced</span>'}</dd></div>`;
    const status = sm.status === 'done' ? 'Finished' : sm.status === 'live' ? 'Live now' : 'Scheduled';
    const canEdit = draw.id && sm.id && info.p1 && info.p2 && sm.status !== 'bye' && await isAdmin();
    const form = canEdit ? `<form class="mm__form" id="mmForm">
      <h4>Enter result (organiser)</h4>
      <div class="mm__win">
        <label><input type="radio" name="w" value="0" ${sm.winner === 0 ? 'checked' : ''} required> ${esc(info.p1)}</label>
        <label><input type="radio" name="w" value="1" ${sm.winner === 1 ? 'checked' : ''}> ${esc(info.p2)}</label>
      </div>
      <input class="pad__name" name="score" placeholder="Score, e.g. 11-9, 9-11, 11-5, 11-7" value="${esc(sm.score || '')}" maxlength="80">
      <button class="btn btn--solid" type="submit">Save result</button>
      <span class="pad__publish-state" id="mmState"></span>
    </form>` : '';

    const old = document.getElementById('mmModal'); if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'mmModal'; el.className = 'mm no-print';
    el.innerHTML = `<div class="mm__card" role="dialog" aria-modal="true" aria-label="Match details">
      <button class="mm__x" aria-label="Close">×</button>
      <p class="mm__tour">${esc(draw.tournament || '')}</p>
      <p class="mm__event">${esc(draw.event || '')} · ${esc(info.round)}${info.no ? ' · Match ' + esc(info.no) : ''}</p>
      <div class="mm__vs"><span>${esc(info.p1 || 'To be decided')}</span><em>v</em><span>${esc(info.p2 || 'To be decided')}</span></div>
      ${sm.score ? `<p class="mm__score">${esc(sm.score)}${sm.winner ? ' · ' + esc(sm.winner) + ' won' : ''}</p>` : ''}
      <dl class="mm__list">
        ${row('Court', sm.court ? 'Court ' + sm.court : '')}
        ${row('Time', fmtWhen(sm.time))}
        ${row('Venue', venue)}
        ${row('Referee', sm.referee)}
        ${row('Status', status)}
        ${sm.duration ? row('Match duration', (ms => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), mi = Math.floor(s % 3600 / 60); return h ? h + 'h ' + String(mi).padStart(2, '0') + 'm' : Math.max(1, Math.round(s / 60)) + ' min'; })(sm.duration)) : ''}
      </dl>${form}</div>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.mm__x')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    el.querySelector('.mm__x').focus();
    const f = el.querySelector('#mmForm');
    if (f) f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const st = el.querySelector('#mmState');
      const w = new FormData(f).get('w');
      if (sm.status === 'done' && !confirm('This match already has a result. Change it?')) return;
      st.textContent = 'Saving…';
      try {
        const r = await fetch('/api/result', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem('nr-pass') || '' },
          body: JSON.stringify({ sid: draw.id, id: sm.id, status: 'done', winner: Number(w), score: new FormData(f).get('score') }) });
        if (!r.ok) throw new Error(r.status === 404 ? 'Publish the draw and matches first.' : 'Could not save (' + r.status + ').');
        location.reload();
      } catch (err) { st.textContent = err.message; }
    });
  }

  /* ---------- Entry point ---------- */
  function render(el, draw, sched) {
    if (!el) return;
    if (!draw) {
      el.innerHTML = `<p class="pad__empty">No draw has been published yet.</p>`;
      return;
    }

    const head = `
      <div class="bracket__head">
        <h3 class="bracket__title">${esc(draw.tournament || 'Tournament draw')}</h3>
        ${draw.event ? `<p class="bracket__sub">${esc(draw.event)}</p>` : ''}
      </div>`;

    el.innerHTML = head +
      (draw.format === 'groups' ? groupsHTML(draw, sched) : knockoutHTML(draw, sched));
    el.onclick = e => {
      const m = e.target.closest('[data-mid]');
      if (m && el.contains(m)) openMatch(draw, sched, m.dataset.mid);
    };
  }

  window.DrawView = { render, esc };
})();
