-- Migration 0005: Add TikTok to social_connections provider check
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- TikTok Content Posting API stores refresh tokens for posting from the editor.

alter table public.social_connections drop constraint if exists social_connections_provider_check;
alter table public.social_connections add constraint social_connections_provider_check check (provider in ('youtube', 'tiktok'));
