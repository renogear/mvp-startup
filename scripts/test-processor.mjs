import {spawnSync} from 'node:child_process';
const result=spawnSync(process.env.PERMITPILOT_PYTHON||'python',['-m','unittest','discover','-s','tests/python','-v'],{stdio:'inherit'});
process.exit(result.status??1);
