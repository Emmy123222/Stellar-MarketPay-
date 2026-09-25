CREATE TABLE ws_event_queue (
  id SERIAL PRIMARY KEY,
  event JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
