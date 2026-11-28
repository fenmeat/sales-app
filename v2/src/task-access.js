import {isAdmin} from './auth.js';

export const isTaskManager = username => isAdmin(username) || ['xalinda','xavier'].includes(username);
export const taskVisibility = task => task.visibility || (task.kind === 'stocktake' ? 'operational' : 'assigned');

export function fullTaskAccess(user, task) {
 if (taskVisibility(task)==='private') return user.username==='alex';
 if (isAdmin(user.username)) return true;
 const visibility = taskVisibility(task);
 if (visibility === 'confidential') return false;
 return task.assigned_to === user.username ||
  (isTaskManager(user.username) && (visibility === 'operational' || task.visibility==='assigned' && task.created_by === user.username));
}
export function canSeeTask(user, task) {
 return fullTaskAccess(user, task) || (!['confidential','private'].includes(taskVisibility(task)) && task.steps?.some(s => s.assigned_to === user.username));
}
export function canManageTask(user, task) {
 if (taskVisibility(task)==='private') return user.username==='alex';
 if (isAdmin(user.username)) return true;
 return isTaskManager(user.username) && fullTaskAccess(user,task) && (taskVisibility(task)==='operational'||task.created_by===user.username) && task.kind !== 'po_dispatch';
}
export function taskReadScope(user, mine=false) {
 const own = "(json_extract(e.payload,'$.assigned_to')=? OR EXISTS (SELECT 1 FROM json_each(e.payload,'$.steps') st WHERE json_extract(st.value,'$.assigned_to')=?))";
 const privateGuard="coalesce(json_extract(e.payload,'$.visibility'),'')<>'private'";
 if (isAdmin(user.username)) return {sql:(user.username==='alex'?'1':privateGuard)+(mine?' AND '+own:''),params:mine?[user.username,user.username]:[]};
 const visibility = "coalesce(json_extract(e.payload,'$.visibility'),CASE WHEN json_extract(e.payload,'$.kind')='stocktake' THEN 'operational' ELSE 'assigned' END)";
 const team = !mine && isTaskManager(user.username);
 return {sql:`${visibility} NOT IN ('confidential','private') AND (${own}${team ? " OR "+visibility+"='operational' OR (json_extract(e.payload,'$.visibility')='assigned' AND json_extract(e.payload,'$.created_by')=?)" : ''})`,
  params:team?[user.username,user.username,user.username]:[user.username,user.username]};
}
export function taskView(user, task) {
 if (!task || !canSeeTask(user,task)) return null;
 const visibility=taskVisibility(task);
 if (fullTaskAccess(user,task)) return {...task,visibility,can_manage:canManageTask(user,task)};
 // A delegated step shares the parent title and the employee's instructions only.
 const steps=task.steps.filter(s=>s.assigned_to===user.username);
 return {id:task.id,title:task.title,kind:task.kind,task_type:task.task_type,status:task.status,
  assigned_to:task.assigned_to,revision:task.revision,visibility,priority:task.priority,
  steps,step_only:true,can_manage:false};
}
export function stepFileAccess(user, task, id) {
 return task.steps?.some(s=>s.assigned_to===user.username &&
  (s.attachments?.includes(id)||s.completion?.attachments?.includes(id)));
}
