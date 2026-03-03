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
  id bigint primary key generated always as identity,
  email text unique not null,
  password text not null,
  role text default 'user',
  status text default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create files table with vector support
create table if not exists files (
  id bigint primary key generated always as identity,
  name text not null,
  category text not null,
  content text not null,
  type text,
  drive_file_id text unique,
  embedding vector(768), -- Gemini embedding-004 uses 768 dimensions
  uploaded_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone -- For temporary chat uploads
);

-- Create settings table
create table if not exists settings (
  key text primary key,
  value text not null
);

-- Create a function to search for documents
create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  name text,
  category text,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    files.id,
    files.name,
    files.category,
    files.content,
    1 - (files.embedding <=> query_embedding) as similarity
  from files
  where 1 - (files.embedding <=> query_embedding) > match_threshold
  order by files.embedding <=> query_embedding
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
