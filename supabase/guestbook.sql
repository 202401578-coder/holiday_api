-- 새 수업용 프로젝트에서 실행. 공개 사용자는 읽기만, 서버는 저장 가능.
create table public.guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(btrim(nickname)) between 1 and 20),
  message text not null check (char_length(btrim(message)) between 1 and 200 and position(chr(10) in message) = 0 and position(chr(13) in message) = 0),
  created_at timestamptz not null default now()
);
alter table public.guestbook_entries enable row level security;
revoke all on table public.guestbook_entries from anon, authenticated;
grant select on table public.guestbook_entries to anon, authenticated;
grant select, insert on table public.guestbook_entries to service_role;
create policy "누구나 읽기" on public.guestbook_entries for select to anon, authenticated using (true);
create index guestbook_entries_created_at_idx on public.guestbook_entries (created_at desc, id desc);
