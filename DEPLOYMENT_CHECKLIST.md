# 🚀 Deployment Checklist - Discord OAuth + D1 Database

## ✅ What's Been Done

### Files Created
- ✅ `schema.sql` - Database schema with 4 tables (users, user_roles, sessions, sop_access_log)
- ✅ `worker.js` - Enhanced with Discord OAuth + JWT authentication (original backed up)
- ✅ `wrangler.toml` - Updated with D1 database binding
- ✅ `sop/index.html` - SOP portal with Discord login and role-based menu
- ✅ `sop/member.html` - Member SOPs (full content)
- ✅ `sop/admin.html` - Admin SOPs (template)
- ✅ `SETUP_GUIDE.md` - Comprehensive setup instructions
- ✅ Git branch `feature/discord-auth-db` created and committed

### Features Implemented
- ✅ Discord OAuth 2.0 authentication flow
- ✅ JWT token generation and verification
- ✅ D1 database integration for user management
- ✅ Role-based access control for SOPs
- ✅ Session management with expiration
- ✅ SOP access logging
- ✅ Preserved existing slot claiming functionality

---

## 📋 Deployment Steps (Do These Next)

### 1. Discord OAuth Setup (15 mins)
```bash
# 1. Go to: https://discord.com/developers/applications
# 2. Select your app (or create new: "AZO Roster Sync")
# 3. OAuth2 → Redirects → Add:
#    https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback
# 4. Copy Client ID and Client Secret
```

### 2. Cloudflare Login (2 mins)
```bash
wrangler login
```

### 3. Initialize Database (5 mins)
```bash
# Run the schema to create tables
wrangler d1 execute azo-database --file=schema.sql
```

Expected output:
```
🌀 Executing on azo-database (19d2b5fd-4de0-4afa-87d1-3edbd39c7575):
🚣 Executed 9 commands in 0.234ms
```

### 4. Set Worker Secrets (10 mins)
```bash
# Discord OAuth credentials
wrangler secret put DISCORD_CLIENT_ID
# → Paste your Discord Client ID

wrangler secret put DISCORD_CLIENT_SECRET
# → Paste your Discord Client Secret

# JWT signing secret (generate random 32+ char string)
wrangler secret put JWT_SECRET
# → Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Deploy Worker (3 mins)
```bash
wrangler deploy
```

Expected output:
```
✨ Successfully deployed worker
   https://azo-dynamic-rolelist-api.andrewtb02.workers.dev
```

### 6. Test Authentication (10 mins)
```bash
# 1. Open: https://andrew-ltu.github.io/AZO-Dynamic-Rolelist/sop/
# 2. Click "Login with Discord"
# 3. Authorize the application
# 4. Should redirect back to SOP dashboard with your profile
# 5. Try accessing Member SOPs
```

### 7. Grant Admin Access (Optional, 5 mins)
```bash
# First, login once to create your user record
# Then get your Discord User ID:
# Discord → Settings → Advanced → Enable Developer Mode
# Right-click your profile → Copy User ID

# Grant admin role:
wrangler d1 execute azo-database --command="UPDATE users SET is_admin = 1 WHERE id = 'YOUR_DISCORD_ID'"

# Verify:
wrangler d1 execute azo-database --command="SELECT id, username, is_admin FROM users"
```

### 8. Assign Team Roles (Optional, 5 mins)
```bash
# Assign user to Alpha team:
wrangler d1 execute azo-database --command="INSERT INTO user_roles (user_id, role_name, assigned_at) VALUES ('DISCORD_ID', 'Alpha', $(date +%s))"

