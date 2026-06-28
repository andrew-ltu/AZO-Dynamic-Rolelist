// AZO Claim Slot — Cloudflare Worker
// Deploy at: https://dash.cloudflare.com → Workers → Create Worker
// Add secret: wrangler secret put GITHUB_TOKEN
//   (use your ROSTER_TOKEN — Contents read/write on AZO-Dynamic-Rolelist)

const GITHUB_OWNER = 'andrew-ltu';
const GITHUB_REPO  = 'AZO-Dynamic-Rolelist';
const ALLOWED_ORIGINS = [
  'https://andrew-ltu.github.io',
  'https://azo-dynamic-rolelist.pages.dev'
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
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
    const baseRepoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
    const headers = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'AZO-Claim-Worker'
    };

    // 1. Fetch current roster AND members directory in parallel
    const [rosterRes, membersRes] = await Promise.all([
      fetch(`${baseRepoUrl}/roster.json`, { headers }),
      fetch(`${baseRepoUrl}/members.json`, { headers })
    ]);

    if (!rosterRes.ok) {
      return json({ error: `GitHub roster fetch failed: ${rosterRes.status}` }, 502);
    }
    if (!membersRes.ok) {
      return json({ error: `GitHub members fetch failed: ${membersRes.status}` }, 502);
    }

    const rosterMeta = await rosterRes.json();
    const membersMeta = await membersRes.json();

    const sha = rosterMeta.sha;
    const roster = JSON.parse(atob(rosterMeta.content.replace(/\n/g, '')));
    const membersData = JSON.parse(atob(membersMeta.content.replace(/\n/g, '')));

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

    // 2.5 Validation: Check if user is certified for this slot
    if (slot.endorsementRequired && slot.endorsementType) {
      // Look up member case-insensitively to prevent casing typing errors from breaking it
      const memberKey = Object.keys(membersData).find(k => k.toLowerCase() === name.toLowerCase());
      const member = memberKey ? membersData[memberKey] : null;

      if (!member) {
        return json({ error: `Access Denied: "${name}" is not a registered member in the directory.` }, 403);
      }

      // Handle Leadership Slots
      if (slot.endorsementType === "Leadership Endorsement") {
        if (!member.leadership) {
          return json({ error: `Access Denied: "${name}" does not have a Leadership qualification.` }, 403);
        }
      } 
      // Handle Qualification Endorsements (Medical, JTAC, etc.)
      else {
        // Strip " Endorsement" from strings like "Medical Endorsement" to match tags like "Medical"
        const requiredEndorsement = slot.endorsementType.replace(" Endorsement", "");
        
        const hasEndorsement = member.endorsements && member.endorsements.some(
          e => e.toLowerCase() === requiredEndorsement.toLowerCase()
        );

        if (!hasEndorsement) {
          return json({ error: `Access Denied: "${name}" lacks the required "${requiredEndorsement}" certification.` }, 403);
        }
      }
    }

    // 3. Assign and write back
    slot.member = name;
    const putRes = await fetch(`${baseRepoUrl}/roster.json`, {
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
          'Access-Control-Allow-Origin': allowedOrigin,
        }
      });
    }
  }
};
