-- ============================================================================
-- READ-ONLY IO / WRITE-AMPLIFICATION DIAGNOSTIC  —  ONE QUERY, ONE RESULT
--
-- SELECT only. No INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/GRANT/REVOKE/VACUUM.
-- Cannot change data, schema, permissions or configuration.
--
-- Run the WHOLE file as one statement. It returns a single cell of JSON —
-- click it in the Supabase editor and copy the value.
--
-- If it errors with "relation pg_stat_statements does not exist", delete the
-- `top_wal` CTE and its line in the final jsonb_build_object, then re-run.
-- ============================================================================

with meta as (
  select jsonb_build_object(
    'db_size',        pg_size_pretty(pg_database_size(current_database())),
    'uptime',         (now() - pg_postmaster_start_time())::text,
    'db_stats_since', (select stats_reset from pg_stat_database where datname = current_database()),
    'pgss_installed', (select count(*) from pg_extension where extname = 'pg_stat_statements')
  ) j
),

-- The key block. wal_fpi = full-page images. A small row producing kilobytes of
-- WAL per call is the amplification signature from the 2026-08-14 post-mortem.
top_wal as (
  select coalesce(jsonb_agg(x order by x.wal_raw desc), '[]'::jsonb) j from (
    select substr(query, 1, 90)                          as query,
           calls,
           wal_bytes                                     as wal_raw,
           pg_size_pretty(wal_bytes)                     as wal,
           wal_fpi                                       as full_page_images,
           round((wal_bytes / greatest(calls,1))::numeric) as wal_bytes_per_call,
           round(mean_exec_time::numeric, 2)             as mean_ms
    from pg_stat_statements
    order by wal_bytes desc
    limit 15
  ) x
),

table_churn as (
  select coalesce(jsonb_agg(x order by x.writes desc), '[]'::jsonb) j from (
    select relname,
           n_tup_ins + n_tup_upd + n_tup_del as writes,
           n_tup_ins as ins, n_tup_upd as upd, n_tup_del as del,
           n_live_tup as live, n_dead_tup as dead,
           autovacuum_count as autovac,
           seq_scan, seq_tup_read,
           last_autovacuum
    from pg_stat_user_tables
    order by (n_tup_ins + n_tup_upd + n_tup_del) desc
    limit 15
  ) x
),

-- Index count is the second lever: each index pays its own full-page write on
-- the first touch after every checkpoint.
table_sizes as (
  select coalesce(jsonb_agg(x order by x.bytes desc), '[]'::jsonb) j from (
    select relname,
           pg_total_relation_size(relid)                  as bytes,
           pg_size_pretty(pg_total_relation_size(relid))  as total_size,
           pg_size_pretty(pg_indexes_size(relid))         as index_size,
           (select count(*) from pg_index where indrelid = relid) as index_count
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
    limit 15
  ) x
),

-- idx_scan resets with the stats, so read this against db_stats_since above.
-- is_unique / is_primary indexes back constraints and must NOT be dropped.
unused_indexes as (
  select coalesce(jsonb_agg(x order by x.bytes desc), '[]'::jsonb) j from (
    select s.relname, s.indexrelname, s.idx_scan,
           pg_relation_size(s.indexrelid)                 as bytes,
           pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
           i.indisunique as is_unique, i.indisprimary as is_primary
    from pg_stat_user_indexes s
    join pg_index i on i.indexrelid = s.indexrelid
    where s.idx_scan = 0
    order by pg_relation_size(s.indexrelid) desc
    limit 25
  ) x
),

-- Explains the 193 read IOPS I measured at idle. Should be ~0.99 on a 45 MB db.
cache as (
  select jsonb_build_object(
    'cache_hits',  sum(heap_blks_hit),
    'disk_reads',  sum(heap_blks_read),
    'hit_ratio',   round(sum(heap_blks_hit)::numeric
                     / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 4)
  ) j from pg_statio_user_tables
),

-- wal_compression = off is the highest-leverage safe change available: it
-- compresses exactly the full-page images that dominate this workload's WAL.
settings as (
  select coalesce(jsonb_object_agg(name, setting || coalesce(' ' || unit, '')), '{}'::jsonb) j
  from pg_settings
  where name in (
    'wal_compression','full_page_writes','shared_buffers','effective_cache_size',
    'checkpoint_timeout','max_wal_size','min_wal_size','checkpoint_completion_target',
    'work_mem','maintenance_work_mem','autovacuum_naptime','wal_level'
  )
),

activity as (
  select coalesce(jsonb_agg(x), '[]'::jsonb) j from (
    select pid, state, wait_event_type, wait_event,
           (now() - query_start)::text as running_for,
           substr(query, 1, 60) as query
    from pg_stat_activity
    where datname = current_database()
      and state <> 'idle'
      and pid <> pg_backend_pid()
  ) x
)

select jsonb_pretty(jsonb_build_object(
  'meta',            (select j from meta),
  'top_wal',         (select j from top_wal),
  'table_churn',     (select j from table_churn),
  'table_sizes',     (select j from table_sizes),
  'unused_indexes',  (select j from unused_indexes),
  'cache',           (select j from cache),
  'settings',        (select j from settings),
  'activity',        (select j from activity)
)) as diagnostic;
