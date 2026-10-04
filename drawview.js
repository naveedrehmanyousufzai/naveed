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
      if (!s || !s.player) return `<div class="slot slot--empty">Bye</div>`;
      return `<div class="slot">
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
            <div class="match">
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
            <div class="match">
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
            <li>
              <span class="group__fx">${esc(m.p1)} v ${esc(m.p2)}${whenHTML(sched, 'g' + (gi + 1) + 'm' + (n + 1))}</span>
              <span class="group__sc">${m.score ? esc(m.score) : '—'}</span>
            </li>`).join('')}
        </ul>
      </section>`;
    }).join('') + `</div>`;
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
  }

  window.DrawView = { render, esc };
})();
