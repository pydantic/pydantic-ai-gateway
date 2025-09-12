CREATE TABLE IF NOT EXISTS spend (
  -- team id, user id, or key id
  entityId INTEGER NOT NULL,
  -- one of (1=team, 2=user, 3=key)
  entityType INTEGER CHECK(entityType IN (1, 2, 3)) NOT NULL,
  -- scope (1=daily, 2=weekly, 3=monthly, 4=total)
  scope INTEGER CHECK(scope IN (1, 2, 3, 4)) NOT NULL,
  -- days since 1970-01-01, null for scope=total
  scopeInterval INTEGER,
  -- the limit for this entity in this scope and interval
  spendingLimit REAL NOT NULL,
  -- the total spend by this entity in this scope and interval
  spend REAL NOT NULL,
  PRIMARY KEY (entityId, entityType, scope, scopeInterval)
);
CREATE INDEX IF NOT EXISTS idxSpendScopeInterval ON spend (scopeInterval);

CREATE TABLE IF NOT EXISTS keyStatus (
  id INTEGER NOT NULL PRIMARY KEY,
  status TEXT NOT NULL,
  -- null if the key state scope does not expire
  expiresAt TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idxKeyStatusExpiresAt ON keyStatus (expiresAt);
