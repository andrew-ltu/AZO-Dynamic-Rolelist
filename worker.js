const GITHUB_OWNER = 'andrew-ltu';
const GITHUB_REPO = 'AZO-Dynamic-Rolelist';
const ALLOWED_ORIGINS = [
  'https://andrew-ltu.github.io',
  'https://azo-dynamic-rolelist.pages.dev',
  'http://localhost:8770'
];
const PAGES_URL = 'https://azo-dynamic-rolelist.pages.dev';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GUILD_ID = '504188370507792384';
const REDIRECT_URI = 'https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback';
const ADMIN_IDS = ['203678139220623361', '207012290401271818', '850370739998818335'];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

function jsonResponse(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

async function generateToken(userId, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const message = `${encodedHeader}.${encodedPayload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${message}.${encodedSignature}`;
}

async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const message = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signatureBytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(message));
    if (!valid) return null;
    const payload = JSON.parse(atob(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

async function getRoster(env) {
  const row = await env.DB.prepare(`SELECT data FROM roster WHERE id = 1`).first();
  if (row) {
    const data = JSON.parse(row.data);
    const op = data.operation || {};
    if (!op.zeus || !op.date) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/roster.json`);
        if (res.ok) {
          const github = await res.json();
          const gOp = github?.operation || {};
          if (!op.zeus && gOp.zeus) op.zeus = gOp.zeus;
          if (!op.date && gOp.date) op.date = gOp.date;
        }
      } catch {}
    }
    return data;
  }
  const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/roster.json`);
  if (!res.ok) return null;
  const data = await res.json();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT OR REPLACE INTO roster (id, data, updated_at) VALUES (1, ?, ?)`).bind(JSON.stringify(data), now).run();
  return data;
}

async function saveRoster(env, data) {
  const now = Math.floor(Date.now() / 1000);
  // Auto-backup previous state before saving
  const prev = await env.DB.prepare(`SELECT data FROM roster WHERE id = 1`).first();
  if (prev) {
    await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_roster_snapshot', ?, ?)`).bind(prev.data, now).run();
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO roster (id, data, updated_at) VALUES (1, ?, ?)`).bind(JSON.stringify(data), now).run();
}

async function getCachedGuildRoles(env, oauthToken) {
  const cached = await env.DB.prepare(`SELECT data, updated_at FROM members WHERE name = '_guild_roles'`).first();
  if (cached) {
    const age = Math.floor(Date.now() / 1000) - cached.updated_at;
    if (age < 3600) return JSON.parse(cached.data);
  }
  let guildRoles = [];
  if (env.DISCORD_BOT_TOKEN) {
    const resp = await fetch(`${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/roles`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (resp.ok) guildRoles = await resp.json();
  }
  if (!guildRoles.length && oauthToken) {
    try {
      const resp = await fetch(`${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/roles`, {
        headers: { Authorization: `Bearer ${oauthToken}` }
      });
      if (resp.ok) guildRoles = await resp.json();
    } catch (_) {}
  }
  if (guildRoles.length) {
    const roleMap = {};
    guildRoles.forEach(r => { roleMap[r.id] = r.name; });
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_guild_roles', ?, ?)`)
      .bind(JSON.stringify(roleMap), now).run();
    return roleMap;
  }
  if (cached) return JSON.parse(cached.data);
  return {};
}

async function getMembers(env) {
  const row = await env.DB.prepare(`SELECT data FROM members WHERE name = '_meta'`).first();
  if (row) return JSON.parse(row.data);
  const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`);
  if (!res.ok) return {};
  const data = await res.json();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_meta', ?, ?)`).bind(JSON.stringify(data), now).run();
  return data;
}

async function saveMembers(env, data) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_meta', ?, ?)`).bind(JSON.stringify(data), now).run();
}

async function addMember(env, name, discordId, displayName) {
  const membersData = await getMembers(env);
  if (membersData[name]) return name;
  // Check if discordId already exists
  for (const [n, d] of Object.entries(membersData)) {
    if (d.discordId === discordId) return n;
  }
  membersData[name] = {
    discordId,
    discordRank: 'Recruit',
    avatar: '',
    opsAttended: 0,
    endorsements: [],
    leadership: null
  };
  await saveMembers(env, membersData);
  return name;
}

