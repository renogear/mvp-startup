-- Floor-plan observations are separate from authoritative regulatory findings.
-- There are deliberately no code/rule seeds or client-side rule publication grants.
alter table public.documents add constraint documents_identity unique(id,project_id,organization_id);

create table public.plan_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users,
  context jsonb not null default '{}' check(jsonb_typeof(context)='object'),
  file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
  file_name text not null check(length(file_name) between 1 and 500),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check(file_size between 1 and 20971520),
  page_count integer check(page_count between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(id,project_id,organization_id,document_id),
  foreign key(document_id,project_id,organization_id) references public.documents(id,project_id,organization_id) on delete cascade
);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  page integer not null check(page between 1 and 1000),
  width double precision not null check(width>0 and width<'Infinity'::float8),
  height double precision not null check(height>0 and height<'Infinity'::float8),
  rotation integer not null default 0 check(rotation in (0,90,180,270)),
  page_kind text not null default 'unknown',
  created_at timestamptz not null default now(),
  unique(document_id,page),
  foreign key(document_id,project_id,organization_id) references public.documents(id,project_id,organization_id) on delete cascade
);

create table public.plan_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  page integer not null check(page between 1 and 1000),
  state text not null default 'queued' check(state in ('queued','processing','complete','failed')),
  attempts integer not null default 0 check(attempts>=0),
  max_attempts integer not null default 3 check(max_attempts between 1 and 5),
  pipeline_version text not null default 'floor-plan-v1' check(length(pipeline_version) between 1 and 120),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb,
  result_sha256 text check(result_sha256 ~ '^[a-f0-9]{64}$'),
  claimed_by uuid references auth.users,
  lease_expires_at timestamptz,
  lease_token uuid,
  heartbeat_at timestamptz,
  unique(review_id,page,pipeline_version),
  unique(id,review_id,project_id,organization_id,document_id),
  check(attempts<=max_attempts),
  check((state='complete')=(result is not null)),
  check(state<>'complete' or (result_sha256 is not null and finished_at is not null)),
  check(state<>'processing' or (claimed_by is not null and lease_expires_at is not null and lease_token is not null)),
  foreign key(review_id,project_id,organization_id,document_id) references public.plan_reviews(id,project_id,organization_id,document_id) on delete cascade
);
create index plan_job_queue on public.plan_analysis_jobs(created_at) where state in ('queued','processing');
create index plan_job_scope on public.plan_analysis_jobs(organization_id,review_id);

create table public.extracted_elements (
  job_id uuid not null,
  review_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  element_id text not null check(length(element_id) between 1 and 128),
  page integer not null check(page between 1 and 1000),
  kind text not null check(kind in ('room_label','dimension','scale','door_schedule','window_schedule','annotation')),
  bbox jsonb not null check(jsonb_typeof(bbox)='object'),
  original jsonb not null check(jsonb_typeof(original)='object'),
  created_at timestamptz not null default now(),
  primary key(job_id,element_id),
  unique(job_id,element_id,review_id,project_id,organization_id,document_id),
  foreign key(job_id,review_id,project_id,organization_id,document_id) references public.plan_analysis_jobs(id,review_id,project_id,organization_id,document_id) on delete cascade
);

create table public.user_corrections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  review_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  element_id text not null,
  status text not null check(status in ('confirmed','corrected','rejected','irrelevant')),
  correction jsonb not null check(jsonb_typeof(correction)='object'),
  author_id uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  foreign key(job_id,element_id,review_id,project_id,organization_id,document_id) references public.extracted_elements(job_id,element_id,review_id,project_id,organization_id,document_id) on delete cascade
);
create index plan_correction_history on public.user_corrections(review_id,job_id,element_id,created_at);

-- Clients cannot write derived data or change a worker lease directly.
do $$declare t text; begin
  foreach t in array array['plan_reviews','document_pages','plan_analysis_jobs','extracted_elements','user_corrections'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_member(organization_id))',t);
  end loop;
