-- Migration 034: fix the "Eathwork" typo in company equipment.
--
-- "Skidsteer (Eathwork)" in the lookahead Company Equipment list is not in the
-- code: the form shows each company_equipment row as "name (category)", and the
-- stored category (or name) is spelled "Eathwork". There is no edit screen for
-- equipment (only add/delete), so fix the stored text here.
--
-- Data-only; safe to run more than once.

update public.company_equipment
set category = replace(category, 'Eathwork', 'Earthwork')
where category like '%Eathwork%';

update public.company_equipment
set name = replace(name, 'Eathwork', 'Earthwork')
where name like '%Eathwork%';