function findMemberName(membersData, discordId, displayName) {
  for (const [name, d] of Object.entries(membersData)) {
    if (d.discordId === discordId) return name;
  }
  const lower = displayName.toLowerCase();
  for (const [name] of Object.entries(membersData)) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

function matchRankFromRoles(roleIds, roleMap, rankPriority) {
  let matchedRank = null;
  let matchedPrio = Infinity;
  for (const rid of roleIds) {
    const rName = roleMap[rid] || '';
    const idx = rankPriority.indexOf(rName);
    if (idx !== -1 && idx < matchedPrio) {
      matchedRank = rName;
      matchedPrio = idx;
    }
  }
  return matchedRank;
}

function findUserSlot(roster, userName) {
  if (!roster || !userName) return null;
  const lower = userName.toLowerCase();
  for (const s of roster.sections || []) {
    for (let i = 0; i < (s.roles || []).length; i++) {
      if (s.roles[i].member && s.roles[i].member.toLowerCase() === lower) return { sectionKey: s.name, roleIndex: i };
    }
  }
  for (let i = 0; i < (roster.command || []).length; i++) {
    if (roster.command[i].member && roster.command[i].member.toLowerCase() === lower) return { sectionKey: '__command', roleIndex: i };
  }
  for (let ai = 0; ai < (roster.attachments || []).length; ai++) {
    for (let i = 0; i < (roster.attachments[ai].roles || []).length; i++) {
      if (roster.attachments[ai].roles[i].member && roster.attachments[ai].roles[i].member.toLowerCase() === lower) return { sectionKey: '__attachment', roleIndex: { attIdx: ai, roleIdx: i } };
    }
  }
  return null;
}

function findSlot(roster, sectionKey, roleIndex) {
  if (sectionKey === '__command') return roster.command?.[Number(roleIndex)];
  if (sectionKey === '__attachment') return roster.attachments?.[roleIndex.attIdx]?.roles?.[roleIndex.roleIdx];
  const sec = roster.sections?.find(s => s.name === sectionKey);
  return sec ? sec.roles?.[Number(roleIndex)] : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });

    if (url.pathname === '/auth/login') return handleLogin(env);
    if (url.pathname === '/auth/callback') return handleCallback(request, env);
    if (url.pathname === '/api/user') return handleGetUser(request, env, origin);
    if (url.pathname === '/api/logout') return handleLogout(request, env, origin);
    if (url.pathname === '/api/roster') return handleGetRoster(request, env, origin);
    if (url.pathname === '/api/members') return handleGetMembers(request, env, origin);
    if ((url.pathname === '/' || url.pathname === '/claim') && request.method === 'POST') return handleClaimSlot(request, env, origin);
    if (url.pathname === '/api/admin/roster' && request.method === 'POST') return handleAdminSaveRoster(request, env, origin);
    if (url.pathname === '/api/unassign' && request.method === 'POST') return handleUnassignSlot(request, env, origin);
    if (url.pathname === '/api/admin/archive-op' && request.method === 'POST') return handleArchiveOp(request, env, origin);
    if (url.pathname === '/api/admin/clear-assignments' && request.method === 'POST') return handleClearAssignments(request, env, origin);
    if (url.pathname === '/api/admin/save-members' && request.method === 'POST') return handleAdminSaveMembers(request, env, origin);
    if (url.pathname === '/api/admin/delete-archive' && request.method === 'POST') return handleDeleteArchive(request, env, origin);
    if (url.pathname === '/api/previous-ops' && request.method === 'GET') return handleGetPreviousOps(request, env, origin);
    if (url.pathname === '/api/discord-stats' && request.method === 'GET') return handleDiscordStats(request, env, origin);
    if (url.pathname === '/api/admin/sync-github' && request.method === 'POST') return handleSyncFromGitHub(request, env, origin);
    if (url.pathname === '/api/auto-sync' && request.method === 'POST') return handleAutoSync(request, env, origin);
    if (url.pathname === '/api/admin/restore-snapshot' && request.method === 'POST') return handleRestoreSnapshot(request, env, origin);
    if (url.pathname === '/api/gallery' && request.method === 'GET') return handleListGallery(request, env, origin);
    if (url.pathname === '/api/gallery/upload' && request.method === 'POST') return handleGalleryUpload(request, env, origin);
    if (url.pathname.match(/^\/api\/gallery\/image\//) && request.method === 'GET') return handleGalleryImage(request, env, origin);
    if (url.pathname.match(/^\/api\/gallery\//) && request.method === 'DELETE') return handleGalleryDelete(request, env, origin);

    // Calendar ops
    if (url.pathname === '/api/calendar-ops' && request.method === 'GET') return handleListCalendarOps(env, origin);
    if (url.pathname === '/api/admin/calendar-ops' && request.method === 'POST') return handleSaveCalendarOp(request, env, origin);
    if (url.pathname.match(/^\/api\/admin\/calendar-ops\//) && request.method === 'DELETE') return handleDeleteCalendarOp(request, env, origin);
    if (url.pathname === '/api/admin/upload-banner' && request.method === 'POST') return handleUploadBanner(request, env, origin);
    if (url.pathname.match(/^\/api\/banner-image\//) && request.method === 'GET') return handleBannerImage(request, env, origin);

    // Roster background
    if (url.pathname === '/api/roster-bg' && request.method === 'GET') return handleGetRosterBg(env, origin);
    if (url.pathname === '/api/admin/roster-bg' && request.method === 'POST') return handleSetRosterBg(request, env, origin);
    if (url.pathname === '/api/admin/roster-bg' && request.method === 'DELETE') return handleRemoveRosterBg(request, env, origin);

    // Prune members who left Discord
    if (url.pathname === '/api/admin/prune-members' && request.method === 'POST') return handlePruneMembers(request, env, origin);

    return jsonResponse({ error: 'Not found' }, 404, origin);
  }
};

async function handleLogin(env) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email guilds guilds.members.read'
  });
  return Response.redirect(`${DISCORD_API}/oauth2/authorize?${params}`, 302);
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing authorization code', { status: 400 });

  try {
    const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    if (!tokenResponse.ok) throw new Error('Failed to exchange code for token');

    const tokenData = await tokenResponse.json();
    const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userResponse.ok) throw new Error('Failed to fetch user info');
    const user = await userResponse.json();

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      INSERT INTO users (id, username, discriminator, global_name, avatar, email, created_at, last_login, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username, global_name = excluded.global_name,
        avatar = excluded.avatar, email = excluded.email, last_login = excluded.last_login
    `).bind(user.id, user.username, user.discriminator || '', user.global_name || user.username,
      user.avatar || '', user.email || '', now, now, ADMIN_IDS.includes(user.id) ? 1 : 0).run();

    let roleNames = [];
    let isDiscordAdmin = false;
    try {
      const memberResponse = await fetch(
        `${DISCORD_API}/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        const roleIds = memberData.roles || [];
        const roleMap = await getCachedGuildRoles(env, tokenData.access_token);
        roleNames = roleIds.map(id => roleMap[id]).filter(Boolean);
        if (!roleNames.length && roleIds.length) {
          roleNames = roleIds.map(id => `_id:${id}`);
        }
        isDiscordAdmin = roleNames.some(r => /admin|staff/i.test(r));
        await env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(user.id).run();
        const stmt = `INSERT INTO user_roles (user_id, role_name, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`;
        for (const roleName of roleNames) {
          await env.DB.prepare(stmt).bind(user.id, roleName, now, 'discord-sync').run();
        }
      }
    } catch (e) { console.error('Failed to sync Discord roles:', e); }
    if (isDiscordAdmin) {
      await env.DB.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).bind(user.id).run();
    } else if (!ADMIN_IDS.includes(user.id)) {
      await env.DB.prepare(`UPDATE users SET is_admin = 0 WHERE id = ?`).bind(user.id).run();
    }

    const jwtToken = await generateToken(user.id, env.JWT_SECRET);
    await env.DB.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(jwtToken, user.id, now, now + (30 * 24 * 60 * 60)).run();

    const redirectUrl = `${PAGES_URL}/roster/?token=${jwtToken}`;
    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    return new Response(`Authentication failed: ${error.message}`, { status: 500 });
  }
}

