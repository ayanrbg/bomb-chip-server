-- Migration 004: Backfill user_customization for existing users who don't have one
-- This ensures all users have a customization row with default values

INSERT INTO user_customization (user_id, model_id, item_model_id, skin_id, effect_id, animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id)
SELECT
  u.id,
  (SELECT id FROM shop_items WHERE code IN ('model_default_1','model_default_2') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'item_default_chip' LIMIT 1),
  (SELECT id FROM shop_items WHERE code IN ('default_skin1','default_skin2','default_skin3') ORDER BY RANDOM() LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'default_effect' LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'default_anim' LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'default_anim_miss' LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'default_anim_win' LIMIT 1),
  (SELECT id FROM shop_items WHERE code = 'default_anim_lose' LIMIT 1)
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_customization uc WHERE uc.user_id = u.id
);
