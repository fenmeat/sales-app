import {check,dateKey} from './domain.js';

export const canReadRabbi=user=>['alex','alinda','xalinda','xavier'].includes(user.username);
// Share the reading itself, never the surrounding private report, links or replies.
export function rabbiReading(report,owner=false){
 const section=report?.sections.find(s=>s.id==='rabbi');
 return section?{date:report.date,title:section.title,items:section.items.filter(i=>owner||!i.requires_action&&!i.pa_task_ids?.length&&!i.app_task_ids?.length).map(({id,title,text})=>({id,title,text}))}:null;
}

export async function readSharedRabbi(db,user,requestedDate){
 check(canReadRabbi(user),'Hierdie rekening het nie toegang tot Rabbi nie.',403);
 const dates=(await db.prepare("SELECT DISTINCT resource_key FROM v2_pa_report_versions WHERE resource_key BETWEEN 'report-' AND 'report.' ORDER BY resource_key DESC LIMIT 30").all()).results.map(r=>({date:r.resource_key.slice(7)}));
 const date=requestedDate?dateKey(requestedDate):dates[0]?.date;
 const saved=date?await db.prepare('SELECT payload FROM v2_pa_report_versions WHERE resource_key=? ORDER BY revision DESC LIMIT 1').bind('report-'+date).first():null;
 return {rabbi:rabbiReading(saved?JSON.parse(saved.payload):null),rabbi_history:dates,
  report:null,history:[],rows:[],feedback:[]};
}
