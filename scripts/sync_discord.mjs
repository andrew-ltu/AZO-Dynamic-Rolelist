#!/usr/bin/env node
/* Sync AZO members' Discord roles -> endorsements / leadership, and pull their
   profile pictures into assets/avatars/. Runs in GitHub Actions (Node 20+),
   zero npm dependencies (uses global fetch/Buffer).

   Reads:  discord_config.json, members.json
   Writes: members.json  (only endorsements / leadership / avatar of MATCHED members)
           assets/avatars/<name>.<ext>

   Never touches discordRank / opsAttended / attendance — those stay chart-managed.
   Matching: members.json key -> Discord member by (1) "discordId" if present,
   (2) exact display-name, (3) unique substring (handles "RANK Name" nicknames).
   Unmatched names are listed in the log so you can add a "discordId". */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const API   = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!TOKEN) { console.log('• DISCORD_BOT_TOKEN secret not set — skipping sync (add it to enable).'); process.exit(0); }

const config = JSON.parse(readFileSync('discord_config.json', 'utf8'));
const GUILD  = process.env.DISCORD_GUILD_ID || config.guildId;
if (!GUILD || /PUT-YOUR|YOUR-SERVER/i.test(String(GUILD))) {
  console.log('• guildId not set in discord_config.json — skipping sync.'); process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dapi(path) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(API + path, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (r.status === 429) { const j = await r.json().catch(() => ({ retry_after: 2 })); await sleep((j.retry_after || 2) * 1000 + 250); continue; }
    if (!r.ok) throw new Error(`Discord ${path} -> ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error(`Discord ${path} -> rate-limited repeatedly`);
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
console.log(`Fetched ${all.length} Discord members, ${roles.length} roles.`);

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

  // endorsements = the configured roles this member actually has (config order),
  // with the redundant " Endorsement" suffix stripped for display ("Medical Endorsement" -> "Medical")
  data.endorsements = endorsementRoles.filter(r => have.has(r)).map(r => r.replace(/\s*Endorsement$/i, '').trim());
  // leadership from the configured leadership roles
  data.leadership = [...have].some(r => seniorRoles.has(r)) ? 'senior'
                  : [...have].some(r => juniorRoles.has(r)) ? 'junior' : null;

  // avatar
  const u = dm.user;
  if (u.avatar) {
    try {
      const ext = u.avatar.startsWith('a_') ? 'gif' : 'png';
      const res = await fetch(`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=256`);
      if (res.ok) {
        const file = `assets/avatars/${norm(name)}.${ext}`;
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        data.avatar = file;
        avatars++;
      }
    } catch (e) { console.log(`  ! avatar failed for ${name}: ${e.message}`); }
  }
}

writeFileSync('members.json', JSON.stringify(members, null, 2) + '\n');
console.log(`\nMatched ${matched} members; downloaded ${avatars} avatars.`);
if (unmatched.length) console.log(`Unmatched (add a "discordId" or fix the name in members.json): ${unmatched.join(', ')}`);
