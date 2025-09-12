CREATE TABLE IF NOT EXISTS spend (
  id TEXT NOT NULL PRIMARY KEY,
  spend REAL NOT NULL,
  spendingLimit REAL NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- so we can delete old spend beyond one month
  CHECK (spend <= spendingLimit)
);
CREATE INDEX IF NOT EXISTS idxSpendCreatedAt ON spend (createdAt DESC);

CREATE TABLE IF NOT EXISTS keyStatus (
  id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL,
  expiresAt TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idxKeyStatusExpiresAt ON keyStatus (expiresAt DESC);
