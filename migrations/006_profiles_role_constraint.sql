-- Drop the existing role check constraint and replace it with one that includes sub-roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('pm', 'apm', 'super', 'subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'));
