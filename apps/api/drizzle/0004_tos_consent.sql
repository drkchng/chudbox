-- Consent record: the Terms version accepted at sign-up (acceptance time =
-- created_at). Additive ADD COLUMN, nullable, no DEFAULT: pre-policy rows
-- stay NULL ("no recorded acceptance") and `user` MUST NOT be rebuilt (a
-- rebuild fires the ON DELETE CASCADE chain into session/account/share_links).
-- New accounts always carry a value: the required Better Auth additionalField
-- in src/auth.ts rejects sign-up without one.
ALTER TABLE `user` ADD `tos_accepted_version` integer;
