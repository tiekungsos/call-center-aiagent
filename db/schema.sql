-- WATEE Call Center — schema (multi-tenant ready)
-- รันซ้ำได้ (idempotent): migrate() จะ execute ไฟล์นี้ทุกครั้งที่ boot
-- ต้องใช้ image ที่มี pgvector (ดู docker-compose.yml: pgvector/pgvector:pg16)
create extension if not exists pgcrypto;
create extension if not exists vector;

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

-- agent ที่ใช้งานจริง (รับสาย/แชท) — เลือกจาก console ได้ มีได้ 1 ตัวต่อ tenant
alter table agents add column if not exists is_active boolean not null default false;
create unique index if not exists agents_one_active_per_tenant_idx on agents (tenant_id) where is_active;

-- เพศของเจ้าหน้าที่ AI (male | female) — คุมคำลงท้าย ครับ/ค่ะ และใช้จัดกลุ่มเสียงใน console
alter table agents add column if not exists gender text not null default 'female';

-- ซ่อมข้อมูลเดิม: seed รุ่นก่อนบันทึกแค่เครื่องมือเฉพาะโปรไฟล์ ทำให้เครื่องมือกลาง (โอนสาย/
-- เปิดเรื่อง/วางสาย/ค้น RAG) หายไปจากสายจริง — เติมกลับเฉพาะแถวที่มีรายการอยู่แล้วแต่ขาดกลาง
-- (แถวที่ว่างเปล่ายังหมายถึง "ใช้เครื่องมือทั้งหมดของโปรไฟล์")
update agents
   set enabled_tools = (
     select array_agg(distinct x)
     from unnest(enabled_tools || array['transfer_to_agent', 'create_ticket', 'end_call', 'search_knowledge']::text[]) as t(x)
   )
 where cardinality(enabled_tools) > 0
   and not (enabled_tools @> array['transfer_to_agent', 'create_ticket', 'end_call', 'search_knowledge']::text[]);

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

-- คลังความรู้ (P1: RAG) — chunk + embedding 768 มิติ (DeepInfra google/embeddinggemma-2)
-- เอกสารผูกกับ agent โดยตรง (แยกคลังกันแต่ละ agent) — ไม่มีแบบใช้ร่วมทุก agent
create table if not exists knowledge_documents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  agent_id   uuid not null references agents(id) on delete cascade,
  title      text,
  content    text not null,
  embedding  vector(768),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- สำหรับ DB ที่สร้างไว้ก่อนมี RAG
alter table knowledge_documents add column if not exists embedding vector(768);

-- อัปโหลดไฟล์: ชนิดไฟล์ + ไฟล์ต้นฉบับที่เก็บไว้ (ดาวน์โหลดย้อนหลังได้)
alter table knowledge_documents add column if not exists kind text not null default 'text';
alter table knowledge_documents add column if not exists source_name text;
alter table knowledge_documents add column if not exists mime_type text;
alter table knowledge_documents add column if not exists storage_path text;

-- ย้ายเอกสารเดิมที่ไม่ระบุ agent ให้ไปอยู่กับ agent ที่ใช้งานของ tenant นั้น แล้วบังคับ not null
update knowledge_documents d
   set agent_id = a.id
  from agents a
 where d.agent_id is null and a.tenant_id = d.tenant_id and a.is_active;

update knowledge_documents d
   set agent_id = (select a.id from agents a where a.tenant_id = d.tenant_id order by a.created_at limit 1)
 where d.agent_id is null;

do $mig$
begin
  if not exists (select 1 from knowledge_documents where agent_id is null) then
    alter table knowledge_documents alter column agent_id set not null;
  else
    raise notice '[schema] ยังมีเอกสารที่ไม่ผูก agent — ข้ามการตั้ง not null';
  end if;
end
$mig$;

-- ย้ายมิติ embedding ให้ตรงกับโมเดลที่ใช้ (google/embeddinggemma-2 = 768 มิติ)
-- ค่า embedding ของโมเดลเก่าใช้กับโมเดลใหม่ไม่ได้ จึงล้างทิ้ง (ตัวเอกสารยังอยู่ แต่ต้องอัปโหลดใหม่เพื่อสร้าง embedding)
do $mig$
begin
  if (select atttypmod from pg_attribute
        where attrelid = 'knowledge_documents'::regclass and attname = 'embedding') <> 768 then
    drop index if exists knowledge_embedding_idx;
    update knowledge_documents set embedding = null;
    alter table knowledge_documents alter column embedding type vector(768);
  end if;
end
$mig$;

create index if not exists knowledge_tenant_idx on knowledge_documents (tenant_id);
create index if not exists knowledge_agent_idx on knowledge_documents (agent_id);
create index if not exists knowledge_embedding_idx on knowledge_documents
  using hnsw (embedding vector_cosine_ops);

-- P5: แคมเปญโทรออก
create table if not exists campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  agent_id      uuid references agents(id) on delete set null,
  name          text not null,
  status        text not null default 'draft',   -- draft | running | paused | done
  goal          text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create table if not exists campaign_targets (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  phone        text not null,
  name         text,
  variables    jsonb not null default '{}'::jsonb,
  status       text not null default 'pending',  -- pending | dialing | done | failed | skipped
  outcome      text,
  call_id      text references calls(id) on delete set null,
  attempts     int not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists campaign_targets_campaign_idx on campaign_targets (campaign_id, status);

-- ผู้ใช้ console (login เข้า dashboard) — แยกจากผู้ติดต่อของ tenant
-- password_hash = scrypt (รูปแบบ scrypt$N$r$p$salt$hash) ดู src/core/auth.ts
create table if not exists console_users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  name          text,
  password_hash text not null,
  role          text not null default 'admin',   -- admin | viewer
  disabled      boolean not null default false,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- P6: webhook ขาออกไป CRM/ERP (แจ้ง event ต่อ tenant)
create table if not exists webhooks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  url        text not null,
  events     text[] not null default '{call.end}',
  secret     text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_tenant_idx on webhooks (tenant_id);