async function handleGetUser(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonResponse({ error: 'Invalid token' }, 401, origin);

  const userResult = await env.DB.prepare(`SELECT id, username, global_name, avatar, email, is_admin FROM users WHERE id = ?`
  ).bind(payload.sub).first();
  if (!userResult) return jsonResponse({ error: 'User not found' }, 404, origin);

  const rolesResult = await env.DB.prepare(`SELECT role_name FROM user_roles WHERE user_id = ?`
  ).bind(payload.sub).all();
  const roles = rolesResult.results.map(r => r.role_name);

  let rosterName = null;
  try {
    const membersData = await getMembers(env);
    rosterName = findMemberName(membersData, userResult.id, userResult.global_name || userResult.username);
    if (!rosterName) {
      const newName = userResult.global_name || userResult.username;
      rosterName = await addMember(env, newName, userResult.id, userResult.global_name || userResult.username);
    }
  } catch (e) { console.error('Failed to find roster name:', e); }

  if (!roles.length && env.DISCORD_BOT_TOKEN) {
    try {
      const memberResp = await fetch(
        `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${userResult.id}`,
        { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
      );
      if (memberResp.ok) {
        const memberData = await memberResp.json();
        const roleIds = memberData.roles || [];
        const roleMap = await getCachedGuildRoles(env);
        const fetchedRoles = roleIds.map(id => roleMap[id]).filter(Boolean);
        if (fetchedRoles.length) {
          const now = Math.floor(Date.now() / 1000);
          await env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(userResult.id).run();
          const stmt = `INSERT INTO user_roles (user_id, role_name, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`;
          for (const roleName of fetchedRoles) {
            await env.DB.prepare(stmt).bind(userResult.id, roleName, now, 'discord-sync').run();
          }
          roles.push(...fetchedRoles);
          if (fetchedRoles.some(r => /admin|staff/i.test(r))) {
            await env.DB.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).bind(userResult.id).run();
          }
        }
      }
    } catch (e) { console.error('On-demand role sync failed:', e); }
  }

  // Resolve any _id: prefixed roles using cached guild roles
  const roleMap = await getCachedGuildRoles(env);
  const resolvedRoles = roles.map(r => r.startsWith('_id:') ? (roleMap[r.slice(4)] || r) : r);

  return jsonResponse({
    user: {
      id: userResult.id,
      username: userResult.username,
      displayName: userResult.global_name,
      avatar: userResult.avatar,
      email: userResult.email,
      isAdmin: userResult.is_admin === 1 || ADMIN_IDS.includes(userResult.id) || resolvedRoles.some(r => /admin|staff/i.test(r)),
      roles: resolvedRoles,
      rosterName
    }
  }, 200, origin);
}

async function handleLogout(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
  }
  return jsonResponse({ ok: true }, 200, origin);
}

