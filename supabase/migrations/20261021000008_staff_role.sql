-- =============================================================================
-- MediConnect: staff role
-- A new enum value cannot be used in the transaction that adds it, so this
-- migration only adds the value; 0009 builds the permission model on it.
-- =============================================================================

alter type public.user_role add value if not exists 'staff';
