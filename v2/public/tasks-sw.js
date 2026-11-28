// No task data, attachments or authenticated pages are cached on shared phones.
self.addEventListener('push',event=>{let m;try{m=event.data.json();}catch{return;}
 const u=new URL(m.url||'/tasks',self.location.origin);if(u.origin!==self.location.origin||u.pathname!=='/tasks')return;
 event.waitUntil((async()=>{
  // A subscription can outlive logout on a shared device. Verify the current
  // session before showing even a task identifier or a generic private alert.
  try{const response=await fetch('/api/navigation',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok||!m.username||(await response.json()).username!==m.username)return;
   await self.registration.showNotification('FenMeat Tasks',{body:m.body||'You have a task update.',tag:m.tag,icon:'/tasks-icon.svg',data:{url:u.href}});
  }catch{/* Offline or signed out: do not disclose another user's notification. */}
 })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const u=new URL(event.notification.data?.url||'/tasks',self.location.origin);if(u.origin!==self.location.origin)return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).pathname==='/tasks');if(existing){await existing.navigate(u.href);await existing.focus();}else await self.clients.openWindow(u.href);})());});