end$$;
create policy review_create on public.plan_reviews for insert to authenticated with check(public.is_member(organization_id) and owner_id=auth.uid());
create policy review_update on public.plan_reviews for update to authenticated using(public.is_member(organization_id)) with check(public.is_member(organization_id));
create policy review_delete on public.plan_reviews for delete to authenticated using(public.is_member(organization_id));
revoke update on public.plan_reviews from authenticated;
grant update(context,page_count) on public.plan_reviews to authenticated;
create policy job_create on public.plan_analysis_jobs for insert to authenticated with check(public.is_member(organization_id) and state='queued' and attempts=0 and max_attempts=3 and result is null and result_sha256 is null and claimed_by is null and lease_expires_at is null and started_at is null and finished_at is null and error is null and heartbeat_at is null and lease_token is null);
create policy correction_create on public.user_corrections for insert to authenticated with check(public.is_member(organization_id) and author_id=auth.uid() and exists(select 1 from public.plan_analysis_jobs j where j.id=job_id and j.state='complete' and j.organization_id=user_corrections.organization_id));

-- Lease ownership is the authenticated worker's user. A worker uses a scoped user
-- session; the application never needs a service-role key. Members can see only
-- their organization's jobs, including when a lease expires after a worker crash.
create function public.claim_plan_job() returns setof public.plan_analysis_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare selected_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update plan_analysis_jobs set state='failed',finished_at=now(),error='Worker lease expired after final attempt',lease_expires_at=null
    where state='processing' and lease_expires_at<now() and attempts>=max_attempts and public.is_member(organization_id);
  select id into selected_id from plan_analysis_jobs
    where public.is_member(organization_id) and attempts<max_attempts and (state='queued' or (state='processing' and lease_expires_at<now()))
    order by created_at,id for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update plan_analysis_jobs set state='processing',attempts=attempts+1,claimed_by=auth.uid(),started_at=now(),finished_at=null,error=null,heartbeat_at=now(),lease_expires_at=now()+interval '5 minutes',lease_token=gen_random_uuid() where id=selected_id returning *;
end$$;

create function public.heartbeat_plan_job(job_id uuid,lease_id uuid) returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare lease timestamptz;
begin
  update plan_analysis_jobs set heartbeat_at=now(),lease_expires_at=now()+interval '5 minutes'
    where id=job_id and state='processing' and claimed_by=auth.uid() and lease_token=lease_id and lease_expires_at>=now() and public.is_member(organization_id) returning lease_expires_at into lease;
  if lease is null then raise exception 'Active owned job not found'; end if;
  return lease;
end$$;

create function public.complete_plan_job(job_id uuid,result_data jsonb,result_sha text,lease_id uuid) returns public.plan_analysis_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.plan_analysis_jobs; observation jsonb; bounds jsonb; p jsonb;
begin
  select * into job from plan_analysis_jobs where id=job_id and state='processing' and claimed_by=auth.uid() and lease_token=lease_id and lease_expires_at>=now() and public.is_member(organization_id) for update;
  if job.id is null then raise exception 'Active owned job not found'; end if;
  if result_sha !~ '^[a-f0-9]{64}$' or result_sha is null then raise exception 'Invalid result checksum'; end if;
  if result_data is null or jsonb_typeof(result_data)<>'object' or jsonb_typeof(result_data->'elements') is distinct from 'array' or jsonb_typeof(result_data->'page') is distinct from 'object' or jsonb_typeof(result_data->'pageCount') is distinct from 'number' or length(coalesce(result_data->>'schemaVersion',''))=0 then raise exception 'Invalid extraction envelope'; end if;
  if (result_data->>'pageCount')::integer not between job.page and 1000 then raise exception 'Invalid extraction page count'; end if;
  if octet_length(result_data::text)>15728640 or jsonb_array_length(result_data->'elements')>10000 then raise exception 'Extraction too large'; end if;
  if result_data->>'sourceSha256' is distinct from (select file_sha256 from plan_reviews where id=job.review_id) then raise exception 'Source checksum mismatch'; end if;
  p=result_data->'page';
  if (p->>'number')::integer is distinct from job.page then raise exception 'Extraction page mismatch'; end if;
  insert into document_pages(organization_id,project_id,document_id,page,width,height,rotation,page_kind)
    values(job.organization_id,job.project_id,job.document_id,job.page,(p->>'width')::float8,(p->>'height')::float8,coalesce((p->>'rotation')::integer,0),coalesce(p->>'kind','unknown'))
    on conflict(document_id,page) do update set width=excluded.width,height=excluded.height,rotation=excluded.rotation,page_kind=excluded.page_kind;
  for observation in select value from jsonb_array_elements(result_data->'elements') loop
    bounds=observation->'bbox';
    if observation->>'verification' is distinct from 'unreviewed' or (observation->>'page')::integer is distinct from job.page then raise exception 'Invalid observation provenance'; end if;
    if jsonb_typeof(bounds) is distinct from 'object' or not(bounds ?& array['x','y','width','height']) then raise exception 'Missing observation coordinates'; end if;
    if jsonb_typeof(bounds->'x') is distinct from 'number' or jsonb_typeof(bounds->'y') is distinct from 'number' or jsonb_typeof(bounds->'width') is distinct from 'number' or jsonb_typeof(bounds->'height') is distinct from 'number' then raise exception 'Invalid observation coordinates'; end if;
    if not((bounds->>'x')::numeric between 0 and 1 and (bounds->>'y')::numeric between 0 and 1 and (bounds->>'width')::numeric>0 and (bounds->>'height')::numeric>0 and (bounds->>'x')::numeric+(bounds->>'width')::numeric<=1.002 and (bounds->>'y')::numeric+(bounds->>'height')::numeric<=1.002) then raise exception 'Invalid observation coordinates'; end if;
    insert into extracted_elements(job_id,review_id,organization_id,project_id,document_id,element_id,page,kind,bbox,original)
      values(job.id,job.review_id,job.organization_id,job.project_id,job.document_id,observation->>'id',job.page,observation->>'kind',bounds,observation);
  end loop;
  update plan_analysis_jobs set state='complete',result=result_data,result_sha256=result_sha,finished_at=now(),lease_expires_at=null,error=null where id=job.id returning * into job;
  update plan_reviews set page_count=(result_data->>'pageCount')::integer where id=job.review_id and page_count is null;
  return job;
