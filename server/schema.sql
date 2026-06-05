create table game_events (
  id varchar2(64) primary key,
  run_id varchar2(64) not null,
  session_id varchar2(64) not null,
  event_type varchar2(64) not null,
  level_no number not null,
  score number not null,
  cloud_action varchar2(64) not null,
  fps number,
  latency_ms number,
  client_ts timestamp with time zone,
  server_ts timestamp with time zone default systimestamp not null,
  vm_name varchar2(128),
  payload_json clob check (payload_json is json)
);

create index game_events_run_idx on game_events (run_id, server_ts);
create index game_events_type_idx on game_events (event_type, server_ts);

create table high_scores (
  run_id varchar2(64) primary key,
  session_id varchar2(64) not null,
  callsign varchar2(32) not null,
  score number not null,
  level_no number not null,
  vm_name varchar2(128),
  created_at timestamp with time zone default systimestamp not null
);

create index high_scores_rank_idx on high_scores (score desc, created_at asc);

create table ai_insights (
  id number generated always as identity primary key,
  run_id varchar2(64) not null,
  insight varchar2(500) not null,
  created_at timestamp with time zone default systimestamp not null
);

create table demo_settings (
  setting_key varchar2(64) primary key,
  setting_value varchar2(4000),
  updated_at timestamp with time zone default systimestamp not null
);

create table email_signups (
  id varchar2(64) primary key,
  callsign varchar2(32) not null,
  email varchar2(254) not null,
  created_at timestamp with time zone default systimestamp not null
);

create index email_signups_created_idx on email_signups (created_at desc);
create index email_signups_email_idx on email_signups (email);
