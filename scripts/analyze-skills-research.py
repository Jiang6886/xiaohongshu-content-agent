import json
import time
from pathlib import Path
import httpx

root=Path(__file__).resolve().parents[1]
record=root/'data/audit-skills/run.json'
state=json.loads(record.read_text())
with httpx.Client(base_url='http://127.0.0.1:8000/api/v1',timeout=20) as client:
    response=client.post('/research-runs/'+state['research_run_id']+'/topic-jobs',headers={'Idempotency-Key':'skills-qwen-json-fix-20260926'})
    response.raise_for_status()
    state['analysis_job_id']=response.json()['job_id']
    record.write_text(json.dumps(state,ensure_ascii=False,indent=2))
    for _ in range(20):
        response=client.get('/jobs/'+state['analysis_job_id']);response.raise_for_status();job=response.json()
        print(json.dumps({k:job[k] for k in ('id','status','error','usage')},ensure_ascii=False),flush=True)
        if job['status'] in {'completed','failed','partial','cancelled'}:
            (root/'data/audit-skills/analysis-job.json').write_text(json.dumps(job,ensure_ascii=False,indent=2))
            break
        time.sleep(10)
