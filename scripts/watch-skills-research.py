import json
import time
from pathlib import Path
import httpx

root = Path(__file__).resolve().parents[1]
record = root / 'data/audit-skills/run.json'
state = json.loads(record.read_text())
with httpx.Client(base_url='http://127.0.0.1:8000/api/v1', timeout=20) as client:
    job = client.get('/jobs/' + state['job_id']).json()
    if job['status'] in {'failed', 'partial'}:
        response = client.post('/jobs/' + state['job_id'] + '/retry', headers={'Idempotency-Key': 'skills-research-login-restored-20260926'})
        response.raise_for_status()
        state.setdefault('previous_jobs', []).append(state['job_id'])
        state['job_id'] = response.json()['job_id']
        record.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    previous = None
    for _ in range(90):
        response = client.get('/jobs/' + state['job_id'])
        response.raise_for_status()
        job = response.json()
        summary = {k: job[k] for k in ('id','status','progress','completed_count','total_count','error','usage')}
        if summary != previous:
            print(json.dumps(summary, ensure_ascii=False), flush=True)
            previous = summary
        if job['status'] in {'failed','partial','completed','cancelled'}:
            (root / 'data/audit-skills/final-job.json').write_text(json.dumps(job, ensure_ascii=False, indent=2))
            break
        time.sleep(15)
