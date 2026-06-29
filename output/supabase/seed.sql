-- EstateFlow CRM seed data
insert into organizations (id, name)
values ('11111111-1111-1111-1111-111111111111', 'EstateFlow CRM')
on conflict (id) do nothing;

insert into profiles (id, organization_id, full_name, phone, email, role, is_available)
values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Ananya Mehra', '+919820001001', 'admin@estateflow.in', 'admin', true),
  ('31111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Ravi Khanna', '+919820001002', 'manager@estateflow.in', 'sales_manager', true),
  ('41111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Priya Sood', '+919820001003', 'agent1@estateflow.in', 'sales_agent', true),
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Karan Arora', '+919820001004', 'agent2@estateflow.in', 'sales_agent', true),
  ('61111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Ishita Dey', '+919820001005', 'field@estateflow.in', 'field_executive', true),
  ('71111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Neeraj Jain', '+919820001006', 'social@estateflow.in', 'social_media_manager', true)
on conflict (id) do nothing;

insert into integration_settings (organization_id, mode, lead_assignment_mode)
values ('11111111-1111-1111-1111-111111111111', 'dry-run', 'Round Robin')
on conflict do nothing;

insert into lead_sources (organization_id, name)
values
  ('11111111-1111-1111-1111-111111111111', '36 Acre'),
  ('11111111-1111-1111-1111-111111111111', 'MagicBricks'),
  ('11111111-1111-1111-1111-111111111111', 'Housing'),
  ('11111111-1111-1111-1111-111111111111', 'Facebook'),
  ('11111111-1111-1111-1111-111111111111', 'Instagram'),
  ('11111111-1111-1111-1111-111111111111', 'Website'),
  ('11111111-1111-1111-1111-111111111111', 'Referral'),
  ('11111111-1111-1111-1111-111111111111', 'Manual')
on conflict do nothing;
