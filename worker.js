// AZO Dynamic Rolelist - Enhanced Worker with Discord OAuth
// Cloudflare Worker with D1 Database

const GITHUB_OWNER = 'andrew-ltu';
const GITHUB_REPO = 'AZO-Dynamic-Rolelist';
const ALLOWED_ORIGINS = [
  'https://andrew-ltu.github.io',
  'https://azo-dynamic-rolelist.pages.dev',
  'http://localhost:8770'
];

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GUILD_ID = '504188370507792384';
const REDIRECT_URI = 'https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback';
const ADMIN_IDS = ['203678139220623361', '207012290401271818', '850370739998818335'];

// Helper: CORS headers
function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// Helper: JSON response
function jsonResponse(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin)
    }
  });
}

// Helper: Generate JWT token
async function generateToken(userId, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
  };
  
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const message = `${encodedHeader}.${encodedPayload}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  return `${message}.${encodedSignature}`;
}

// Helper: Verify JWT token
async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [encodedHeader, encodedPayload, signature] = parts;
    const message = `${encodedHeader}.${encodedPayload}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(message)
    );
    
    if (!valid) return null;
    
    const payload = JSON.parse(atob(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    
    return payload;
  } catch (e) {
    return null;
  }
}

// Main router
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    
    // Route: Discord OAuth login
    if (url.pathname === '/auth/login') {
      return handleLogin(env);
    }
    
    // Route: Discord OAuth callback
    if (url.pathname === '/auth/callback') {
      return handleCallback(request, env);
    }
    
    // Route: Get current user
    if (url.pathname === '/api/user') {
      return handleGetUser(request, env, origin);
    }
    
    // Route: Logout
    if (url.pathname === '/api/logout') {
      return handleLogout(request, env, origin);
    }
    
    // Route: Claim slot (existing functionality)
    if (url.pathname === '/claim' && request.method === 'POST') {
      return handleClaimSlot(request, env, origin);
    }
    
    // Route: Admin - Save roster (NEW)
    if (url.pathname === '/api/admin/roster' && request.method === 'POST') {
      return handleAdminSaveRoster(request, env, origin);
    }
    
    // Route: Self-unassign from a role
    if (url.pathname === '/api/unassign' && request.method === 'POST') {
      return handleUnassignSlot(request, env, origin);
    }
    
    return jsonResponse({ error: 'Not found' }, 404, origin);
  }
};

// Handler: Discord login - redirect to Discord OAuth
async function handleLogin(env) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email guilds.members.read'
  });
  
  return Response.redirect(`${DISCORD_API}/oauth2/authorize?${params}`, 302);
}

// Handler: Discord OAuth callback
async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }
  
  try {
    // Exchange code for access token
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
    
    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }
    
    const tokenData = await tokenResponse.json();
    
    // Get user info from Discord
    const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    
    if (!userResponse.ok) {
      throw new Error('Failed to fetch user info');
    }
    
    const user = await userResponse.json();
    
    // Store user in database
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      INSERT INTO users (id, username, discriminator, global_name, avatar, email, created_at, last_login, is_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        global_name = excluded.global_name,
        avatar = excluded.avatar,
        email = excluded.email,
        last_login = excluded.last_login
    `    ).bind(
      user.id,
      user.username,
      user.discriminator || '',
      user.global_name || user.username,
      user.avatar || '',
      user.email || '',
      now,
      now,
      ADMIN_IDS.includes(user.id) ? 1 : 0
    ).run();
    
    // Fetch guild member info to get Discord roles
    let roleNames = [];
    try {
      const memberResponse = await fetch(
        `${DISCORD_API}/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      if (memberResponse.ok) {
        const memberData = await memberResponse.json();
        const roleIds = memberData.roles || [];
        
        // Fetch guild roles to map IDs to names
        let guildRoles = [];
        if (env.DISCORD_BOT_TOKEN) {
          const rolesResponse = await fetch(
            `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/roles`,
            { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
          );
          if (rolesResponse.ok) guildRoles = await rolesResponse.json();
        }
        if (!guildRoles.length) {
          // Fall back to OAuth token
          try {
            const fallbackResp = await fetch(
              `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/roles`,
              { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
            );
            if (fallbackResp.ok) guildRoles = await fallbackResp.json();
          } catch (_) {}
        }
        
        const roleMap = {};
        guildRoles.forEach(r => { roleMap[r.id] = r.name; });
        roleNames = roleIds.map(id => roleMap[id]).filter(Boolean);
        
        // Update user_roles in database
        await env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(user.id).run();
        const stmt = `INSERT INTO user_roles (user_id, role_name, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`;
        for (const roleName of roleNames) {
          await env.DB.prepare(stmt).bind(user.id, roleName, now, 'discord-sync').run();
        }
      }
    } catch (e) {
      console.error('Failed to sync Discord roles:', e);
    }
    
    // Generate JWT token
    const jwtToken = await generateToken(user.id, env.JWT_SECRET);
    
    // Create session in database
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(
      jwtToken,
      user.id,
      now,
      now + (30 * 24 * 60 * 60) // 30 days
    ).run();
    
    // Redirect to main roster page with token
    const redirectUrl = `https://andrew-ltu.github.io/AZO-Dynamic-Rolelist/?token=${jwtToken}`;
    return Response.redirect(redirectUrl, 302);
    
  } catch (error) {
    return new Response(`Authentication failed: ${error.message}`, { status: 500 });
  }
}

