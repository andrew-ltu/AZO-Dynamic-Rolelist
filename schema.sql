-- AZO Dynamic Rolelist Database Schema
-- Cloudflare D1 Database

-- Users table - stores Discord user info
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- Discord user ID
  username TEXT NOT NULL,           -- Discord username
  discriminator TEXT,               -- Discord discriminator (legacy)
  global_name TEXT,                 -- Discord display name
  avatar TEXT,                      -- Discord avatar hash
  email TEXT,                       -- Discord email (if shared)
  created_at INTEGER NOT NULL,      -- Timestamp of first login
  last_login INTEGER NOT NULL,      -- Timestamp of last login
  is_admin INTEGER DEFAULT 0        -- 1 if admin, 0 if not
);

-- Roles table - stores user role assignments
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,            -- Discord user ID
  role_name TEXT NOT NULL,          -- Role name (e.g., 'Alpha', 'Bravo', 'Charlie')
  assigned_at INTEGER NOT NULL,     -- Timestamp of role assignment
  assigned_by TEXT,                 -- Discord ID of admin who assigned
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, role_name)        -- Prevent duplicate role assignments
);

-- Sessions table - stores active login sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,              -- Session token (JWT or random UUID)
  user_id TEXT NOT NULL,            -- Discord user ID
  created_at INTEGER NOT NULL,      -- Timestamp of session creation
  expires_at INTEGER NOT NULL,      -- Timestamp when session expires
  ip_address TEXT,                  -- IP address (optional)
  user_agent TEXT,                  -- Browser user agent (optional)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- SOP access log - track who viewed what SOPs
CREATE TABLE IF NOT EXISTS sop_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,            -- Discord user ID
  sop_name TEXT NOT NULL,           -- SOP identifier (e.g., 'alpha_sop', 'admin_sop')
  accessed_at INTEGER NOT NULL,     -- Timestamp of access
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Roster table - stores the full operation roster as JSON
CREATE TABLE IF NOT EXISTS roster (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Members table - stores member directory data (discordRank, endorsements, etc.)
CREATE TABLE IF NOT EXISTS members (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Calendar operations table - stores custom ops for the calendar (added by admins)
CREATE TABLE IF NOT EXISTS calendar_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  short TEXT NOT NULL,
  zeus TEXT NOT NULL,
  status TEXT DEFAULT 'upcoming',
  theme TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_ops_date ON calendar_ops(date);

-- Gallery images table - stores uploaded operation screenshots
CREATE TABLE IF NOT EXISTS gallery_images (
  id TEXT PRIMARY KEY,
  op_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT DEFAULT 'image/jpeg',
  size INTEGER DEFAULT 0,
  uploaded_by TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_op_name ON gallery_images(op_name);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sop_log_user_id ON sop_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_sop_log_accessed_at ON sop_access_log(accessed_at);
