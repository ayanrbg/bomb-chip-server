-- Migration 003: Full shop — character models & table items
-- Run this MANUALLY against your PostgreSQL database

-- ============================================
-- Step 1: Insert character models (type = 'model')
-- ============================================

-- Remove old default model if exists
DELETE FROM shop_items WHERE code = 'character_default';

INSERT INTO shop_items (code, name, type, price, currency) VALUES
  ('model_default_1',  'Model #1', 'model', 0,    'coins'),
  ('model_default_2',  'Model #2', 'model', 0,    'coins'),
  ('model_premium_3',  'Model #3', 'model', 500,  'coins'),
  ('model_premium_4',  'Model #4', 'model', 800,  'coins'),
  ('model_premium_5',  'Model #5', 'model', 1200, 'coins');

-- ============================================
-- Step 2: Insert table items (type = 'item_model')
-- ============================================

-- Remove old default chip if exists
DELETE FROM shop_items WHERE code = 'default_chip';

INSERT INTO shop_items (code, name, type, price, currency) VALUES
  ('item_default_chip', 'Chip #1', 'item_model', 0,   'coins'),
  ('item_premium_2',    'Chip #2', 'item_model', 400, 'coins'),
  ('item_premium_3',    'Chip #3', 'item_model', 700, 'coins');

-- ============================================
-- Step 3: Update existing users' customization
-- ============================================

-- Set model_id to random default model for users who had the old 'character_default'
UPDATE user_customization
SET model_id = (
  SELECT id FROM shop_items
  WHERE code IN ('model_default_1', 'model_default_2')
  ORDER BY RANDOM()
  LIMIT 1
)
WHERE model_id IS NULL
   OR model_id NOT IN (SELECT id FROM shop_items WHERE type = 'model');

-- Set item_model_id to new default chip for users who had the old 'default_chip'
UPDATE user_customization
SET item_model_id = (
  SELECT id FROM shop_items WHERE code = 'item_default_chip'
)
WHERE item_model_id IS NULL
   OR item_model_id NOT IN (SELECT id FROM shop_items WHERE type = 'item_model');
