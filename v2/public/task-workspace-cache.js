// Memory only: no private report or task body is persisted on shared devices.
export function createWorkspaceCache(fetcher){
 const cache=new Map(),pending=new Map();let epoch=0,username=null;
 const clear=()=>{epoch++;cache.clear();pending.clear();};
 return {
  peek:key=>cache.get(key)?.value,
  clear,
  async read(key){
   if(pending.has(key))return pending.get(key);
   const generation=epoch,old=cache.get(key);
   const promise=(async()=>{
    const response=await fetcher(key,{headers:old?{'If-None-Match':old.etag}:{}});
    if(generation!==epoch)return {obsolete:true};
    if(response.status===304&&old)return {value:old.value,unchanged:true};
    const value=await response.json();
    if(!response.ok){if([401,403].includes(response.status)){clear();username=null;}const error=Error(value.error||'Die taaklys kon nie laai nie. Probeer weer.');error.status=response.status;throw error;}
    if(generation!==epoch)return {obsolete:true};
    if(!value.pa?.workspace)return {unsupported:true};
    if(username&&username!==value.app.username){cache.clear();epoch++;}
    username=value.app.username;
    const previous=cache.get(key)?.value?.pa.workspace.snapshot;
    if(previous&&previous!==value.pa.workspace.snapshot)for(const [k,v]of cache)if(v.value.pa.workspace.scope===value.pa.workspace.scope&&v.value.pa.workspace.status===value.pa.workspace.status&&v.value.pa.workspace.search===value.pa.workspace.search)cache.delete(k);
    cache.set(key,{value,etag:value.etag});
    while(cache.size>24)cache.delete(cache.keys().next().value);
    return {value};
   })();
   pending.set(key,promise);
   try{return await promise;}finally{if(pending.get(key)===promise)pending.delete(key);}
  }
 };
}
