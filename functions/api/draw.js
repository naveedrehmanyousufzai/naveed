// Cloudflare Pages Function — handles GET/POST for the live squash draw.
// Requires a KV namespace bound as DRAW_KV, and a secret DRAW_ADMIN_PASSWORD,
// both set in the Cloudflare Pages project settings.

const KV_KEY = "current-draw";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
};

export async function onRequestGet(context) {
  const { env } = context;
  const value = await env.DRAW_KV.get(KV_KEY);
  return new Response(value || "null", {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const password = request.headers.get("x-admin-password") || "";

  if (!env.DRAW_ADMIN_PASSWORD || password !== env.DRAW_ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const body = await request.text();
  try {
    JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  await env.DRAW_KV.put(KV_KEY, body);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}
