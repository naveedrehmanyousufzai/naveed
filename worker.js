/* ============================================================
   worker.js — the small server behind naveedrehman.com

   Everything on this site is a plain file except these addresses:

     /api/draw             the tournament draw (draw.html, draw-admin)
     /api/live             every match running right now
     /api/live?court=1     one court
     /api/schedule         the tournament's matches (court, time, referee)
     /api/result           a referee reports a match live / finished
     /api/verify           checks the referee password, changes nothing

   Reading is open to anyone. Writing needs the admin password in
   an x-admin-password header.

   Anything else is handed straight back to the static files, so
   the rest of the site is untouched.

   Needs, set in the Cloudflare dashboard:
     DRAW_KV              a KV namespace (storage)
     DRAW_ADMIN_PASSWORD  a secret — the master password
     REFEREE_LOGINS       a secret — one password per referee, as JSON:
                          {"Asif Khan":"swift-court-41","Sana Malik":"blue-rally-07"}
                          Optional. Without it, only the master password works.

   The referee's name is stamped onto the match here, on the server,
   so a scoresheet always says who actually refereed it.
   ============================================================ */

const DRAW_KEY = "current-draw";
const SCHED_KEY = "schedule";
const LIVE_PREFIX = "live:";

/* A match disappears on its own an hour after the last update, so a
   referee who walks off without stopping does not leave a ghost up. */
const LIVE_TTL_SECONDS = 3600;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
};

const json = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors,
      ...extra,
    },
  });

const fail = (msg, status) => json(JSON.stringify({ error: msg }), status);

/* Court names come from a text box, so keep them to something safe
   and short before they become part of a storage key. */
function cleanCourt(raw) {
  const c = String(raw || "").trim().replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 24);
  return c || null;
}

/* The referee list can be written either way:

     Naveed Rehman: karachi-court-11
     Asif Khan: swift-rally-07

   or as JSON:

     {"Naveed Rehman":"karachi-court-11"}

   The plain lines are easier to type without a mistake, so they are
   tried as well. A list that cannot be read at all admits nobody. */
function parseLogins(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    try { return JSON.parse(text); } catch { return null; }
  }

  const people = {};
  for (const line of text.split(/[\n;]/)) {
    const t = line.trim();
    if (!t) continue;
    const at = t.search(/[:=]/);
    if (at < 1) continue;
    const name = t.slice(0, at).trim().replace(/^["']|["']$/g, "");
    const pass = t.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    if (name && pass) people[name] = pass;
  }
  return people;
}

/* Who is this? Returns a name, or null if the password matches nobody. */
function whoIs(request, env) {
  const given = request.headers.get("x-admin-password") || "";
  if (!given) return null;

  if (env.DRAW_ADMIN_PASSWORD && given === env.DRAW_ADMIN_PASSWORD) {
    return "Admin";
  }

  const people = parseLogins(env.REFEREE_LOGINS);
  if (!people) return null;           // unreadable list: let nobody in

  for (const [name, password] of Object.entries(people)) {
    if (typeof password === "string" && password && given === password) return name;
  }

  return null;
}

/* Returns a refusal Response, or null when the caller is allowed through. */
function needsPassword(request, env) {
  if (!env.DRAW_ADMIN_PASSWORD && !env.REFEREE_LOGINS) {
    return fail("No passwords are set up yet.", 503);
  }
  if (!whoIs(request, env)) return fail("Wrong password.", 401);
  return null;
}

/* Only the master password may build draws and assign matches. */
function needsAdmin(request, env) {
  return whoIs(request, env) === "Admin" ? null : fail("Organiser password needed.", 403);
}

/* ---------- The draw: a single shared document ---------- */
async function drawRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  if (request.method === "GET") {
    return json((await env.DRAW_KV.get(DRAW_KEY)) || "null");
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    const body = await request.text();
    try { JSON.parse(body); } catch { return fail("Invalid JSON.", 400); }
    await env.DRAW_KV.put(DRAW_KEY, body);
    return json(JSON.stringify({ ok: true }));
  }

  return fail("Method not allowed.", 405);
}

/* ---------- Live matches: one entry per court ---------- */
async function liveRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const court = cleanCourt(new URL(request.url).searchParams.get("court"));

  if (request.method === "GET") {
    /* One court asked for by name. */
    if (court) {
      return json((await env.DRAW_KV.get(LIVE_PREFIX + court)) || "null");
    }

    /* Otherwise every match currently running. */
    const list = await env.DRAW_KV.list({ prefix: LIVE_PREFIX });
    const matches = [];
    for (const k of list.keys) {
      const raw = await env.DRAW_KV.get(k.name);
      if (!raw) continue;
      try {
        const m = JSON.parse(raw);
        m.court = k.name.slice(LIVE_PREFIX.length);
        matches.push(m);
      } catch { /* skip anything unreadable rather than failing the lot */ }
    }
    matches.sort((a, b) =>
      String(a.court).localeCompare(String(b.court), undefined, { numeric: true }));
    return json(JSON.stringify({ matches }));
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env);
    if (denied) return denied;
    if (!court) return fail("No court given.", 400);

    let match;
    try { match = JSON.parse(await request.text()); }
    catch { return fail("Invalid JSON.", 400); }

    /* The name comes from the password, not from the page, so nobody
       can publish a match under someone else's name. */
    match.referee = whoIs(request, env);

    await env.DRAW_KV.put(LIVE_PREFIX + court, JSON.stringify(match), {
      expirationTtl: LIVE_TTL_SECONDS,
    });
    return json(JSON.stringify({ ok: true, court, referee: match.referee }));
  }

  return fail("Method not allowed.", 405);
}


