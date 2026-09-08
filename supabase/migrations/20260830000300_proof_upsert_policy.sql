-- ═══════════════════════════════════════════════════════════════════════
-- Let a customer replace their own payment proof.
--
-- Reported from the app: submitting a proof showed "new row violates
-- row-level security policy" while the image itself was plainly there.
--
-- The bucket had exactly two policies, INSERT and SELECT. The upload uses
-- `upsert: true`, so writing to a path that already holds an object is an
-- UPDATE, not an INSERT — and no UPDATE policy existed. The first write
-- succeeded and every later one was refused, which is why the error and the
-- uploaded image appeared together.
--
-- It matters more than a confusing message. A customer whose first screenshot
-- was unreadable is told to send a clearer one; without this they cannot, and
-- the operator rejects a payment that was genuinely made.
--
-- Scoped exactly like the INSERT policy: a customer may only write inside the
-- folder named after their own user id. Both USING and WITH CHECK are given,
-- or the policy would let a row be updated *into* someone else's folder.
-- ═══════════════════════════════════════════════════════════════════════

create policy "own proof replace" on storage.objects for update to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on policy "own proof replace" on storage.objects is
  'Upload uses upsert, which is an UPDATE when the object already exists. Without this a customer cannot replace an unreadable screenshot.';