// GET /api/roster - returns full roster from D1 (auto-seeds from GitHub if empty)
async function handleGetRoster(request, env, origin) {
  try {
    const roster = await getRoster(env);
    if (!roster) return jsonResponse({ error: 'Roster not found' }, 404, origin);
    return jsonResponse(roster, 200, origin);
  } catch (e) {
    return jsonResponse({ error: 'Failed to fetch roster' }, 500, origin);
  }
}

// GET /api/members - returns full members data from D1
async function handleGetMembers(request, env, origin) {
  try {
    const members = await getMembers(env);
    // 1. Enrich from users table (cached OAuth) — only for members without discordId (local-name match)
    const userResults = await env.DB.prepare(`SELECT id, username, global_name, avatar FROM users`).all();
    for (const user of userResults.results) {
      if (!user.avatar) continue;
      for (const [name, data] of Object.entries(members)) {
        if (name.startsWith('_')) continue;
        if (data.avatar && data.avatar.startsWith('/')) continue;
        if (data.discordId === user.id) break; // handled by Bot API below
        if (name.toLowerCase() === (user.global_name || user.username).toLowerCase()) {
          data.avatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=256`;
          break;
        }
      }
    }
    // 2. Bot API — refreshes avatars, syncs Discord ranks for members with discordId,
    //    and matches members without discordId by display name
    if (env.DISCORD_BOT_TOKEN) {
      const RANK_PRIORITY = ['SOHQ','SOCOMD','Senior Operator','Operator','Junior Operator','Recruit'];
      try {
        const guildRes = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (guildRes.ok) {
          const roleMap = await getCachedGuildRoles(env);
          const guildMembers = await guildRes.json();
          let changed = false;
          // Members with discordId — match by ID
          for (const [name, data] of Object.entries(members)) {
            if (name.startsWith('_') || !data.discordId) continue;
            const gm = guildMembers.find(m => m.user && m.user.id === data.discordId);
            if (!gm) continue;
            if (gm.user && gm.user.avatar) {
              const newAv = `https://cdn.discordapp.com/avatars/${gm.user.id}/${gm.user.avatar}.webp?size=256`;
              if (data.avatar !== newAv) { data.avatar = newAv; changed = true; }
            }
            const matchedRank = matchRankFromRoles(gm.roles || [], roleMap, RANK_PRIORITY);
            if (matchedRank && data.discordRank !== matchedRank) {
              data.discordRank = matchedRank; changed = true;
            }
          }
          // Members without discordId — match by display name
          for (const [name, data] of Object.entries(members)) {
            if (name.startsWith('_') || data.discordId) continue;
            const gm = guildMembers.find(m => {
              if (!m.user) return false;
              const disp = (m.nick || m.user.global_name || m.user.username || '').toLowerCase();
              return disp === name.toLowerCase();
            });
            if (!gm) continue;
            data.discordId = gm.user.id;
            if (gm.user && gm.user.avatar) {
              data.avatar = `https://cdn.discordapp.com/avatars/${gm.user.id}/${gm.user.avatar}.webp?size=256`;
            }
            const matchedRank = matchRankFromRoles(gm.roles || [], roleMap, RANK_PRIORITY);
            if (matchedRank && data.discordRank !== matchedRank) {
              data.discordRank = matchedRank;
            }
            changed = true;
          }
          // Prune members with discordId no longer in the server
          const guildIdSet = new Set(guildMembers.filter(m => m.user).map(m => m.user.id));
          for (const [name, data] of Object.entries(members)) {
            if (name.startsWith('_') || typeof data !== 'object' || !data.discordId) continue;
            if (!guildIdSet.has(data.discordId)) {
              delete members[name];
              changed = true;
            }
          }
          if (changed) await saveMembers(env, members);
        }
      } catch(e) { console.error('Bot sync failed:', e); }
    }
    return jsonResponse(members, 200, origin);
  } catch (e) {
    return jsonResponse({ error: 'Failed to fetch members' }, 500, origin);
  }
}

/* ---------- Calendar Operations ---------- */

