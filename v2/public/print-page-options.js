// Only these authenticated document endpoints may be opened by the print page.
// The URL contains document selectors, never PDF bytes, cookies or access keys.
export function printPageOptions(search){
 const p=new URLSearchParams(search),kind=p.get('document'),date=p.get('date'),route=p.get('route'),revision=p.get('revision');
 if(!['production','stock'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date??''))throw Error('Choose a saved document in FenMeat first.');
 if(kind==='stock'&&!/^[A-Z0-9_-]{1,20}$/.test(route??''))throw Error('Choose a saved route in FenMeat first.');
 if(revision!==null&&(!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision))))throw Error('This document revision is invalid.');
 const query=new URLSearchParams({date});if(kind==='stock')query.set('route',route);if(revision!==null)query.set('revision',revision);
 return {url:'/api/print/'+kind+'?'+query,title:kind==='production'?'Production staff sheet':'Stock Load & Return',filename:'FenMeat-'+(kind==='production'?'Production-':'Stock-')+date+(kind==='stock'?'-'+route:'')+'.pdf',unsaved:p.get('unsaved')==='1',returnPath:kind==='production'?'/production':'/'};
}

export function browserPrintURL(pdfURL,{revision,unsaved=false}={}){
 const source=new URL(pdfURL,'https://fenmeat.invalid');
 if(source.origin!=='https://fenmeat.invalid'||!/^\/api\/print\/(production|stock)$/.test(source.pathname))throw Error('This document has no browser print page.');
 const kind=source.pathname.split('/').at(-1),p=new URLSearchParams({document:kind,date:source.searchParams.get('date')??''});
 if(kind==='stock')p.set('route',source.searchParams.get('route')??'');
 const savedRevision=revision??source.searchParams.get('revision');if(savedRevision)p.set('revision',savedRevision);if(unsaved)p.set('unsaved','1');
 printPageOptions(p);
 return '/print-page?'+p;
}

export function usesAppleHomeScreen(nav,media){
 const apple=/iPhone|iPad|iPod/.test(nav.userAgent??'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 return apple&&(nav.standalone===true||media?.('(display-mode: standalone)').matches===true);
}
