# Discord OAuth + D1 Database Setup Guide

## Overview
This guide will help you set up Discord authentication with Cloudflare D1 database for the AZO Dynamic Rolelist project.

## Prerequisites
- Node.js installed
- Wrangler CLI installed (`npm install -g wrangler`)
- Cloudflare account
- Discord Developer account

---

## Step 1: Discord OAuth App Setup (15 mins)

1. Go to **https://discord.com/developers/applications**
2. Select your application (or create a new one)
3. Click **OAuth2** in the left sidebar
4. Under **Redirects**, add:
   ```
   https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback
   ```
5. Copy your **Client ID** and **Client Secret** (you'll need these)

---

## Step 2: Login to Cloudflare (5 mins)

```bash
wrangler login
```

This will open a browser window for you to authenticate.

---

## Step 3: Verify Database Exists (5 mins)

Your `wrangler.toml` already has a D1 database configured:

```toml
[[d1_databases]]
binding = "DB"
database_name = "azo-database"
database_id = "19d2b5fd-4de0-4afa-87d1-3edbd39c7575"
```

Check if the database exists:

```bash
wrangler d1 list
```

If you need to create a new database:

```bash
wrangler d1 create azo-database
```

(Then update the `database_id` in `wrangler.toml`)

---

## Step 4: Initialize Database Schema (10 mins)

Run the schema file to create tables:

```bash
wrangler d1 execute azo-database --file=schema.sql
```

This creates the following tables:
- `users` - Discord user information
- `user_roles` - Role assignments (Alpha, Bravo, Charlie, etc.)
- `sessions` - JWT session tokens
- `sop_access_log` - Tracks who viewed which SOPs

---

## Step 5: Add Secrets to Worker (10 mins)

Set the required environment secrets:

```bash
# Discord OAuth credentials
wrangler secret put DISCORD_CLIENT_ID
# Paste your Discord Client ID when prompted

wrangler secret put DISCORD_CLIENT_SECRET
# Paste your Discord Client Secret when prompted

# JWT token signing secret (generate a random string)
wrangler secret put JWT_SECRET
# Example: use a password generator for a 32+ character string

# GitHub token (already exists, but verify)
wrangler secret list
```

### Generating JWT_SECRET
You can generate a secure random string with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 6: Deploy the Worker (5 mins)

Deploy your updated worker:

```bash
wrangler deploy
```

Expected output:
```
✨ Successfully deployed worker to
   https://azo-dynamic-rolelist-api.andrewtb02.workers.dev
```

---

## Step 7: Test Authentication (10 mins)

1. Open your browser to:
   ```
   https://andrew-ltu.github.io/AZO-Dynamic-Rolelist/sop/
   ```

2. Click **Login with Discord**

3. Authorize the application

4. You should be redirected back to the SOP dashboard

5. Verify you can see the Member SOPs page

---

## Step 8: Assign Admin Role (Optional)

To grant admin access to a user:

```bash
wrangler d1 execute azo-database --command="UPDATE users SET is_admin = 1 WHERE id = 'YOUR_DISCORD_USER_ID'"
```

To find your Discord User ID:
1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click your profile → Copy User ID

---

## Step 9: Assign Team Roles (Optional)

To assign a user to a team (Alpha, Bravo, Charlie):

```bash
wrangler d1 execute azo-database --command="INSERT INTO user_roles (user_id, role_name, assigned_at) VALUES ('DISCORD_USER_ID', 'Alpha', $(date +%s))"
```

---

## Troubleshooting

### Database not found
```bash
wrangler d1 list
```
Verify the database ID matches your `wrangler.toml`

### OAuth redirect mismatch
Check that the redirect URI in Discord Developer Portal exactly matches:
```
https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback
```

### JWT token invalid
Regenerate the JWT_SECRET:
```bash
wrangler secret put JWT_SECRET
```

### Check worker logs
```bash
wrangler tail
```

---

## Database Queries

### View all users
```bash
wrangler d1 execute azo-database --command="SELECT id, username, global_name, is_admin, last_login FROM users"
```

### View user roles
```bash
wrangler d1 execute azo-database --command="SELECT u.username, ur.role_name FROM users u JOIN user_roles ur ON u.id = ur.user_id"
```

### View active sessions
```bash
wrangler d1 execute azo-database --command="SELECT s.id, u.username, s.created_at, s.expires_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.expires_at > $(date +%s)"
```

### View SOP access logs
```bash
wrangler d1 execute azo-database --command="SELECT u.username, s.sop_name, datetime(s.accessed_at, 'unixepoch') as accessed FROM sop_access_log s JOIN users u ON s.user_id = u.id ORDER BY s.accessed_at DESC LIMIT 50"
```

---

## File Structure

```
AZO-Dynamic-Rolelist/
├── schema.sql              # Database schema
├── wrangler.toml           # Worker configuration
├── worker.js               # Enhanced worker with OAuth
├── worker.js.backup        # Original worker backup
├── sop/
│   ├── index.html          # SOP dashboard (login + menu)
│   ├── member.html         # Member SOPs
│   ├── admin.html          # Admin SOPs
│   ├── alpha.html          # Alpha team SOPs (create as needed)
│   ├── bravo.html          # Bravo team SOPs (create as needed)
│   └── charlie.html        # Charlie team SOPs (create as needed)
└── SETUP_GUIDE.md          # This file
```

---

## Next Steps

1. Create team-specific SOP pages (alpha.html, bravo.html, charlie.html)
2. Populate with actual operating procedures
3. Test role-based access control
4. Configure automatic role assignment based on Discord server roles
5. Set up monitoring and logging

---

## Support

For issues or questions:
- Check Cloudflare Workers logs: `wrangler tail`
- Review Discord OAuth documentation
- Check D1 database contents with SQL queries above

---

**Last Updated:** July 6, 2026
