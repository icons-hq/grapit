import json, statistics
from pathlib import Path

root=Path(__file__).resolve().parent
state=json.loads((root/'comparison-state.json').read_text())
routes=['checkout.prepare','seat.lock','queue.enter','seat.read','performance.detail','checkout.confirm','queue.status','socket.seat-update']
rows=[]
for execution in state['runs']:
    label=execution['label'];path=root/(label+'-result.json')
    if not path.exists():
        continue
    result=json.loads(path.read_text())
    expected=json.loads((root/('built-'+execution['variant'])/'image.json').read_text())
    config=json.loads((root/(label+'-resource-config.json')).read_text())
    assert config['isolatedApi']['image']==expected['rehearsalImage'], 'API image differs from frozen variant'
    assert result['sourceImage']==expected['sourceImage'], 'Load runner source metadata differs from frozen variant'
    assert config['isolatedApi']['settings']['QUEUE_MAX_ACTIVE_ADMISSIONS']=='200'
    assert config['isolatedApi']['settings']['DB_POOL_MAX']=='5'
    assert config['isolatedSql']['name']=='grabit-db-releaseab-20261028' and config['isolatedSql']['tier']=='db-f1-micro'
    assert config['isolatedValkey']['name'].endswith('/grabit-valkey-releaseab-20261028')
    assert not result['workload']['profilingEnabled'] and result['workload']['confirmCadenceMs']==1000
    waves=result.get('waves',[])
    completed=len(waves)==1 and waves[0].get('invariantsPassed') is True
    metrics=waves[0]['metrics'] if len(waves)==1 else result.get('partialMetrics',{})
    row={'label':label,'variant':execution['variant'],'startedAt':result['startedAt'],'completedAt':result['completedAt'],'execution':execution['execution'],'apiRevision':execution['apiRevision'],'frozenImageAndConfigurationVerified':True,'full600SaleRun':completed,'status':result['status'],'p95Ms':{route:metrics[route]['p95Ms'] for route in routes if route in metrics},'errors':{route:{'unexpected':m['unexpectedErrors'],'requests':m['requests'],'rate':m['errorRate']} for route,m in metrics.items() if m['unexpectedErrors']},'allRequestsErrorFree':all(m['unexpectedErrors']==0 for m in metrics.values())}
    prepare=metrics.get('checkout.prepare',{})
    row['prepareRequests']=prepare.get('requests',0)
    row['prepareSuccessfulResponses']=prepare.get('statuses',{}).get('201',0)
    row['full600PrepareMeasurement']=prepare.get('requests')==600
    if completed:
        wave=waves[0]
        row.update({'checkout':wave['checkout'],'peakAdmissions':wave['peakActiveAdmissions'],'remainingWaiting':wave['finalWaiting'],'paymentConfirmTargetPassed':wave['paymentConfirmTargetPassed'],'allLatencyTargetsPassed':wave['latencyTargetsPassed'],'existingPerRouteErrorRateTargetPassed':all(m['errorRate']<.01 for m in metrics.values()),'allSloPassed':wave['sloPassed'],'durationMs':wave['durationMs']})
    else:
        row['partialMetricsOnly']=True
    rows.append(row)

groups={variant:[row for row in rows if row['variant']==variant and row['full600SaleRun']] for variant in ['a','b']}
primary_groups={variant:[row for row in rows if row['variant']==variant and row['full600PrepareMeasurement']] for variant in ['a','b']}
primary=None
if all(primary_groups.values()):
    samples={v:[r['p95Ms']['checkout.prepare'] for r in group] for v,group in primary_groups.items()}
    med={v:statistics.median(values) for v,values in samples.items()}
    primary={'metric':'checkout.prepare p95','qualification':'all three cohorts / 600 client prepare attempts using the original metrics algorithm, including errors and 30-second client timeouts; successful response count and failed sales are reported separately','a':{'n':len(samples['a']),'median':med['a'],'values':samples['a'],'labels':[r['label'] for r in primary_groups['a']]},'b':{'n':len(samples['b']),'median':med['b'],'values':samples['b'],'labels':[r['label'] for r in primary_groups['b']]},'observedChangePercent':round((med['b']/med['a']-1)*100,2),'observedChangeMs':med['b']-med['a']}
summary={}
for route in routes:
    values={variant:[row['p95Ms'][route] for row in group] for variant,group in groups.items()}
    if not all(values.values()):
        continue
    medians={variant:statistics.median(v) for variant,v in values.items()}
    summary[route]={'a':{'n':len(values['a']),'median':medians['a'],'min':min(values['a']),'max':max(values['a']),'values':values['a']},'b':{'n':len(values['b']),'median':medians['b'],'min':min(values['b']),'max':max(values['b']),'values':values['b']},'observedChangePercent':round((medians['b']/medians['a']-1)*100,2),'observedChangeMs':medians['b']-medians['a']}
proof={'status':'complete' if state['stage']=='comparison-complete' else 'in_progress','replicationUnit':'one execution; summaries are medians of run p95, not pooled request p95','rows':rows,'completeRunCounts':{v:len(g) for v,g in groups.items()},'primaryPrepareComparison':primary,'fullSaleRunSecondarySummary':summary,'statisticalSignificanceClaimed':False,'notes':['Incomplete prepare measurements are excluded from the primary prepare comparison.','A3 completed all 600 prepare responses before a later confirmation failed; B3 recorded 600 prepare attempts including two client timeouts. Neither is relabeled a completed 600-sale run.','Partial failed sales are excluded from full-sale-run secondary latency medians.','A completed run with transient request errors remains a completed run; its errors are reported separately and are not relabeled as zero.','The original load harness requires each route error rate below 1%; zero-error achievement and absolute latency SLO are reported separately.','The orchestration helper originally labeled only error-free runs eligible; analysis derives completion from the original result instead of that overly broad label.']}
(root/'repeated-comparison.json').write_text(json.dumps(proof,indent=2))
print(json.dumps({'status':proof['status'],'completeRunCounts':proof['completeRunCounts'],'runs':[{'label':r['label'],'complete':r['full600SaleRun'],'prepareRequests':r['prepareRequests'],'prepareSuccessfulResponses':r['prepareSuccessfulResponses'],'prepareP95':r['p95Ms'].get('checkout.prepare'),'errors':r['errors']} for r in rows],'primaryPrepareComparison':primary},ensure_ascii=False))
