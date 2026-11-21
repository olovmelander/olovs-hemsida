-- One acknowledged writer for each live card, including a handoff in transit.
CREATE TABLE live_rounds (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  course TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  writer TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recording', 'offered', 'ended')),
  snapshot TEXT,
  updated_at INTEGER NOT NULL,
  last_operation TEXT NOT NULL,
  PRIMARY KEY (user_id, course, round_id)
);
