-- Only the current incident per fixed monitoring signal and one sweep watermark.
-- No secrets, recipient addresses, raw errors or article data are stored.
CREATE TABLE IF NOT EXISTS admin_scheduled_alert_sweep (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  observed_at TEXT NOT NULL,
  sweep_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_scheduled_alert_incidents (
  signal_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(signal_id)<=80 AND (signal_id LIKE 'job:%' OR signal_id LIKE 'queue:%')
  ),
  incident_id TEXT NOT NULL,
  opened_at TEXT NOT NULL
);
