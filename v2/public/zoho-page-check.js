// Read one displayed page, sequentially and at a conservative request rate.
// This is evidence for product/route matching, never a complete-day sales import.
export async function checkInvoicePage(page,readInvoice,{onProgress=()=>{},shouldStop=()=>false,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!page?.preview||!Array.isArray(page.invoices)||page.invoices.length>20||new Set(page.invoices.map(i=>i.id)).size!==page.invoices.length)throw Error('Load a fresh FEN invoice page first.');
 const report={preview:true,scope:'invoice_page_product_check',organisation:page.organisation,date:page.date,page:page.page,
  has_more_pages:page.has_more,page_checked:false,requested_invoice_ids:page.invoices.map(i=>i.id),invoices:[],error:null};
 for(const header of page.invoices){
  if(shouldStop()){report.error='Check stopped. Download includes only the invoices already checked.';break;}
  onProgress(report.invoices.length,page.invoices.length);
  await wait(1200);
  if(shouldStop()){report.error='Check stopped. Download includes only the invoices already checked.';break;}
  try{
   const detail=await readInvoice(header.id,page.date);
   if(!detail?.preview||detail.organisation?.id!==page.organisation.id||detail.invoice?.id!==header.id||detail.invoice.date!==page.date)throw Error('Invoice response did not match this page. Reload the page and try again.');
   report.invoices.push(detail);
   onProgress(report.invoices.length,page.invoices.length);
  }catch(error){report.error=error.message;break;}
 }
 report.page_checked=report.invoices.length===page.invoices.length&&!report.error;
 return report;
}
