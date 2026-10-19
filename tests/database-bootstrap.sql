-- Supabase platform stubs for testing actual PostgreSQL RLS without cloud credentials.
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
grant usage on schema public,auth,storage to authenticated;
grant select,insert,update,delete on all tables in schema storage to authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
