\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
('11000000-0000-4000-8000-000000000001'),
('11000000-0000-4000-8000-000000000002'),
('22000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name) values
('aa000000-0000-4000-8000-000000000001','Plan tenant A'),
('bb000000-0000-4000-8000-000000000001','Plan tenant B');
insert into public.memberships values
('aa000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner'),
('aa000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','member'),
('bb000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','owner');
insert into public.projects(id,organization_id,name) values
('ca000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','Private plan A'),
('cb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','Private plan B');
insert into public.documents(id,project_id,organization_id,path,name,mime_type,size) values
('da000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001/ca000000-0000-4000-8000-000000000001/da000000-0000-4000-8000-000000000001','private-a.pdf','application/pdf',100),
('db000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001/cb000000-0000-4000-8000-000000000001/db000000-0000-4000-8000-000000000001','private-b.pdf','application/pdf',100);
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
insert into public.plan_reviews(id,organization_id,project_id,document_id,file_sha256,file_name,mime_type,file_size,context) values
('ea000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001',repeat('a',64),'private-a.pdf','application/pdf',100,'{"ahj":"san-diego-county","jurisdictionStatus":"unsupported"}');
insert into public.plan_analysis_jobs(id,review_id,organization_id,project_id,document_id,page) values
('fa000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001',5);
do $$begin
  begin
    insert into public.plan_reviews(organization_id,project_id,document_id,file_sha256,file_name,mime_type,file_size) values('aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','db000000-0000-4000-8000-000000000001',repeat('a',64),'wrong-project.pdf','application/pdf',100);
    raise exception 'Cross-project document association allowed';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.plan_analysis_jobs(review_id,organization_id,project_id,document_id,page,state,attempts) values('ea000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001',5,'failed',1);
    raise exception 'Client prepopulated worker state';
  exception when insufficient_privilege then null; end;
  begin
    update public.plan_reviews set file_sha256=repeat('c',64);
    raise exception 'Source fingerprint was mutable';
  exception when insufficient_privilege then null; end;
end$$;

-- Another tenant cannot discover or claim the waiting job.
select set_config('request.jwt.claim.sub','22000000-0000-4000-8000-000000000001',true);
do $$begin
  if exists(select 1 from public.plan_reviews) or exists(select 1 from public.plan_analysis_jobs) then raise exception 'Cross-tenant review/job leak'; end if;
  if exists(select 1 from public.claim_plan_job()) then raise exception 'Claimed another tenant job'; end if;
  begin
    perform public.retry_plan_job('fa000000-0000-4000-8000-000000000001');
    raise exception 'Cross-tenant retry allowed';
  exception when raise_exception then if sqlerrm<>'Retryable job not found' then raise; end if; end;
end$$;

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('permitpilot.test.first_lease',(select lease_token::text from public.claim_plan_job()),true);
do $$declare job public.plan_analysis_jobs; begin
  select * into job from public.plan_analysis_jobs;
  if job.state<>'processing' or job.attempts<>1 or job.claimed_by<>auth.uid() then raise exception 'Claim did not persist'; end if;
  if exists(select 1 from public.claim_plan_job()) then raise exception 'Active job claimed twice'; end if;
  update public.plan_analysis_jobs set state='failed' where id=job.id;
  if found then raise exception 'Client changed worker state directly'; end if;
  perform public.heartbeat_plan_job(job.id,job.lease_token);
end$$;

-- A second member of the same organization cannot complete another worker's lease.
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
do $$begin
  begin
    perform public.fail_plan_job('fa000000-0000-4000-8000-000000000001','malicious cancellation',false,current_setting('permitpilot.test.first_lease')::uuid);
    raise exception 'Another worker lease accepted';
  exception when raise_exception then if sqlerrm<>'Active owned job not found' then raise; end if; end;
end$$;

-- Simulate a worker crash and recover with a new fencing token.
reset role;
update public.plan_analysis_jobs set lease_expires_at=now()-interval '1 second' where id='fa000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('permitpilot.test.second_lease',(select lease_token::text from public.claim_plan_job()),true);
do $$begin
  if current_setting('permitpilot.test.first_lease')=current_setting('permitpilot.test.second_lease') then raise exception 'Lease token not refreshed'; end if;
  if (select attempts from public.plan_analysis_jobs)<>2 then raise exception 'Recovery attempt not counted'; end if;
  begin
    perform public.heartbeat_plan_job('fa000000-0000-4000-8000-000000000001',current_setting('permitpilot.test.first_lease')::uuid);
    raise exception 'Stale worker lease accepted';
  exception when raise_exception then if sqlerrm<>'Active owned job not found' then raise; end if; end;
end$$;

-- Source fingerprints and page provenance must match before durable completion.
do $$declare payload jsonb; job public.plan_analysis_jobs; begin
  payload=jsonb_build_object('schemaVersion','1','sourceSha256',repeat('c',64),'pageCount',10,'page',jsonb_build_object('number',5,'width',1224,'height',792,'rotation',0,'kind','vector'),'elements',jsonb_build_array(jsonb_build_object('id','dim-test','page',5,'kind','dimension','verification','unreviewed','bbox',jsonb_build_object('x',0.1,'y',0.1,'width',0.2,'height',0.02),'label','Test annotation')));
  begin
    perform public.complete_plan_job('fa000000-0000-4000-8000-000000000001',payload,repeat('b',64),current_setting('permitpilot.test.second_lease')::uuid);
    raise exception 'Mismatched source was accepted';
  exception when raise_exception then if sqlerrm<>'Source checksum mismatch' then raise; end if; end;
  payload=jsonb_set(payload,'{sourceSha256}',to_jsonb(repeat('a',64)));
  begin
    perform public.complete_plan_job('fa000000-0000-4000-8000-000000000001',jsonb_set(payload,'{elements,0,bbox,x}','null'::jsonb),repeat('b',64),current_setting('permitpilot.test.second_lease')::uuid);
    raise exception 'Null observation coordinate accepted';
  exception when raise_exception then if sqlerrm<>'Invalid observation coordinates' then raise; end if; end;
  select * into job from public.complete_plan_job('fa000000-0000-4000-8000-000000000001',payload,repeat('b',64),current_setting('permitpilot.test.second_lease')::uuid);
  if job.state<>'complete' or job.result<>payload then raise exception 'Extraction result not persisted'; end if;
  if (select count(*) from public.extracted_elements)<>1 or (select count(*) from public.document_pages)<>1 then raise exception 'Element/page provenance missing'; end if;
  if (select page_count from public.plan_reviews)<>10 then raise exception 'Page count not persisted'; end if;
end$$;

insert into public.user_corrections(job_id,review_id,organization_id,project_id,document_id,element_id,status,correction) values
('fa000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001','dim-test','corrected','{"label":"Reviewed annotation","note":"User correction, not a verified rule"}');
do $$begin
  update public.user_corrections set correction='{}';
  if found then raise exception 'Correction history was mutable'; end if;
  if (select original->>'label' from public.extracted_elements)<>'Test annotation' then raise exception 'Original observation changed'; end if;
  begin
    insert into public.code_sources(jurisdiction_id,title,source_url,publisher,retrieved_at) values('san-jose','Invented code','https://example.com','Customer',now());
    raise exception 'Customer published a regulatory source';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.compliance_rules(jurisdiction_id,code,title) values('san-jose','invented','Invented rule');
    raise exception 'Customer published a code rule';
  exception when insufficient_privilege then null; end;
end$$;

-- Retryable failures requeue; explicit failures can be retried only within budget.
insert into public.plan_analysis_jobs(id,review_id,organization_id,project_id,document_id,page) values
('fa000000-0000-4000-8000-000000000002','ea000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001',6);
do $$declare job public.plan_analysis_jobs; begin
  select * into job from public.claim_plan_job();
  select * into job from public.fail_plan_job(job.id,'Transient parser error',true,job.lease_token);
  if job.state<>'queued' or job.attempts<>1 then raise exception 'Retryable failure not requeued'; end if;
  select * into job from public.claim_plan_job();
  select * into job from public.fail_plan_job(job.id,'Needs inspection',false,job.lease_token);
  if job.state<>'failed' or job.attempts<>2 then raise exception 'Explicit failure not persisted'; end if;
  select * into job from public.retry_plan_job(job.id);
  if job.state<>'queued' then raise exception 'Manual retry did not queue'; end if;
  select * into job from public.claim_plan_job();
  if job.attempts<>3 then raise exception 'Retry attempt budget not counted'; end if;
end$$;
reset role;
update public.plan_analysis_jobs set lease_expires_at=now()-interval '1 second' where id='fa000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
  if exists(select 1 from public.claim_plan_job()) then raise exception 'Exhausted job reclaimed'; end if;
  if (select state from public.plan_analysis_jobs where id='fa000000-0000-4000-8000-000000000002')<>'failed' then raise exception 'Orphan at attempt limit not failed'; end if;
  begin
    perform public.retry_plan_job('fa000000-0000-4000-8000-000000000002');
    raise exception 'Retry exceeded attempt budget';
  exception when raise_exception then if sqlerrm<>'Retryable job not found' then raise; end if; end;
end$$;

-- Corrections, parsed text and reports remain private after processing.
select set_config('request.jwt.claim.sub','22000000-0000-4000-8000-000000000001',true);
do $$begin
  if exists(select 1 from public.document_pages) or exists(select 1 from public.extracted_elements) or exists(select 1 from public.user_corrections) then raise exception 'Cross-tenant extraction/correction leak'; end if;
end$$;
rollback;
select 'PASS: durable extraction, composite tenant/project/document FKs, job claims, lease fencing/recovery, source integrity, immutable corrections, regulatory publication isolation' as result;
