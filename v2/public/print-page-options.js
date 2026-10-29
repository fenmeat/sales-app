// Only these authenticated document endpoints may be opened by the print page.
// The URL contains document selectors, never PDF bytes, cookies or access keys.
// Supplier keys follow supplierGroups: lowercase, trimmed, single spaces.
// An explicit empty key selects "Supplier not assigned"; the endpoint checks membership.
const validSupplierKey=value=>typeof value==='string'&&value.length<=150&&value===value.trim().toLowerCase().replace(/\s+/g,' ')&&(value===''||/^[\p{L}\p{N}][\p{L}\p{N} &'’().,_+-]*$/u.test(value));
const supplierFilename=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'unassigned';
export function printPageOptions(search){
 const p=new URLSearchParams(search),kind=p.get('document'),date=p.get('date'),route=p.get('route'),supplier=p.get('supplier'),revision=p.get('revision');
 if(!['production','stock','stocktake'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(date??''))throw Error('Choose a saved document in FenMeat first.');
 if(kind==='stock'&&!/^[A-Z0-9_-]{1,20}$/.test(route??''))throw Error('Choose a saved route in FenMeat first.');
 if(kind==='stocktake'&&(!p.has('supplier')||!validSupplierKey(supplier)))throw Error('Choose a saved supplier in FenMeat first.');
 if(revision!==null&&(!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision))))throw Error('This document revision is invalid.');
 const query=new URLSearchParams({date});if(kind==='stock')query.set('route',route);if(kind==='stocktake')query.set('supplier',supplier);if(revision!==null)query.set('revision',revision);
 const title=kind==='production'?'Production staff sheet':kind==='stocktake'?'Stocktake Summary':'Stock Load & Return';
 const filename=kind==='stocktake'?'FenMeat-Stocktake-'+supplierFilename(supplier)+'-'+date+'.pdf':'FenMeat-'+(kind==='production'?'Production-':'Stock-')+date+(kind==='stock'?'-'+route:'')+'.pdf';
 return {url:'/api/print/'+kind+'?'+query,title,filename,unsaved:p.get('unsaved')==='1',fitPage:kind==='stocktake',returnPath:kind==='production'?'/production':kind==='stocktake'?'/recipes?view=stock':'/'};
}

export function browserPrintURL(pdfURL,{revision,unsaved=false}={}){
 const source=new URL(pdfURL,'https://fenmeat.invalid');
 if(source.origin!=='https://fenmeat.invalid'||!/^\/api\/print\/(production|stock|stocktake)$/.test(source.pathname))throw Error('This document has no browser print page.');
 const kind=source.pathname.split('/').at(-1),p=new URLSearchParams({document:kind,date:source.searchParams.get('date')??''});
 if(kind==='stock')p.set('route',source.searchParams.get('route')??'');
 if(kind==='stocktake'&&source.searchParams.has('supplier'))p.set('supplier',source.searchParams.get('supplier'));
 const savedRevision=revision??source.searchParams.get('revision');if(savedRevision)p.set('revision',savedRevision);if(unsaved)p.set('unsaved','1');
 printPageOptions(p);
 return '/print-page?'+p;
}

export function usesAppleHomeScreen(nav,media){
 const apple=/iPhone|iPad|iPod/.test(nav.userAgent??'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 return apple&&(nav.standalone===true||media?.('(display-mode: standalone)').matches===true);
}
