-- ============================================================================
-- READ-ONLY.  SELECT only.
--
-- RUN TWICE, ~5 MINUTES APART.
--
-- WHY: over 12.2 minutes the cluster produced 100.6 MB of WAL while this
-- database's tracked statements produced ~35 KB and only 59 rows changed.
-- pg_stat_statements and pg_stat_user_tables are CURRENT-DATABASE ONLY, so they
-- cannot see Supabase's internal databases (_supabase / supavisor / analytics)
-- or background workers. pg_stat_database is cluster-wide and can.
--
-- Also tests the alternative explanation: that the WAL LSN is advancing because
-- segments are being FORCE-SWITCHED on a timer (archive_timeout), which burns a
-- full 16 MB segment regardless of how little data is in it.
-- ============================================================================

select jsonb_pretty(jsonb_build_object(

  'sampled_at',      now(),
  'wal_bytes_total', pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'),
  'current_wal_file',pg_walfile_name(pg_current_wal_lsn()),

  -- Cluster-wide, per database. The delta attributes the writes to a database.
  'databases', (select coalesce(jsonb_agg(jsonb_build_object(
                   'datname',     datname,
                   'xact_commit', xact_commit,
                   'tup_ins',     tup_inserted,
                   'tup_upd',     tup_updated,
                   'tup_del',     tup_deleted,
                   'blks_read',   blks_read,
                   'blks_hit',    blks_hit) order by xact_commit desc), '[]'::jsonb)
                 from pg_stat_database where datname is not null),

  -- If archived_count rises ~1 per segment while real data is tiny, the WAL is
  -- being burned by forced switches, not by your writes.
  'archiver', (select jsonb_build_object(
                  'archived_count',     archived_count,
                  'last_archived_wal',  last_archived_wal,
                  'last_archived_time', last_archived_time,
                  'failed_count',       failed_count,
                  'last_failed_wal',    last_failed_wal,
                  'last_failed_time',   last_failed_time)
                from pg_stat_archiver),

  -- An inactive or lagging slot retains WAL and can pin disk. Realtime/logical
  -- decoding lives here.
  'replication_slots', (select coalesce(jsonb_agg(jsonb_build_object(
                   'slot_name',  slot_name,
                   'plugin',     plugin,
                   'slot_type',  slot_type,
                   'active',     active,
                   'wal_status', wal_status,
                   'retained_bytes', pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))), '[]'::jsonb)
                 from pg_replication_slots),

  'settings', (select coalesce(jsonb_object_agg(name, setting || coalesce(' ' || unit, '')), '{}'::jsonb)
               from pg_settings
               where name in ('archive_mode','archive_timeout','wal_writer_delay',
                              'wal_keep_size','max_slot_wal_keep_size','wal_level',
                              'checkpoint_timeout','max_wal_size','wal_compression',
                              'track_commit_timestamp','synchronous_commit'))

)) as wal_source_sample;