end$$;

create function public.fail_plan_job(job_id uuid,error_message text,retryable boolean,lease_id uuid) returns public.plan_analysis_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.plan_analysis_jobs;
begin
  update plan_analysis_jobs set state=case when retryable and attempts<max_attempts then 'queued' else 'failed' end,error=left(error_message,2000),finished_at=now(),lease_expires_at=null,claimed_by=null
    where id=job_id and state='processing' and claimed_by=auth.uid() and lease_token=lease_id and lease_expires_at>=now() and public.is_member(organization_id) returning * into job;
  if job.id is null then raise exception 'Active owned job not found'; end if;
  return job;
end$$;

create function public.retry_plan_job(job_id uuid) returns public.plan_analysis_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.plan_analysis_jobs;
begin
  update plan_analysis_jobs set state='queued',error=null,finished_at=null,claimed_by=null,lease_expires_at=null
    where id=job_id and state='failed' and attempts<max_attempts and public.is_member(organization_id) returning * into job;
  if job.id is null then raise exception 'Retryable job not found'; end if;
  return job;
end$$;

revoke all on function public.claim_plan_job(),public.heartbeat_plan_job(uuid,uuid),public.complete_plan_job(uuid,jsonb,text,uuid),public.fail_plan_job(uuid,text,boolean,uuid),public.retry_plan_job(uuid) from public;
grant execute on function public.claim_plan_job(),public.heartbeat_plan_job(uuid,uuid),public.complete_plan_job(uuid,jsonb,text,uuid),public.fail_plan_job(uuid,text,boolean,uuid),public.retry_plan_job(uuid) to authenticated;

