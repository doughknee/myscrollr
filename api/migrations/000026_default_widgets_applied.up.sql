-- First-run default widget (SCROLLR-246): a fresh account's first
-- signed-in ticker scrolls NPR headlines instead of the "no sources yet"
-- CTA. The desktop app adds `news_npr` through the normal widget-create
-- path on an account's first sign-in (zero user_widgets rows) and then
-- flips this flag so the default is applied exactly once — removing the
-- widget afterward must never bring it back, on this device, another
-- device, or after a sign-out/in.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS default_widgets_applied boolean NOT NULL DEFAULT false;
