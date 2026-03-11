-- Migration 002: Split animation into 4 subtypes + update user_customization

-- Drop old single animation_id column
ALTER TABLE user_customization DROP COLUMN IF EXISTS animation_id;

-- Add 4 separate animation slots
ALTER TABLE user_customization ADD COLUMN IF NOT EXISTS animation_hit_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN IF NOT EXISTS animation_miss_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN IF NOT EXISTS animation_win_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN IF NOT EXISTS animation_lose_id INTEGER REFERENCES shop_items(id);

-- Migrate old animation items to animation_hit
UPDATE shop_items SET type = 'animation_hit' WHERE type = 'animation';

-- Add default animations for new types (if not exists)
INSERT INTO shop_items (code, name, type, price, currency) VALUES
('default_anim_miss', 'Default Miss', 'animation_miss', 0, 'coins'),
('default_anim_win',  'Default Win',  'animation_win',  0, 'coins'),
('default_anim_lose', 'Default Lose', 'animation_lose', 0, 'coins')
ON CONFLICT DO NOTHING;

-- Set default animations for all users who have NULLs
UPDATE user_customization
SET animation_hit_id = COALESCE(animation_hit_id, (SELECT id FROM shop_items WHERE code = 'default_anim' LIMIT 1)),
    animation_miss_id = COALESCE(animation_miss_id, (SELECT id FROM shop_items WHERE code = 'default_anim_miss' LIMIT 1)),
    animation_win_id = COALESCE(animation_win_id, (SELECT id FROM shop_items WHERE code = 'default_anim_win' LIMIT 1)),
    animation_lose_id = COALESCE(animation_lose_id, (SELECT id FROM shop_items WHERE code = 'default_anim_lose' LIMIT 1));
