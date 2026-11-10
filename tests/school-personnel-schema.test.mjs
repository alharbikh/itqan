import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110224500_school_personnel_profiles_expand.sql', import.meta.url),
  'utf8'
);

// Non-destructive contract tests. Database migration execution and RLS
// integration must be tested independently in an isolated PostgreSQL instance.
test('the four approved schema entities are declared and have RLS enabled', () => {
  for (const entity of [
    'school_personnel_profiles',
    'school_personnel_requests',
    'school_profile_operations',
    'school_profile_operation_approvals'
  ]) {
    assert.ok(migration.includes('create table public.' + entity + ' ('));
    assert.ok(migration.includes('alter table public.' + entity + ' enable row level security'));
  }
});

test('personnel number uniqueness is school scoped', () => {
  assert.match(migration, /unique\s*\(school_id,\s*employee_number\)/i);
  assert.doesNotMatch(migration, /unique\s*\(employee_number\)/i);
});

test('legacy memberships and school placements are expanded, not rewritten', () => {
  assert.match(migration, /alter table public\.school_memberships\s+add column personnel_profile_id uuid/i);
  assert.match(migration, /alter table public\.school_employees\s+add column personnel_profile_id uuid/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate table|delete from|update public\.school_memberships|drop index)\b/i);
});

test('initial requests do not require legacy school_employee_id', () => {
  assert.match(migration, /create table public\.school_personnel_requests/i);
  assert.match(migration, /submitted_data jsonb not null/i);
  assert.match(migration, /school_personnel_requests_one_open_per_user_school/i);
  assert.doesNotMatch(migration, /alter table public\.school_link_requests/i);
});

test('operations require distinct schools and separate consent records', () => {
  assert.match(migration, /source_school_id <> target_school_id/);
  assert.match(migration, /'copy','transfer'/);
  assert.match(migration, /'subject','source_school_owner'/);
  assert.match(migration, /foreign key \(source_profile_id,source_school_id\)/);
  assert.match(migration, /foreign key \(target_profile_id,target_school_id\)/);
});

test('the four new tables are closed to direct anonymous/authenticated access', () => {
  assert.match(migration, /revoke all on public\.school_personnel_profiles,[\s\S]*?from public, anon, authenticated/i);
});
