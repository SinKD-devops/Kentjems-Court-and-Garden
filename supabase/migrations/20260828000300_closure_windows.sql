-- Closures are stored as a tstzrange so the gist index can do overlap
-- containment cheaply. PostgREST returns that as a range literal the client
-- would have to parse by hand, so expose the bounds as ordinary columns.

create view closure_windows
with (security_invoker = off) as
  select
    id,
    space_id,
    lower(during) as starts_at,
    upper(during) as ends_at,
    reason
  from closures;

comment on view closure_windows is
  'Closures with range bounds flattened into timestamptz columns for the availability engine.';

grant select on closure_windows to anon, authenticated;