# Verify roles:
wrangler d1 execute azo-database --command="SELECT u.username, ur.role_name FROM users u JOIN user_roles ur ON u.id = ur.user_id"
```

---

## 🧪 Testing Checklist

### Authentication Flow
- [ ] Can access SOP portal at `/sop/`
- [ ] "Login with Discord" button redirects to Discord
- [ ] After authorization, redirected back with profile visible
- [ ] Token stored in localStorage
- [ ] Can access Member SOPs (available to all)
- [ ] Logout button clears session

### Role-Based Access
- [ ] Non-admin users see locked Admin SOP
- [ ] Alpha members can access Alpha SOPs
- [ ] Bravo members can access Bravo SOPs
- [ ] Charlie members can access Charlie SOPs
- [ ] Admins can access all SOPs

### Existing Functionality
- [ ] Slot claiming still works at `/claim` endpoint
- [ ] Roster sync still functional
- [ ] GitHub integration unchanged

---

## 📊 Database Queries (Useful Commands)

### View all users
```bash
wrangler d1 execute azo-database --command="SELECT id, username, global_name, is_admin, datetime(last_login, 'unixepoch') as last_login FROM users ORDER BY last_login DESC"
```

### View active sessions
```bash
wrangler d1 execute azo-database --command="SELECT COUNT(*) as active_sessions FROM sessions WHERE expires_at > $(date +%s)"
```

### View SOP access logs (last 20)
```bash
wrangler d1 execute azo-database --command="SELECT u.username, s.sop_name, datetime(s.accessed_at, 'unixepoch') as accessed FROM sop_access_log s JOIN users u ON s.user_id = u.id ORDER BY s.accessed_at DESC LIMIT 20"
```

### Clean expired sessions
```bash
wrangler d1 execute azo-database --command="DELETE FROM sessions WHERE expires_at < $(date +%s)"
```

---

## 🐛 Troubleshooting

### "OAuth redirect mismatch" error
**Fix:** Verify Discord OAuth redirect URI exactly matches:
```
https://azo-dynamic-rolelist-api.andrewtb02.workers.dev/auth/callback
```

### "Database not found" error
**Fix:** Check database ID in wrangler.toml matches:
```bash
wrangler d1 list
```

### "Invalid JWT token" error
**Fix:** Regenerate JWT_SECRET:
```bash
wrangler secret put JWT_SECRET
```
Then logout and login again.

### Worker deployment fails
**Fix:** Check logs:
```bash
wrangler tail
```

### Can't see admin SOPs
**Fix:** Verify admin role:
```bash
wrangler d1 execute azo-database --command="SELECT id, username, is_admin FROM users WHERE id = 'YOUR_DISCORD_ID'"
```

---

## 🎯 Next Steps (After Deployment)

### Immediate
1. Test login flow with 2-3 team members
2. Grant admin access to leadership
3. Assign team roles (Alpha, Bravo, Charlie)
4. Monitor initial usage and fix issues

### Short-term
1. Create team-specific SOP pages (alpha.html, bravo.html, charlie.html)
2. Populate SOPs with actual procedures
3. Add SOP access logging to track who viewed what
4. Set up automated role assignment based on Discord server roles

### Long-term
1. Build admin dashboard for user management
2. Add SOP versioning and change tracking
3. Implement SOP search functionality
4. Create mobile-responsive layouts

---

## 📞 Support

**Documentation:**
- `SETUP_GUIDE.md` - Detailed setup instructions
- `schema.sql` - Database structure reference
- `worker.js` - API endpoint documentation

**Logs:**
```bash
wrangler tail                    # Live worker logs
wrangler d1 execute azo-database --command="SELECT * FROM sop_access_log"
```

**Git:**
```bash
git status                       # Current branch status
git log                          # Commit history
git checkout main                # Return to main branch
```

---

## ✅ Final Deployment Command Sequence

```bash
# 1. Make sure you're on the feature branch
git status

# 2. Login to Cloudflare
wrangler login

# 3. Initialize database
wrangler d1 execute azo-database --file=schema.sql

# 4. Set secrets (Discord + JWT)
wrangler secret put DISCORD_CLIENT_ID
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put JWT_SECRET

# 5. Deploy
wrangler deploy

# 6. Test
# Open: https://andrew-ltu.github.io/AZO-Dynamic-Rolelist/sop/

# 7. Monitor
wrangler tail
```

---

**Status:** ✅ All code complete, ready for deployment
**Branch:** `feature/discord-auth-db`
**Date:** July 6, 2026
