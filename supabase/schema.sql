-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Creates the books table and opens it up for public read/write via the anon key,
-- since this is a single-user personal site with no login.

create table if not exists books (
  id text primary key,
  title text not null,
  author text not null,
  genre text not null default 'Fiction',
  year integer,
  pages integer default 0,
  rating integer not null default 0,
  finished text default 'In progress',
  spine text not null,
  ink text not null,
  cover text default '',
  reread_count integer not null default 0,
  note text,
  shelf text not null check (shelf in ('read', 'toRead')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists books_shelf_position_idx on books (shelf, position);

alter table books enable row level security;

-- Open access: anyone with the anon key (i.e. anyone loading the site) can
-- read and write. Fine for a personal portfolio project with no login.
create policy "public read" on books for select using (true);
create policy "public insert" on books for insert with check (true);
create policy "public update" on books for update using (true) with check (true);
create policy "public delete" on books for delete using (true);
