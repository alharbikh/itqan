alter table public.schools drop column office_id;
alter table public.schools add column education_department text;
comment on column public.schools.education_department is 'Optional free-text education administration/department; no foreign key or required lookup';
drop table public.education_offices;
drop table public.education_regions;
