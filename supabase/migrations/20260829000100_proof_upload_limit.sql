-- ═══════════════════════════════════════════════════════════════════════
-- Raise the payment-proof size cap from 5 MB to 10 MB.
--
-- The client now re-encodes screenshots to a 1600px JPEG before upload
-- (src/lib/image.ts), which puts a normal proof under half a megabyte — so
-- this ceiling is not the working limit, it is the headroom for the case the
-- browser cannot re-encode: HEIC outside Safari, where the original file is
-- uploaded untouched. Refusing those is refusing proof of a payment the
-- customer has already made.
-- ═══════════════════════════════════════════════════════════════════════

update storage.buckets
set file_size_limit = 10485760
where id = 'payment-proofs';
