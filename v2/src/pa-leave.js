import {isAdmin} from './auth.js';
import {check} from './domain.js';
import {staffApi} from './staff-api.js';

export const LEAVE_SCOPE='fenmeat:staff:leave';
export const LEAVE_SCOPES=['fenmeat:read','fenmeat:staff:read',LEAVE_SCOPE];

// Register a pending request through the same revision, locked-week and replay
// checks as the Staff screen. Approval remains a separate action in Staff.
export async function requestLeave(data,env,username,scopes){
  check(isAdmin(username)&&LEAVE_SCOPES.every(scope=>scopes.includes(scope)),
    'Gee afsonderlike toestemming om verlof te registreer.',403);
  const url=new URL('https://fenmeat.invalid/api/staff');
  const command={...data,action:'leave_request'};
  const result=await staffApi({request:new Request(url,{method:'POST'}),url,env,user:{username},bodyOf:async()=>command});
  return {...result,record_id:data.record_id};
}
