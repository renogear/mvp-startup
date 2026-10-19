import {loadEnvConfig} from '@next/env';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {claimJob,filePath,finishJob,failJob} from '../src/lib/plan/local-store';
import {resultSchema} from '../src/lib/plan/schema';
loadEnvConfig(process.cwd());
const execute=promisify(execFile);
let running=true;
process.on('SIGINT',()=>{running=false});process.on('SIGTERM',()=>{running=false});
async function work(){const job=claimJob();if(!job)return false;console.log(`Processing job ${job.id}, page ${job.page}, attempt ${job.attempts}`);try{const {stdout}=await execute(process.env.PERMITPILOT_PYTHON||'python',[resolve('processor/extract.py'),filePath(job.reviewId),'--page',String(job.page),'--document-id',job.reviewId],{timeout:120000,maxBuffer:32*1024*1024,env:{...process.env,OMP_NUM_THREADS:'2'}});const result=resultSchema.parse(JSON.parse(stdout));if(result.documentId!==job.reviewId||result.page.number!==job.page)throw new Error('Processor result identity mismatch');finishJob(job,result);console.log(`Completed ${job.id}: ${result.elements.length} candidates, ${result.metrics.processingMs} ms`)}catch(e){const err=e as Error&{stderr?:string};const message=err.stderr?.trim().slice(-500)||err.message;failJob(job,message);console.error(`Failed job ${job.id}: ${message}`)}return true}
async function main(){console.log('PermitPilot local extraction worker ready; no compliance rules activated.');if(process.argv.includes('--once')){await work();return}while(running){const processed=await work();if(!processed)await new Promise(resolve=>setTimeout(resolve,750))}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
