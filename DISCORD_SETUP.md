# Discord sync — setup (one-time, ~10 min)

This makes a GitHub Action read everyone's **Discord roles → endorsements/leadership**
and pull their **profile pictures** into `assets/avatars/`, updating `members.json`
automatically (daily, or on demand). It never touches rank / ops / attendance.

You need **Manage Server** permission on the AZO Discord (if you don't have it, ask an admin
to do Part B and send you the bot invite).

---

## Part A — Create the bot

1. Go to <https://discord.com/developers/applications> → **New Application** → name it
   `AZO Roster Sync` → Create.
2. Left sidebar → **Bot**.
3. Under **Privileged Gateway Intents**, turn ON **Server Members Intent** → **Save Changes**.
   *(This is required — without it the sync can't read the member list. Presence and Message
   intents are NOT needed.)*
4. Click **Reset Token** → **Copy** the token. Treat it like a password — don't paste it in chat
   or commit it anywhere. (You'll paste it into GitHub in Part D.)

## Part B — Add the bot to the AZO server

5. Left sidebar → **OAuth2** → **URL Generator**.
6. Under **Scopes**, tick **`bot`**. (No bot permissions are needed for reading members — you can
   leave them all unchecked.)
7. Copy the **Generated URL** at the bottom, open it in your browser, choose the **AZO server**,
   and click **Authorize**.

## Part C — Get the Server (Guild) ID

8. In Discord: **User Settings → Advanced → Developer Mode** = ON.
9. Right-click the **AZO server icon** → **Copy Server ID**.
10. Open **`discord_config.json`** in the repo and paste it as `guildId`
    (replace `PUT-YOUR-DISCORD-SERVER-ID-HERE`).

## Part D — Store the bot token as a GitHub secret

11. Repo → **Settings → Secrets and variables → Actions → New repository secret**.
12. **Name:** `DISCORD_BOT_TOKEN`  **Value:** paste the bot token → **Add secret**.
    *(The token lives only here, encrypted — never in the code.)*

## Part E — Tell the sync which roles mean what

13. In **`discord_config.json`**, replace the example role names with your real ones:
    - `endorsementRoles`: every role name that should show as an **endorsement**
      (e.g. quals/badges — exactly as spelled in Discord, case-sensitive).
    - `leadershipRoles.senior` / `.junior`: the role name(s) that mean
      **Senior / Junior Leadership**.

## Part F — Run it

14. Repo → **Actions** tab → **Sync Discord roles & avatars** → **Run workflow**.
    It will fetch roles + avatars, commit an updated `members.json` and `assets/avatars/`,
    and from then on run **daily** automatically.

---

## How matching works

The sync links each entry in `members.json` to a Discord member by:
1. a `"discordId"` field on that entry, if present (most reliable), else
2. exact display-name, else
3. a unique partial-name match (handles `RANK Name` nicknames).

After the first run, check the Action log for an **"Unmatched"** list — for anyone there, add
their Discord user ID to `members.json` like `"discordId": "123456789012345678"`
(right-click the user in Discord → **Copy User ID**) and re-run. The sync only ever fills
`endorsements`, `leadership` and `avatar`; it leaves rank/ops/attendance alone.