// Handler: Get current user
async function handleGetUser(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  
  if (!payload) {
    return jsonResponse({ error: 'Invalid token' }, 401, origin);
  }
  
  // Get user from database
  const userResult = await env.DB.prepare(`
    SELECT id, username, global_name, avatar, email, is_admin
    FROM users WHERE id = ?
  `).bind(payload.sub).first();
  
  if (!userResult) {
    return jsonResponse({ error: 'User not found' }, 404, origin);
  }
  
  // Get user roles
  const rolesResult = await env.DB.prepare(`
    SELECT role_name FROM user_roles WHERE user_id = ?
  `).bind(payload.sub).all();
  
  const roles = rolesResult.results.map(r => r.role_name);
  
  // Try to find roster name from members.json by Discord ID or display name
  let rosterName = null;
  try {
    const baseRepoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
    const headers = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'AZO-Worker'
    };
    
    const membersRes = await fetch(`${baseRepoUrl}/members.json`, { headers });
    if (membersRes.ok) {
      const membersMeta = await membersRes.json();
      const membersData = JSON.parse(atob(membersMeta.content.replace(/\n/g, '')));
      
      // Find member by Discord ID
      for (const [name, data] of Object.entries(membersData)) {
        if (data.discordId === userResult.id) {
          rosterName = name;
          break;
        }
      }
      // Fallback: match by display name (case-insensitive)
      if (!rosterName) {
        const displayName = (userResult.global_name || userResult.username || '').toLowerCase();
        for (const [name] of Object.entries(membersData)) {
          if (name.toLowerCase() === displayName) {
            rosterName = name;
            break;
          }
        }
      }
    }
  } catch (e) {
    // If fetching members.json fails, just continue without roster name
    console.error('Failed to fetch roster name:', e);
  }
  
  // On-demand role sync if DB has no roles and bot token is available
  if (!roles.length && env.DISCORD_BOT_TOKEN) {
    try {
      const memberResp = await fetch(
        `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${userResult.id}`,
        { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
      );
      if (memberResp.ok) {
        const memberData = await memberResp.json();
        const roleIds = memberData.roles || [];
        const rolesResp = await fetch(
          `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/roles`,
          { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
        );
        const guildRoles = rolesResp.ok ? await rolesResp.json() : [];
        const roleMap = {};
        guildRoles.forEach(r => { roleMap[r.id] = r.name; });
        const fetchedRoles = roleIds.map(id => roleMap[id]).filter(Boolean);
        if (fetchedRoles.length) {
          const now = Math.floor(Date.now() / 1000);
          await env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(userResult.id).run();
          const stmt = `INSERT INTO user_roles (user_id, role_name, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`;
          for (const roleName of fetchedRoles) {
            await env.DB.prepare(stmt).bind(userResult.id, roleName, now, 'discord-sync').run();
          }
          roles.push(...fetchedRoles);
        }
      }
    } catch (e) {
      console.error('On-demand role sync failed:', e);
    }
  }
  
  return jsonResponse({
    user: {
      id: userResult.id,
      username: userResult.username,
      displayName: userResult.global_name,
      avatar: userResult.avatar,
      email: userResult.email,
      isAdmin: userResult.is_admin === 1 || ADMIN_IDS.includes(userResult.id),
      roles,
      rosterName
    }
  }, 200, origin);
}

// Handler: Logout
async function handleLogout(request, env, origin) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // Delete session from database
    await env.DB.prepare(`
      DELETE FROM sessions WHERE id = ?
    `).bind(token).run();
  }
  
  return jsonResponse({ ok: true }, 200, origin);
}

