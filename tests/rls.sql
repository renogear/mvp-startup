\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into public.organizations(id,name) values('a0000000-0000-4000-8000-000000000001','Tenant A'),('b0000000-0000-4000-8000-000000000002','Tenant B');
insert into public.memberships values('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),('b0000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.save_project('{"id":"c0000000-0000-4000-8000-000000000003","name":"Persistence test","address":"123 Example St","city":"San Jose","state":"CA","zip":"95112","jurisdiction":"san-jose","confirmed":true,"categories":["HVAC / mechanical"]}'::jsonb,'a0000000-0000-4000-8000-000000000001');
do $$begin
if (select count(*) from public.projects)<>1 then raise exception 'Own project missing';end if;
if (select count(*) from public.properties where confirmation_status='manual')<>1 then raise exception 'Property not persisted';end if;
if (select count(*) from public.project_categories)<>1 then raise exception 'Category not persisted';end if;
if (select count(*) from public.activity_records)<>1 then raise exception 'Audit missing';end if;
end$$;
insert into public.documents(id,project_id,organization_id,path,name,mime_type,size) values('d0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000003/d0000000-0000-4000-8000-000000000004','test.pdf','application/pdf',100);
insert into storage.objects(bucket_id,name) values('project-documents','a0000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000003/d0000000-0000-4000-8000-000000000004');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
do $$begin
if (select count(*) from public.projects)<>0 then raise exception 'Cross-tenant project leak';end if;
if (select count(*) from public.documents)<>0 then raise exception 'Cross-tenant document leak';end if;
if (select count(*) from storage.objects)<>0 then raise exception 'Cross-tenant storage leak';end if;
if (select count(*) from public.activity_records)<>0 then raise exception 'Cross-tenant audit leak';end if;
begin
insert into public.projects(organization_id,name) values('a0000000-0000-4000-8000-000000000001','Attack');raise exception 'Cross-tenant write allowed';exception when insufficient_privilege then null;end;
begin
insert into storage.objects(bucket_id,name) values('project-documents','a0000000-0000-4000-8000-000000000001/c0000000-0000-4000-8000-000000000003/attack');raise exception 'Cross-tenant upload allowed';exception when insufficient_privilege then null;end;
begin
insert into public.memberships values('a0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','owner');raise exception 'Self-enrollment allowed';exception when insufficient_privilege then null;end;
begin
insert into public.requirements(jurisdiction_id,category,code) values('san-jose','HVAC','invented');raise exception 'Client rule mutation allowed';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$begin
if (select name from public.projects where id='c0000000-0000-4000-8000-000000000003')<>'Persistence test' then raise exception 'Persistent project changed';end if;
if (select count(*) from storage.objects)<>1 then raise exception 'Own document inaccessible';end if;
end$$;
rollback;
select 'PASS: persistence, normalized intake, audit, tenant read/write isolation, document access, membership escalation, rule immutability' as result;
