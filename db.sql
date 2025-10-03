-- users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT now()
);

-- bounties
CREATE TABLE IF NOT EXISTS bounties (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  reward INTEGER NOT NULL CHECK (reward >= 0),
  status TEXT DEFAULT 'open',
  created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_amount INT NOT NULL,
  kind TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- applications
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  bounty_id INT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending / accepted / rejected
  created_at TIMESTAMP DEFAULT now()
);

-- comments
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  bounty_id INT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- attachments
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  bounty_id INT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