async function handleListCalendarOps(env, origin) {
  try {
    const rows = await env.DB.prepare('SELECT * FROM calendar_ops ORDER BY sort_order ASC, created_at DESC').all();
    return jsonResponse(rows.results || [], 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleSaveCalendarOp(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const body = await request.json();
    const { id, name, date, short, zeus, status, theme, sort_order, banner, notes } = body;
    if (!name || !date || !short || !zeus) return jsonResponse({ error: 'Missing required fields (name, date, short, zeus)' }, 400, origin);
    const now = Math.floor(Date.now() / 1000);
    if (id) {
      await env.DB.prepare('UPDATE calendar_ops SET name=?, date=?, short=?, zeus=?, status=?, theme=?, sort_order=?, banner=?, notes=?, updated_at=? WHERE id=?')
        .bind(name, date, short, zeus, status || 'upcoming', theme || '', sort_order || 0, banner || '', notes || '', now, id).run();
    } else {
      await env.DB.prepare('INSERT INTO calendar_ops (name, date, short, zeus, status, theme, sort_order, banner, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(name, date, short, zeus, status || 'upcoming', theme || '', sort_order || 0, banner || '', notes || '', now, now).run();
    }
    return jsonResponse({ ok: true }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleDeleteCalendarOp(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const id = request.url.split('/').pop();
    await env.DB.prepare('DELETE FROM calendar_ops WHERE id = ?').bind(id).run();
    return jsonResponse({ ok: true }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

/* ---------- Roster Background ---------- */

async function handleGetRosterBg(env, origin) {
  try {
    const row = await env.DB.prepare(`SELECT data FROM members WHERE name = '_roster_bg'`).first();
    if (!row) return jsonResponse(null, 200, origin);
    return jsonResponse(JSON.parse(row.data), 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleSetRosterBg(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const body = await request.json();
    const { imageId } = body;
    if (!imageId) return jsonResponse({ error: 'Missing imageId' }, 400, origin);
    const row = await env.DB.prepare('SELECT r2_key, op_name FROM gallery_images WHERE id = ?').bind(imageId).first();
    if (!row) return jsonResponse({ error: 'Image not found' }, 404, origin);
    const url = `https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/api/gallery/image/${imageId}`;
    const data = JSON.stringify({ imageId, url, r2Key: row.r2_key, opName: row.op_name });
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT OR REPLACE INTO members (name, data, updated_at) VALUES (\'_roster_bg\', ?, ?)').bind(data, now).run();
    const roster = await getRoster(env);
    if (roster) {
      roster.operation = roster.operation || {};
      roster.operation.background = url;
      await saveRoster(env, roster);
    }
    return jsonResponse({ ok: true, url }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleRemoveRosterBg(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    await env.DB.prepare('DELETE FROM members WHERE name = \'_roster_bg\'').run();
    const roster = await getRoster(env);
    if (roster && roster.operation && roster.operation.background) {
      delete roster.operation.background;
      await saveRoster(env, roster);
    }
    return jsonResponse({ ok: true }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

/* ---------- Prune Discord Leavers ---------- */

async function handlePruneMembers(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    if (!env.DISCORD_BOT_TOKEN) return jsonResponse({ error: 'DISCORD_BOT_TOKEN not configured' }, 500, origin);
    const guildRes = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (!guildRes.ok) return jsonResponse({ error: 'Failed to fetch guild members from Discord' }, 502, origin);
    const guildMembers = await guildRes.json();
    const guildIds = new Set(guildMembers.map(m => m.user && m.user.id).filter(Boolean));
    const members = await getMembers(env);
    const pruned = [];
    for (const [name, data] of Object.entries(members)) {
      if (name.startsWith('_')) continue;
      if (!data.discordId) continue;
      if (!guildIds.has(data.discordId)) {
        pruned.push(name);
        delete members[name];
      }
    }
    if (pruned.length) await saveMembers(env, members);
    return jsonResponse({ ok: true, pruned, count: pruned.length }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

// POST /claim - claim a slot (D1-based)
async function handleClaimSlot(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }

  const { sectionKey, roleIndex, memberName } = body;
  if (!sectionKey || roleIndex === undefined) return jsonResponse({ error: 'Missing required fields' }, 400, origin);

  let name = (memberName || '').trim();
  const roster = await getRoster(env);
  if (!roster) return jsonResponse({ error: 'Roster not available' }, 502, origin);

  const membersData = await getMembers(env);

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = await verifyToken(authHeader.substring(7), env.JWT_SECRET);
    if (payload) {
      const userResult = await env.DB.prepare(`SELECT id, username, global_name FROM users WHERE id = ?`
      ).bind(payload.sub).first();
      if (userResult) {
        const matchedName = findMemberName(membersData, userResult.id, userResult.global_name || userResult.username);
        if (matchedName) {
          name = matchedName;
        } else {
          const newName = userResult.global_name || userResult.username;
          name = await addMember(env, newName, userResult.id, userResult.global_name || userResult.username);
          if (!membersData[name]) {
            membersData[name] = { discordId: userResult.id, discordRank: '', avatar: '', opsAttended: 0, endorsements: [], leadership: null };
          }
        }
      }
    }
  }

  if (!name) return jsonResponse({ error: 'Missing member name' }, 400, origin);

  const existingSlot = findUserSlot(roster, name);
  if (existingSlot) {
    if (existingSlot.sectionKey === sectionKey && JSON.stringify(existingSlot.roleIndex) === JSON.stringify(roleIndex)) {
      return jsonResponse({ ok: true, message: `Already assigned to ${findSlot(roster, sectionKey, roleIndex)?.role || 'this role'}` }, 200, origin);
    }
    // Auto-reallocate: unassign from old slot
    const oldSlot = findSlot(roster, existingSlot.sectionKey, existingSlot.roleIndex);
    if (oldSlot) oldSlot.member = null;
  }

  let slot = null;
  try { slot = findSlot(roster, sectionKey, roleIndex); } catch (e) { return jsonResponse({ error: 'Invalid role index' }, 400, origin); }
  if (!slot) return jsonResponse({ error: 'Role not found - refresh and try again' }, 404, origin);
  if (slot.member) return jsonResponse({ error: `Already claimed by ${slot.member}` }, 409, origin);

  if (slot.endorsementRequired && slot.endorsementType) {
    const memberKey = Object.keys(membersData).find(k => k.toLowerCase() === name.toLowerCase());
    const member = memberKey ? membersData[memberKey] : null;
    if (!member) return jsonResponse({ error: `Access Denied: "${name}" is not a registered member.` }, 403, origin);
    if (slot.endorsementType === "Leadership Endorsement") {
      if (!member.leadership) return jsonResponse({ error: `Access Denied: "${name}" does not have a Leadership qualification.` }, 403, origin);
    } else {
      const requiredEndorsement = slot.endorsementType.replace(/ endorsement$/i,'').trim().toLowerCase();
      const hasEndorsement = member.endorsements && member.endorsements.some(e => e.toLowerCase().includes(requiredEndorsement));
      if (!hasEndorsement) return jsonResponse({ error: `Access Denied: "${name}" lacks the required "${requiredEndorsement}" certification.` }, 403, origin);
    }
  }

  slot.member = name;
  await saveRoster(env, roster);
  return jsonResponse({ ok: true, message: `${name} assigned to ${slot.role}` }, 200, origin);
}

// POST /api/admin/roster - admin save roster to D1
async function handleAdminSaveRoster(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonResponse({ error: 'Invalid token' }, 401, origin);

  const userResult = await env.DB.prepare(`SELECT is_admin FROM users WHERE id = ?`).bind(payload.sub).first();
  if (!userResult) return jsonResponse({ error: 'User not found' }, 404, origin);
  if (userResult.is_admin === 1 || ADMIN_IDS.includes(payload.sub)) { /* admin ok */ }
  else {
    const roleRows = await env.DB.prepare(`SELECT role_name FROM user_roles WHERE user_id = ?`).bind(payload.sub).all();
    const roleMap = await getCachedGuildRoles(env);
    const resolved = roleRows.results.map(r => r.role_name.startsWith('_id:') ? (roleMap[r.role_name.slice(4)] || r.role_name) : r.role_name);
    const hasAdminRole = resolved.some(r => /admin|staff/i.test(r));
    if (!hasAdminRole) return jsonResponse({ error: 'Access denied: Admin privileges required' }, 403, origin);
  }

  let newRoster;
  try { newRoster = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }

  await saveRoster(env, newRoster);
  return jsonResponse({ ok: true, message: 'Roster saved successfully' }, 200, origin);
}

// POST /api/unassign - self-unassign from a slot (D1-based)
async function handleUnassignSlot(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonResponse({ error: 'Invalid token' }, 401, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }

  const { sectionKey, roleIndex } = body;
  if (!sectionKey || roleIndex === undefined) return jsonResponse({ error: 'Missing required fields' }, 400, origin);

  const userResult = await env.DB.prepare(`SELECT id, username, global_name FROM users WHERE id = ?`
  ).bind(payload.sub).first();
  if (!userResult) return jsonResponse({ error: 'User not found' }, 404, origin);

  const roster = await getRoster(env);
  if (!roster) return jsonResponse({ error: 'Roster not available' }, 502, origin);

  const membersData = await getMembers(env);

  let slot = null;
  try { slot = findSlot(roster, sectionKey, roleIndex); } catch (e) { return jsonResponse({ error: 'Invalid role index' }, 400, origin); }
  if (!slot) return jsonResponse({ error: 'Role not found' }, 404, origin);
  if (!slot.member) return jsonResponse({ error: 'Slot is not claimed' }, 400, origin);

  let userName = findMemberName(membersData, userResult.id, userResult.global_name || userResult.username);
  if (!userName) {
    const newName = userResult.global_name || userResult.username;
    userName = await addMember(env, newName, userResult.id, userResult.global_name || userResult.username);
    membersData[userName] = { discordId: userResult.id, discordRank: 'Recruit', avatar: '', opsAttended: 0, endorsements: [], leadership: null };
  }
  if (!userName || slot.member.toLowerCase() !== userName.toLowerCase()) {
    return jsonResponse({ error: 'You can only unassign yourself from your own slots' }, 403, origin);
  }

  slot.member = null;
  await saveRoster(env, roster);
  return jsonResponse({ ok: true, message: `Unassigned from ${slot.role}` }, 200, origin);
}

// POST /api/admin/archive-op - Archive current op and clear slots
async function handleArchiveOp(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);

  const roster = await getRoster(env);
  if (!roster) return jsonResponse({ error: 'No roster to archive' }, 404, origin);

  const op = roster.operation || {};
  const timestamp = Math.floor(Date.now() / 1000);
  const archiveEntry = {
    id: timestamp,
    name: op.name || 'Unknown Operation',
    date: op.date || '',
    zeus: op.zeus || '',
    archivedAt: new Date().toISOString(),
    roster: JSON.parse(JSON.stringify(roster))
  };

  // Get existing archive
  let ops = [];
  const existing = await env.DB.prepare(`SELECT data FROM members WHERE name = '_previous_ops'`).first();
  if (existing) ops = JSON.parse(existing.data);
  ops.push(archiveEntry);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_previous_ops', ?, ?)`).bind(JSON.stringify(ops), now).run();

  // Clear all slot assignments
  for (const s of roster.sections || []) {
    for (const r of s.roles || []) r.member = null;
  }
  for (const r of roster.command || []) r.member = null;
  for (const a of roster.attachments || []) {
    for (const r of a.roles || []) r.member = null;
  }
  roster.operation = roster.operation || {};
  roster.operation.status = 'upcoming';
  roster.operation.name = 'Next Operation';
  await saveRoster(env, roster);

  return jsonResponse({ ok: true, message: `Archived "${archiveEntry.name}" and cleared assignments` }, 200, origin);
}

// POST /api/admin/clear-assignments - Clear all slot assignments
async function handleClearAssignments(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);

  const roster = await getRoster(env);
  if (!roster) return jsonResponse({ error: 'Roster not found' }, 404, origin);

  for (const s of roster.sections || []) {
    for (const r of s.roles || []) r.member = null;
  }
  for (const r of roster.command || []) r.member = null;
  for (const a of roster.attachments || []) {
    for (const r of a.roles || []) r.member = null;
  }
  await saveRoster(env, roster);
  return jsonResponse({ ok: true, message: 'All slot assignments cleared' }, 200, origin);
}

// POST /api/admin/save-members - Update member data
async function handleAdminSaveMembers(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);

  let newData;
  try { newData = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }
  if (!newData || typeof newData !== 'object') return jsonResponse({ error: 'Invalid data' }, 400, origin);

  await saveMembers(env, newData);
  return jsonResponse({ ok: true, message: 'Members saved' }, 200, origin);
}

// GET /api/previous-ops - Get archived operations
async function handleGetPreviousOps(request, env, origin) {
  const existing = await env.DB.prepare(`SELECT data FROM members WHERE name = '_previous_ops'`).first();
  const ops = existing ? JSON.parse(existing.data) : [];
  return jsonResponse(ops, 200, origin);
}

// POST /api/admin/delete-archive - Delete an archived operation
async function handleDeleteArchive(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, origin); }
  if (typeof body.index !== 'number') return jsonResponse({ error: 'Invalid index' }, 400, origin);

  const existing = await env.DB.prepare(`SELECT data FROM members WHERE name = '_previous_ops'`).first();
  let ops = existing ? JSON.parse(existing.data) : [];
  if (body.index < 0 || body.index >= ops.length) return jsonResponse({ error: 'Index out of range' }, 400, origin);
  
  ops.splice(body.index, 1);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT OR REPLACE INTO members (name, data, updated_at) VALUES ('_previous_ops', ?, ?)`).bind(JSON.stringify(ops), now).run();
  return jsonResponse({ ok: true, message: 'Archived operation deleted' }, 200, origin);
}

// Helper: verify admin from request
async function verifyAdmin(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return null;
  const userResult = await env.DB.prepare(`SELECT is_admin FROM users WHERE id = ?`).bind(payload.sub).first();
  if (!userResult) return null;
  if (userResult.is_admin === 1 || ADMIN_IDS.includes(payload.sub)) return payload;
  const roleRows = await env.DB.prepare(`SELECT role_name FROM user_roles WHERE user_id = ?`).bind(payload.sub).all();
  const roleMap = await getCachedGuildRoles(env);
  const resolved = roleRows.results.map(r => r.role_name.startsWith('_id:') ? (roleMap[r.role_name.slice(4)] || r.role_name) : r.role_name);
  if (resolved.some(r => /admin|staff/i.test(r))) return payload;
  return null;
}

async function handleDiscordStats(request, env, origin) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
    return jsonResponse({ error: 'Discord not configured' }, 500, origin);
  }
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
    const guild = await res.json();
    return jsonResponse({ memberCount: guild.approximate_member_count || guild.member_count || 0 }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleSyncFromGitHub(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  const results = [];
  try {
    const rosterRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/roster.json`);
    if (rosterRes.ok) {
      await saveRoster(env, await rosterRes.json());
      results.push('roster');
    }
  } catch (e) { results.push('roster: ' + e.message); }
  try {
    const membersRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`);
    if (membersRes.ok) {
      const gitMembers = await membersRes.json();
      // Merge: keep any D1-only members (e.g. Discord-added) that aren't in GitHub
      const existing = await getMembers(env);
      for (const [name, data] of Object.entries(existing)) {
        if (name.startsWith('_')) continue;
        if (!gitMembers[name]) {
          gitMembers[name] = data;
        }
      }
      await saveMembers(env, gitMembers);
      results.push('members');
    }
  } catch (e) { results.push('members: ' + e.message); }
  return jsonResponse({ ok: true, message: 'Synced from GitHub: ' + results.join(', ') }, 200, origin);
}

async function handleAutoSync(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
  if (!token || token !== env.API_SYNC_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  const results = [];
  try {
    const rosterRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/roster.json`);
    if (rosterRes.ok) {
      await saveRoster(env, await rosterRes.json());
      results.push('roster');
    }
  } catch (e) { results.push('roster: ' + e.message); }
  try {
    const membersRes = await fetch(`https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`);
    if (membersRes.ok) {
      const gitMembers = await membersRes.json();
      const existing = await getMembers(env);
      for (const [name, data] of Object.entries(existing)) {
        if (name.startsWith('_')) continue;
        if (!gitMembers[name]) {
          gitMembers[name] = data;
        }
      }
      await saveMembers(env, gitMembers);
      results.push('members');
    }
  } catch (e) { results.push('members: ' + e.message); }
  return jsonResponse({ ok: true, message: 'Auto-synced from GitHub: ' + results.join(', ') }, 200, origin);
}

async function handleRestoreSnapshot(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const row = await env.DB.prepare(`SELECT data FROM members WHERE name = '_roster_snapshot'`).first();
    if (!row) return jsonResponse({ error: 'No backup snapshot found' }, 404, origin);
    const data = JSON.parse(row.data);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`INSERT OR REPLACE INTO roster (id, data, updated_at) VALUES (1, ?, ?)`).bind(JSON.stringify(data), now).run();
    return jsonResponse({ ok: true, message: 'Restored from last snapshot' }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleListGallery(request, env, origin) {
  try {
    const rows = await env.DB.prepare(`SELECT id, op_name, filename, uploaded_by, uploaded_by_name, uploaded_at FROM gallery_images ORDER BY uploaded_at DESC`).all();
    return jsonResponse(rows.results || [], 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleGalleryUpload(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const form = await request.formData();
    const file = form.get('file');
    const opName = form.get('opName') || 'Unknown';
    if (!file || !file.name) return jsonResponse({ error: 'No file provided' }, 400, origin);
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['jpg','jpeg','png','gif','webp'];
    if (!allowed.includes(ext)) return jsonResponse({ error: 'Invalid file type. Allowed: ' + allowed.join(', ') }, 400, origin);
    // Hard cap at 9 GB to stay within free tier
    const maxBytes = 9 * 1024 * 1024 * 1024;
    const sizeRow = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM gallery_images').first();
    const currentTotal = sizeRow ? Number(sizeRow.total) : 0;
    if (currentTotal + file.size > maxBytes) {
      return jsonResponse({ error: 'Storage limit reached (9 GB). Delete existing images before uploading more.' }, 413, origin);
    }
    const id = crypto.randomUUID();
    const slug = opName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    const r2Key = 'gallery/' + slug + '/' + id + '.' + ext;
    const buffer = await file.arrayBuffer();
    await env.GALLERY.put(r2Key, buffer, { httpMetadata: { contentType: file.type || 'image/jpeg' } });
    const now = Math.floor(Date.now() / 1000);
    const username = auth.username || 'staff';
    await env.DB.prepare('INSERT INTO gallery_images (id, op_name, filename, r2_key, content_type, size, uploaded_by, uploaded_by_name, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, opName, file.name, r2Key, file.type || 'image/jpeg', file.size, auth.sub, username, now).run();
    return jsonResponse({ ok: true, id, opName, filename: file.name }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleUploadBanner(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || !file.name) return jsonResponse({ error: 'No file provided' }, 400, origin);
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jpg','jpeg','png','gif','webp'].includes(ext)) return jsonResponse({ error: 'Invalid file type' }, 400, origin);
    const id = crypto.randomUUID();
    const r2Key = 'banners/' + id + '.' + ext;
    const buffer = await file.arrayBuffer();
    await env.GALLERY.put(r2Key, buffer, { httpMetadata: { contentType: file.type || 'image/jpeg' } });
    const url = `https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/api/banner-image/${id}.${ext}`;
    return jsonResponse({ ok: true, url, r2Key }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleGalleryImage(request, env, origin) {
  try {
    const id = request.url.split('/').pop();
    const row = await env.DB.prepare('SELECT r2_key, content_type FROM gallery_images WHERE id = ?').bind(id).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404, origin);
    const obj = await env.GALLERY.get(row.r2_key);
    if (!obj) return jsonResponse({ error: 'Image not found in storage' }, 404, origin);
    const headers = { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=86400', ...corsHeaders(origin) };
    return new Response(obj.body, { headers });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleGalleryDelete(request, env, origin) {
  const auth = await verifyAdmin(request, env);
  if (!auth) return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  try {
    const id = request.url.split('/').pop();
    const row = await env.DB.prepare('SELECT r2_key FROM gallery_images WHERE id = ?').bind(id).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404, origin);
    await env.GALLERY.delete(row.r2_key);
    await env.DB.prepare('DELETE FROM gallery_images WHERE id = ?').bind(id).run();
    return jsonResponse({ ok: true }, 200, origin);
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}

async function handleBannerImage(request, env, origin) {
  try {
    const id = request.url.split('/').pop();
    const r2Key = 'banners/' + id;
    const obj = await env.GALLERY.get(r2Key);
    if (!obj) return jsonResponse({ error: 'Not found' }, 404, origin);
    const ct = obj.httpMetadata?.contentType || 'image/jpeg';
    const headers = { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', ...corsHeaders(origin) };
    return new Response(obj.body, { headers });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500, origin);
  }
}