// Handler: Claim slot (existing functionality preserved)
async function handleClaimSlot(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
  }

  const { sectionKey, roleIndex, memberName } = body;
  if (!sectionKey || roleIndex === undefined) {
    return jsonResponse({ error: 'Missing required fields' }, 400, origin);
  }

  let name = (memberName || '').trim();

  const baseRepoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'AZO-Claim-Worker'
  };

  // Fetch current roster AND members directory
  const [rosterRes, membersRes] = await Promise.all([
    fetch(`${baseRepoUrl}/roster.json`, { headers }),
    fetch(`${baseRepoUrl}/members.json`, { headers })
  ]);

  if (!rosterRes.ok) {
    return jsonResponse({ error: `GitHub roster fetch failed: ${rosterRes.status}` }, 502, origin);
  }
  if (!membersRes.ok) {
    return jsonResponse({ error: `GitHub members fetch failed: ${membersRes.status}` }, 502, origin);
  }

  const rosterMeta = await rosterRes.json();
  const membersMeta = await membersRes.json();

  const sha = rosterMeta.sha;
  const roster = JSON.parse(atob(rosterMeta.content.replace(/\n/g, '')));
  const membersData = JSON.parse(atob(membersMeta.content.replace(/\n/g, '')));

  // If user sent a valid JWT, resolve their roster name by Discord ID or display name
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = await verifyToken(authHeader.substring(7), env.JWT_SECRET);
    if (payload) {
      const userResult = await env.DB.prepare(`
        SELECT id, username, global_name FROM users WHERE id = ?
      `).bind(payload.sub).first();
      if (userResult) {
        let matchedName = null;
        // Try by Discord ID
        for (const [n, d] of Object.entries(membersData)) {
          if (d.discordId === userResult.id) { matchedName = n; break; }
        }
        // Fallback by display name (case-insensitive)
        if (!matchedName) {
          const display = (userResult.global_name || userResult.username || '').toLowerCase();
          for (const [n] of Object.entries(membersData)) {
            if (n.toLowerCase() === display) { matchedName = n; break; }
          }
        }
        if (matchedName) name = matchedName;
      }
    }
  }

  if (!name) {
    return jsonResponse({ error: 'Missing member name' }, 400, origin);
  }

  // Find the slot
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
    return jsonResponse({ error: 'Invalid role index' }, 400, origin);
  }

  if (!slot) return jsonResponse({ error: 'Role not found — refresh and try again' }, 404, origin);
  if (slot.member) return jsonResponse({ error: `Already claimed by ${slot.member}` }, 409, origin);

  // Validation: Check if user is certified for this slot
  if (slot.endorsementRequired && slot.endorsementType) {
    const memberKey = Object.keys(membersData).find(k => k.toLowerCase() === name.toLowerCase());
    const member = memberKey ? membersData[memberKey] : null;

    if (!member) {
      return jsonResponse({ error: `Access Denied: "${name}" is not a registered member in the directory.` }, 403, origin);
    }

    if (slot.endorsementType === "Leadership Endorsement") {
      if (!member.leadership) {
        return jsonResponse({ error: `Access Denied: "${name}" does not have a Leadership qualification.` }, 403, origin);
      }
    } else {
      const requiredEndorsement = slot.endorsementType.replace(" Endorsement", "");
      const hasEndorsement = member.endorsements && member.endorsements.some(
        e => e.toLowerCase() === requiredEndorsement.toLowerCase()
      );

      if (!hasEndorsement) {
        return jsonResponse({ error: `Access Denied: "${name}" lacks the required "${requiredEndorsement}" certification.` }, 403, origin);
      }
    }
  }

  // Assign and write back
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
    return jsonResponse({ error: err.message || `GitHub write failed: ${putRes.status}` }, 502, origin);
  }

  return jsonResponse({ ok: true, message: `${name} assigned to ${slot.role}` }, 200, origin);
}

