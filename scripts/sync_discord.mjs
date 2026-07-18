#!/usr/bin/env node
/* Sync AZO members' Discord roles -> endorsements / leadership, and pull their
   profile pictures into assets/avatars/. Runs in GitHub Actions (Node 20+),
   zero npm dependencies (uses global fetch/Buffer).

   Reads:  discord_config.json, members.json
   Writes: members.json  (only endorsements / leadership / avatar of MATCHED members)
           assets/avatars/<name>.<ext>
   Never touches discordRank / opsAttended / attendance — those stay chart-managed. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const API   = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const norm  = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!TOKEN) { console.log('• DISCORD_BOT_TOKEN secret not set — skipping sync (add it to enable).'); process.exit(0); }

const config = JSON.parse(readFileSync('discord_config.json', 'utf8'));
const GUILD  = process.env.DISCORD_GUILD_ID || config.guildId;
if (!GUILD || /PUT-YOUR|YOUR-SERVER/i.test(String(GUILD))) {
  console.log('• guildId not set in discord_config.json — skipping sync.'); process.exit(0);
}

async function dapi(path) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(API + path, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (r.status === 429) { const j = await r.json().catch(() => ({ retry_after: 2 })); await sleep((j.retry_after || 2) * 1000 + 250); continue; }
    if (!r.ok) { const body = await r.text(); const err = new Error(`${path} -> ${r.status} ${body}`); err.status = r.status; throw err; }
    return r.json();
  }
  throw new Error(`${path} -> rate-limited repeatedly`);
}

async function run() {
  // 1) role id -> name
  const roles = await dapi(`/guilds/${GUILD}/roles`);
  const roleName = Object.fromEntries(roles.map(r => [r.id, r.name]));

  // 2) every guild member (paginated). Requires the "Server Members Intent".
  let all = [], after = '0';
  while (true) {
    const batch = await dapi(`/guilds/${GUILD}/members?limit=1000&after=${after}`);
    all = all.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  console.log(`Connected OK — ${all.length} members, ${roles.length} roles.`);

  const displayOf = m => m.nick || m.user.global_name || m.user.username;
  const byId = new Map(all.map(m => [m.user.id, m]));

  function findDiscordMember(name, data) {
    if (data.discordId && byId.has(data.discordId)) return byId.get(data.discordId);
    const n = norm(name);
    const exact = all.find(m => norm(displayOf(m)) === n);
    if (exact) return exact;
    if (n.length >= 4) {
      const subs = all.filter(m => norm(displayOf(m)).includes(n));
      if (subs.length === 1) return subs[0];   // unique match only — never guess
    }
    return null;
  }

  const endorsementRoles = config.endorsementRoles || [];
  const seniorRoles = new Set(config.leadershipRoles?.senior || []);
  const juniorRoles = new Set(config.leadershipRoles?.junior || []);

  const members = JSON.parse(readFileSync('members.json', 'utf8'));
  mkdirSync('assets/avatars', { recursive: true });

  let matched = 0, avatars = 0; const unmatched = [];
  for (const [name, data] of Object.entries(members)) {
    if (name === '_comment' || typeof data !== 'object' || data === null) continue;
    const dm = findDiscordMember(name, data);
    if (!dm) { unmatched.push(name); continue; }
    matched++;
    const have = new Set(dm.roles.map(id => roleName[id]).filter(Boolean));

    // endorsements = configured roles this member has, with " Endorsement" stripped for display
    data.endorsements = endorsementRoles.filter(r => have.has(r)).map(r => r.replace(/\s*Endorsement$/i, '').trim());
    data.leadership = [...have].some(r => seniorRoles.has(r)) ? 'senior'
                    : [...have].some(r => juniorRoles.has(r)) ? 'junior' : null;

    const u = dm.user;
    if (u.avatar) {
      try {
        const ext = u.avatar.startsWith('a_') ? 'gif' : 'png';
        const res = await fetch(`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=256`);
        if (res.ok) {
          const file = `assets/avatars/${norm(name)}.${ext}`;
          writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          data.avatar = '/' + file;
          avatars++;
        }
      } catch (e) { console.log(`  ! avatar failed for ${name}: ${e.message}`); }
    }
  }

  writeFileSync('members.json', JSON.stringify(members, null, 2) + '\n');
  console.log(`\nMatched ${matched} members; downloaded ${avatars} avatars.`);
  if (unmatched.length) console.log(`Unmatched (add a "discordId" or fix the name in members.json): ${unmatched.join(', ')}`);
}

run().catch(e => {
  console.error('\n✖ Discord sync failed: ' + e.message);
  const s = e.status;
  if (s === 401) console.error('  → Token is missing or invalid. Reset it on the Bot page and update the DISCORD_BOT_TOKEN secret.');
  else if (s === 403) console.error('  → Almost certainly the "Server Members Intent" is OFF. Developer Portal → your app → Bot → Privileged Gateway Intents → enable "Server Members Intent" → Save, then re-run. (Also confirm the bot was actually added to the server.)');
  else if (s === 404) console.error('  → Guild not found. Check guildId in discord_config.json and that the bot is in that server.');
  process.exit(1);
});
