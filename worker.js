// AZO Claim Slot — Cloudflare Worker
// Deploy at: https://dash.cloudflare.com → Workers → Create Worker
// Add secret: wrangler secret put GITHUB_TOKEN
//   (use your ROSTER_TOKEN — Contents read/write on AZO-Dynamic-Rolelist)

const GITHUB_OWNER = 'andrew-ltu';
const GITHUB_REPO  = 'AZO-Dynamic-Rolelist';
const GITHUB_FILE  = 'roster.json';
const ALLOWED_ORIGIN = 'https://andrew-ltu.github.io';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { sectionKey, roleIndex, memberName } = body;
    if (!sectionKey || roleIndex === undefined || !memberName?.trim()) {
      return json({ error: 'Missing required fields' }, 400);
    }

    const name = memberName.trim();
    const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
    const headers = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'AZO-Claim-Worker'
    };

    // 1. Fetch current roster
    const getRes = await fetch(apiBase, { headers });
    if (!getRes.ok) {
      return json({ error: `GitHub fetch failed: ${getRes.status}` }, 502);
    }
    const meta = await getRes.json();
    const sha = meta.sha;
    const roster = JSON.parse(atob(meta.content.replace(/\n/g, '')));

    // 2. Find the slot
    let slot = null;
    try {
      if (sectionKey === '__command') {
        slot = roster.command?.[Number(roleIndex)];
      } else if (sectionKey === '__attachment') {
        slot = roster.attachments?.[roleIndex.attIdx]?.roles?.[roleIndex.roleIdx];
      } else {
        const sec = roster.sections?.find(s => s.name === sectionKey);
        if (sec) slot = sec.roles?.[Number(roleIndex)];
      }
    } catch (e) {
      return json({ error: 'Invalid role index' }, 400);
    }

    if (!slot) return json({ error: 'Role not found — refresh and try again' }, 404);
    if (slot.member) return json({ error: `Already claimed by ${slot.member}` }, 409);

    // 3. Assign and write back
    slot.member = name;
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Sign-up: ${name} → ${slot.role}`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(roster, null, 2)))),
        sha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return json({ error: err.message || `GitHub write failed: ${putRes.status}` }, 502);
    }

    return json({ ok: true, message: `${name} assigned to ${slot.role}` });

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        }
      });
    }
  }
};
