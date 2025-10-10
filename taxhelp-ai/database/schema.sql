-- Placeholder schema for TaxHelp AI project structure.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100) UNIQUE,
  plan VARCHAR(20),
  plan_expiry DATE
);

CREATE TABLE IF NOT EXISTS tax_data (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  form_type VARCHAR(20),
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  amount_cents INTEGER,
  plan VARCHAR(20),
  status VARCHAR(20),
  paid_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  reminder_type VARCHAR(50),
  remind_at TIMESTAMP,
  completed BOOLEAN DEFAULT FALSE
);
