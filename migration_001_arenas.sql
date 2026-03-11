-- Migration 001: Arenas + Rooms arena_id

CREATE TABLE IF NOT EXISTS arenas (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    min_bet INTEGER NOT NULL CHECK (min_bet >= 0),
    max_bet INTEGER NOT NULL CHECK (max_bet >= min_bet),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO arenas (code, name, min_bet, max_bet, sort_order) VALUES
('backyard',     'Задний двор',    0,      1000,    1),
('downtown',     'Центр города',   1000,   5000,    2),
('rooftop',      'Крыша',          5000,   25000,   3),
('underground',  'Подземелье',     25000,  100000,  4)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS arena_id INTEGER REFERENCES arenas(id) DEFAULT NULL;