// Handler: Admin - Save entire roster
async function handleAdminSaveRoster(request, env, origin) {
  // Verify admin authentication
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  
  if (!payload) {
    return jsonResponse({ error: 'Invalid token' }, 401, origin);
  }
  
  // Check if user is admin
  const userResult = await env.DB.prepare(`
    SELECT is_admin FROM users WHERE id = ?
  `).bind(payload.sub).first();
  
  if (!userResult || (userResult.is_admin !== 1 && !ADMIN_IDS.includes(payload.sub))) {
    return jsonResponse({ error: 'Access denied: Admin privileges required' }, 403, origin);
  }
  
  // Get new roster data
  let newRoster;
  try {
    newRoster = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
  }
  
  // Save to GitHub
  const baseRepoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'AZO-Admin-Worker'
  };
  
  // Fetch current roster to get SHA
  const rosterRes = await fetch(`${baseRepoUrl}/roster.json`, { headers });
  
  if (!rosterRes.ok) {
    return jsonResponse({ error: `GitHub roster fetch failed: ${rosterRes.status}` }, 502, origin);
  }
  
  const rosterMeta = await rosterRes.json();
  const sha = rosterMeta.sha;
  
  // Write updated roster
  const putRes = await fetch(`${baseRepoUrl}/roster.json`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Admin: Update roster structure',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(newRoster, null, 2)))),
      sha
    })
  });
  
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    return jsonResponse({ error: err.message || `GitHub write failed: ${putRes.status}` }, 502, origin);
  }
  
  return jsonResponse({ ok: true, message: 'Roster saved successfully' }, 200, origin);
}

// Handler: Self-unassign from a role
async function handleUnassignSlot(request, env, origin) {
  // Verify authentication
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }
  const token = authHeader.substring(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonResponse({ error: 'Invalid token' }, 401, origin);

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
  }

  const { sectionKey, roleIndex } = body;
  if (!sectionKey || roleIndex === undefined) {
    return jsonResponse({ error: 'Missing required fields' }, 400, origin);
  }

  // Get user info
  const userResult = await env.DB.prepare(
    `SELECT id, username, global_name FROM users WHERE id = ?`
  ).bind(payload.sub).first();
  if (!userResult) return jsonResponse({ error: 'User not found' }, 404, origin);

  // Fetch roster and members
  const baseRepoUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
  const ghHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'AZO-Unassign-Worker'
  };

  const [rosterRes, membersRes] = await Promise.all([
    fetch(`${baseRepoUrl}/roster.json`, { headers: ghHeaders }),
    fetch(`${baseRepoUrl}/members.json`, { headers: ghHeaders })
  ]);
  if (!rosterRes.ok) return jsonResponse({ error: 'Roster fetch failed' }, 502, origin);
  if (!membersRes.ok) return jsonResponse({ error: 'Members fetch failed' }, 502, origin);

  const rosterMeta = await rosterRes.json();
  const membersMeta = await membersRes.json();
  const sha = rosterMeta.sha;
  const roster = JSON.parse(atob(rosterMeta.content.replace(/\n/g, '')));
  const membersData = JSON.parse(atob(membersMeta.content.replace(/\n/g, '')));

  // Find the slot
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
    return jsonResponse({ error: 'Invalid role index' }, 400, origin);
  }

  if (!slot) return jsonResponse({ error: 'Role not found' }, 404, origin);
  if (!slot.member) return jsonResponse({ error: 'Slot is not claimed' }, 400, origin);

  // Resolve user's roster name
  let userName = null;
  for (const [n, d] of Object.entries(membersData)) {
    if (d.discordId === userResult.id) { userName = n; break; }
  }
  if (!userName) {
    const display = (userResult.global_name || userResult.username || '').toLowerCase();
    for (const [n] of Object.entries(membersData)) {
      if (n.toLowerCase() === display) { userName = n; break; }
    }
  }

  // Verify the slot belongs to this user
  if (!userName || slot.member.toLowerCase() !== userName.toLowerCase()) {
    return jsonResponse({ error: 'You can only unassign yourself from your own slots' }, 403, origin);
  }

  // Clear the slot
  slot.member = null;
  const putRes = await fetch(`${baseRepoUrl}/roster.json`, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Unassign: ${userName} left ${slot.role}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(roster, null, 2)))),
      sha
    })
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    return jsonResponse({ error: err.message || `GitHub write failed: ${putRes.status}` }, 502, origin);
  }

  return jsonResponse({ ok: true, message: `Unassigned from ${slot.role}` }, 200, origin);
}
