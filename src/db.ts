import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase credentials missing. Database operations will fail.');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

/* 
SQL SETUP FOR SUPABASE:
Run this in your Supabase SQL Editor:

-- Enable the pgvector extension to work with embeddings
create extension if not exists vector;

-- Create users table
create table if not exists users (
  id uuid primary key,
  email text unique not null,
  role text default 'user',
  status text default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create files table (metadata only)
create table if not exists files (
  id bigint primary key generated always as identity,
  name text not null,
  category text not null,
  type text,
  uploaded_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone 
);

-- Create file_chunks table for smarter retrieval (Chunk-level search)
create table if not exists file_chunks (
  id bigint primary key generated always as identity,
  file_id bigint references files(id) on delete cascade,
  content text not null,
  embedding vector(384),
  page_number int,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add full-text search index to chunks
alter table file_chunks add column if not exists fts tsvector generated always as (to_tsvector('english', content)) stored;
create index if not exists file_chunks_fts_idx on file_chunks using gin(fts);

-- Create a function to search for chunks (The "FindPage" engine)
create or replace function match_chunks (
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  file_id bigint,
  content text,
  similarity float,
  file_name text,
  category text
)
language plpgsql
as $$
begin
  return query
  select
    fc.id,
    fc.file_id,
    fc.content,
    1 - (fc.embedding <=> query_embedding) as similarity,
    f.name as file_name,
    f.category
  from file_chunks fc
  join files f on fc.file_id = f.id
  where 1 - (fc.embedding <=> query_embedding) > match_threshold
  order by fc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Insert default admin (password: admin123)
insert into users (email, password, role, status)
values ('admin@chatbot.com', 'admin123', 'admin', 'approved')
on conflict (email) do nothing;

-- IF YOU ALREADY HAVE THE TABLES, RUN THIS TO ADD THE EXPIRES_AT COLUMN:
-- alter table files add column if not exists expires_at timestamp with time zone;
*/