-- Regulatory authority is publication-controlled; customer observations can never
-- activate or replace a verified government source or executable rule version.
create table public.code_sources (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id text not null references public.jurisdictions,
  title text not null,
  source_url text not null check(source_url like 'https://%'),
  publisher text not null,
  retrieved_at timestamptz not null,
  content_sha256 text check(content_sha256 ~ '^[a-f0-9]{64}$'),
  verification_status text not null default 'unverified' check(verification_status in ('unverified','verified','retired')),
  verified_at timestamptz,
  verified_by text,
  unique(id,jurisdiction_id),
  check(verification_status<>'verified' or (verified_at is not null and verified_by is not null and content_sha256 is not null))
);
create table public.code_editions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id text not null references public.jurisdictions,
  source_id uuid not null,
  name text not null,
  effective_from date not null,
  effective_until date,
  verification_status text not null default 'unverified' check(verification_status in ('unverified','verified','retired')),
  unique(id,jurisdiction_id),
  check(effective_until is null or effective_until>effective_from),
  foreign key(source_id,jurisdiction_id) references public.code_sources(id,jurisdiction_id)
);
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id text not null references public.jurisdictions,
  code text not null unique,
  title text not null,
  unique(id,jurisdiction_id)
);
create table public.compliance_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  jurisdiction_id text not null,
  code_edition_id uuid not null,
  source_id uuid not null,
  version integer not null check(version>0),
  source_section text not null,
  source_excerpt text not null,
  effective_from date not null,
  effective_until date,
  verified_at timestamptz,
  verified_by text,
  status text not null default 'draft' check(status in ('draft','verified','retired')),
  executor_key text not null,
  executor_version text not null,
  applicability jsonb not null check(jsonb_typeof(applicability)='object'),
  parameters jsonb not null default '{}' check(jsonb_typeof(parameters)='object'),
  limitations text not null,
  unique(rule_id,version),
  unique(id,jurisdiction_id,code_edition_id),
  check(effective_until is null or effective_until>effective_from),
  check(status<>'verified' or (verified_at is not null and verified_by is not null)),
  foreign key(rule_id,jurisdiction_id) references public.compliance_rules(id,jurisdiction_id),
  foreign key(source_id,jurisdiction_id) references public.code_sources(id,jurisdiction_id),
  foreign key(code_edition_id,jurisdiction_id) references public.code_editions(id,jurisdiction_id)
);

create table public.compliance_evaluations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  job_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  jurisdiction_id text not null,
  code_edition_id uuid not null,
  jurisdiction_evidence jsonb not null check(jsonb_typeof(jurisdiction_evidence)='object'),
  permit_application_date date not null,
  project_classification text not null,
  applicability_snapshot jsonb not null,
  observations_sha256 text not null check(observations_sha256 ~ '^[a-f0-9]{64}$'),
  evaluator_version text not null,
  created_at timestamptz not null default now(),
  unique(id,jurisdiction_id,code_edition_id),
  unique(id,review_id,project_id,organization_id,document_id),
  foreign key(job_id,review_id,project_id,organization_id,document_id) references public.plan_analysis_jobs(id,review_id,project_id,organization_id,document_id) on delete cascade,
  foreign key(code_edition_id,jurisdiction_id) references public.code_editions(id,jurisdiction_id)
);
create table public.compliance_findings (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  rule_version_id uuid not null,
  jurisdiction_id text not null,
  code_edition_id uuid not null,
  status text not null check(status in ('pass','potential_issue','unknown','professional_review','not_applicable')),
  explanation text not null,
  evidence jsonb not null,
  recommended_action text not null,
  locations jsonb not null default '[]' check(jsonb_typeof(locations)='array'),
  foreign key(evaluation_id,jurisdiction_id,code_edition_id) references public.compliance_evaluations(id,jurisdiction_id,code_edition_id) on delete cascade,
  foreign key(rule_version_id,jurisdiction_id,code_edition_id) references public.compliance_rule_versions(id,jurisdiction_id,code_edition_id)
);
create table public.plan_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  evaluation_id uuid,
  report_kind text not null check(report_kind in ('extraction_preliminary','verified_rule_review')),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  check((report_kind='verified_rule_review')=(evaluation_id is not null)),
  foreign key(review_id,project_id,organization_id,document_id) references public.plan_reviews(id,project_id,organization_id,document_id) on delete cascade,
  foreign key(evaluation_id,review_id,project_id,organization_id,document_id) references public.compliance_evaluations(id,review_id,project_id,organization_id,document_id)
);
do $$declare t text; begin
  foreach t in array array['code_sources','code_editions','compliance_rules','compliance_rule_versions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy regulatory_read on public.%I for select to authenticated using(true)',t);
  end loop;
  foreach t in array array['compliance_evaluations','plan_report_snapshots'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_member(organization_id))',t);
  end loop;
end$$;
alter table public.compliance_findings enable row level security;
create policy finding_read on public.compliance_findings for select to authenticated using(exists(select 1 from public.compliance_evaluations e where e.id=evaluation_id and public.is_member(e.organization_id)));
create policy preliminary_report_create on public.plan_report_snapshots for insert to authenticated with check(public.is_member(organization_id) and report_kind='extraction_preliminary' and evaluation_id is null);