/* ============================================================
   SCHEDULE — the matches of a tournament, made from the draw.

   {drawId, tournament, event, logo, matches:[
     {id, round, p1:{name,club}|null, p2, court, time, referee,
      status:'scheduled'|'live'|'done'|'bye', winner:0|1|'', score:'',
      ref:{ri,mi} (knockout) or {g,n} (group)} ]}

   The organiser sets court, time and referee. Referees report
   when a match goes live and when it finishes; the winner is
   moved into the next round here, and the draw is kept in step.
   ============================================================ */
async function readJSON(env, key) {
  const raw = await env.DRAW_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function scheduleRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  if (request.method === "GET") {
    return json((await env.DRAW_KV.get(SCHED_KEY)) || "null");
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;

    let body;
    try { body = JSON.parse(await request.text()); }
    catch { return fail("Invalid JSON.", 400); }
    if (!body || !Array.isArray(body.matches)) return fail("No matches given.", 400);

    const old = await readJSON(env, SCHED_KEY);
    let out = body;

    /* Same draw: take only the organiser's fields, so a result a referee
       reported a moment ago is never overwritten by a stale page. */
    if (old && old.drawId && old.drawId === body.drawId) {
      const byId = new Map(body.matches.map(m => [m.id, m]));
      for (const m of old.matches) {
        const n = byId.get(m.id);
        if (!n) continue;
        m.court = String(n.court || "").slice(0, 24);
        m.time = String(n.time || "").slice(0, 32);
        m.referee = String(n.referee || "").slice(0, 60);
      }
      old.tournament = body.tournament;
      old.event = body.event;
      old.logo = body.logo;
      out = old;
    }
    out.updated = Date.now();
    await env.DRAW_KV.put(SCHED_KEY, JSON.stringify(out));
    return json(JSON.stringify(out));
  }

  return fail("Method not allowed.", 405);
}

/* A referee reports: this match is live / this match is finished. */
async function resultRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const denied = needsPassword(request, env);
  if (denied) return denied;
  const who = whoIs(request, env);

  let r;
  try { r = JSON.parse(await request.text()); }
  catch { return fail("Invalid JSON.", 400); }

  const sched = await readJSON(env, SCHED_KEY);
  if (!sched) return fail("No schedule is published.", 404);
  const m = sched.matches.find(x => x.id === r.id);
  if (!m) return fail("No such match.", 404);

  if (who !== "Admin" && m.referee && m.referee !== who) {
    return fail("This match is assigned to " + m.referee + ".", 403);
  }

  if (r.status === "live") {
    if (m.status !== "done") m.status = "live";
  } else if (r.status === "done" && (r.winner === 0 || r.winner === 1)) {
    m.status = "done";
    m.winner = r.winner;
    m.score = String(r.score || "").slice(0, 80);
    m.finished = Date.now();
    const draw = await readJSON(env, DRAW_KEY);
    advance(sched, m, draw);
    if (draw) await env.DRAW_KV.put(DRAW_KEY, JSON.stringify(draw));
  } else {
    return fail("Nothing to record.", 400);
  }

  sched.updated = Date.now();
  await env.DRAW_KV.put(SCHED_KEY, JSON.stringify(sched));
  return json(JSON.stringify({ ok: true }));
}

/* Put the winner into the next round, and mirror it onto the draw. */
function advance(sched, m, draw) {
  const sameDraw = draw && draw.made && String(draw.made) === String(sched.drawId);

  if (m.ref && m.ref.g !== undefined) {                 // group match
    if (sameDraw) {
      const dm = draw.groups?.[m.ref.g]?.matches?.[m.ref.n];
      if (dm) {
        dm.score = m.score;
        dm.winner = m.winner === 0 ? "1" : "2";
        dm.status = "Final";
      }
    }
    return;
  }
  if (!m.ref) return;

  const { ri, mi } = m.ref;
  const winner = m.winner === 0 ? m.p1 : m.p2;

  if (sameDraw) {
    const dm = draw.rounds?.[ri]?.matches?.[mi];
    if (dm) {
      dm.score = m.score;
      dm.winner = m.winner === 0 ? "1" : "2";
      dm.status = "Final";
    }
  }

  const next = sched.matches.find(x => x.ref && x.ref.ri === ri + 1 && x.ref.mi === Math.floor(mi / 2));
  if (!next) return;
  const slot = mi % 2 === 0 ? "p1" : "p2";
  next[slot] = winner ? { name: winner.name, club: winner.club || "" } : null;
  if (sameDraw) {
    const nd = draw.rounds?.[ri + 1]?.matches?.[Math.floor(mi / 2)];
    if (nd) nd[mi % 2 === 0 ? "p1" : "p2"] = winner ? winner.name : "";
  }
}

/* ---------- Check a password without changing anything ---------- */
function verifyRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const denied = needsPassword(request, env);
  if (denied) return denied;
  const name = whoIs(request, env);
  const out = { ok: true, name };
  /* The organiser needs the referee names to assign matches. */
  if (name === "Admin") {
    const people = parseLogins(env.REFEREE_LOGINS) || {};
    out.referees = Object.keys(people);
  }
  return json(JSON.stringify(out));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === "/api/verify") return verifyRoute(request, env);
    if (path === "/api/draw")   return drawRoute(request, env);
    if (path === "/api/live")   return liveRoute(request, env);
    if (path === "/api/schedule") return scheduleRoute(request, env);
    if (path === "/api/result") return resultRoute(request, env);

    /* Not an API address — serve the ordinary file for it. */
    return env.ASSETS.fetch(request);
  },
};
