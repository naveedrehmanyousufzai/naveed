/* ============================================================
   worker.js — the small server behind naveedrehman.com

   Everything on this site is a plain file except these addresses:

     /api/draw             the tournament draw (draw.html, draw-admin)
     /api/live             every match running right now
     /api/live?court=1     one court
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

/* Who is this? Returns a name, or null if the password matches nobody. */
function whoIs(request, env) {
  const given = request.headers.get("x-admin-password") || "";
  if (!given) return null;

  if (env.DRAW_ADMIN_PASSWORD && given === env.DRAW_ADMIN_PASSWORD) {
    return "Admin";
  }

  if (env.REFEREE_LOGINS) {
    let people = {};
    try {
      people = JSON.parse(env.REFEREE_LOGINS);
    } catch {
      /* A broken list must not let everyone in; treat it as empty. */
      return null;
    }
    for (const [name, password] of Object.entries(people)) {
      if (typeof password === "string" && password && given === password) return name;
    }
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

/* ---------- The draw: a single shared document ---------- */
async function drawRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  if (request.method === "GET") {
    return json((await env.DRAW_KV.get(DRAW_KEY)) || "null");
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env);
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

/* ---------- Check a password without changing anything ---------- */
function verifyRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const denied = needsPassword(request, env);
  if (denied) return denied;
  return json(JSON.stringify({ ok: true, name: whoIs(request, env) }));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === "/api/verify") return verifyRoute(request, env);
    if (path === "/api/draw")   return drawRoute(request, env);
    if (path === "/api/live")   return liveRoute(request, env);

    /* Not an API address — serve the ordinary file for it. */
    return env.ASSETS.fetch(request);
  },
};
