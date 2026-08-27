-- The previous migration added request_booking(text, timestamptz, boolean,
-- integer) while the older three-argument version was still present. With
-- p_hours defaulted, a three-argument call matches both, and Postgres refuses
-- with "function ... is not unique" rather than picking one.
--
-- Kept as its own migration so databases that already applied the previous
-- one are repaired too.

drop function if exists request_booking(text, timestamptz, boolean);
