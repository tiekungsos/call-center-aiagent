-- AILEO Call Center — P0 schema (multi-tenant ready)
-- รันซ้ำได้ (idempotent): migrate() จะ execute ไฟล์นี้ทุกครั้งที่ boot
create extension if not exists pgcrypto;

-- ลูกค้า/องค์กร (tenant)
create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

-- agent = บริบทธุรกิจ (persona + ฐานความรู้ + เครื่องมือ) ต่อ tenant
-- profile_id อ้างถึงโปรไฟล์ในโค้ด (src/profiles) ใช้เป็นค่า seed เริ่มต้น
create table if not exists agents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  profile_id    text not null,
  name          text not null,
  persona       text,
  tool_guide    text,
  knowledge_base text,
  style_extra   text,
  voice         text,
  model         text,
  enabled_tools text[] not null default '{}',
  status        text not null default 'published',
  version       int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, profile_id)
);

-- 1 สาย/1 ห้องแชท = 1 call
create table if not exists calls (
  id             text primary key,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  agent_id       uuid references agents(id) on delete set null,
  channel        text not null default 'voice',   -- voice | chat
  direction      text not null default 'inbound', -- inbound | outbound
  caller_number  text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  action         text,                            -- transfer | emergency | hangup
  recording_path text,
  summary        text,
  intent         text,
  sentiment      text,
  metadata       jsonb not null default '{}'::jsonb
);
create index if not exists calls_tenant_started_idx on calls (tenant_id, started_at desc);

-- บทสนทนา (transcript) แยกทีละ turn
create table if not exists turns (
  id      bigserial primary key,
  call_id text not null references calls(id) on delete cascade,
  ts      timestamptz not null default now(),
  role    text not null,   -- caller | agent | system
  text    text not null
);
create index if not exists turns_call_idx on turns (call_id, id);

-- การเรียกเครื่องมือ (function calls)
create table if not exists tool_calls (
  id      bigserial primary key,
  call_id text not null references calls(id) on delete cascade,
  ts      timestamptz not null default now(),
  name    text not null,
  args    jsonb,
  result  jsonb
);
create index if not exists tool_calls_call_idx on tool_calls (call_id, id);

-- ตัวชี้วัด latency ต่อ turn
create table if not exists turn_metrics (
  id                 bigserial primary key,
  call_id            text not null references calls(id) on delete cascade,
  ts                 timestamptz not null default now(),
  from_transcript_ms int,
  from_speech_end_ms int
);

-- เรื่องร้องเรียน / ขอติดต่อกลับ
create table if not exists tickets (
  id              text primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  call_id         text references calls(id) on delete set null,
  category        text,
  summary         text,
  contact_name    text,
  callback_number text,
  status          text not null default 'open',
  created_at      timestamptz not null default now()
);
create index if not exists tickets_tenant_idx on tickets (tenant_id, created_at desc);

-- ผู้ติดต่อ
create table if not exists contacts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  phone      text,
  name       text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

-- คลังความรู้ (เตรียมไว้สำหรับ P1: RAG) — ตอนนี้ใช้ persona/knowledge_base ในตาราง agents ก่อน
create table if not exists knowledge_documents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  agent_id   uuid references agents(id) on delete cascade,
  title      text,
  content    text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_tenant_idx on knowledge_documents (tenant_id);
