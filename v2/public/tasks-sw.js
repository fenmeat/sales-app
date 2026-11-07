// No task data, attachments or authenticated pages are cached on shared phones.
self.addEventListener('push',event=>{let m;try{m=event.data.json();}catch{return;}
 const u=new URL(m.url||'/tasks',self.location.origin);if(u.origin!==self.location.origin||u.pathname!=='/tasks')return;
 event.waitUntil(self.registration.showNotification('FenMeat Tasks',{body:m.body||'You have a task update.',tag:m.tag,icon:'/tasks-icon.svg',data:{url:u.href}}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const u=new URL(event.notification.data?.url||'/tasks',self.location.origin);if(u.origin!==self.location.origin)return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).pathname==='/tasks');if(existing){await existing.navigate(u.href);await existing.focus();}else await self.clients.openWindow(u.href);})());});
