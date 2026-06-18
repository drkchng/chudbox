-- DEC-10 (§15.5 / §15.8 Phase 1): consent to show the owner display name on
-- shares. Additive ADD COLUMN — DEFAULT 1 backfills every existing user at ALTER
-- time (no data pass), so opt-out default ("shown unless turned off"). MUST NOT
-- rebuild `user` (a rebuild fires the ON DELETE CASCADE into share_links). The
-- `share_links.scope += 'listing'` widening is code-only (TS enum), no DDL.
ALTER TABLE `user` ADD `show_owner_name` integer DEFAULT 1 NOT NULL;