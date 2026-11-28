// Receipt presentation only. Stored identities and payment amounts stay unchanged.
export function cashierName(actor){
  const value=String(actor??'');
  return ({alex:'Alex',alinda:'Alinda',xalinda:'Xalinda',xavier:'Xavier'})[value.toLowerCase()]??value;
}
export function receiptPaymentRows(payment){
  const rows=[['cash','Cash'],['card','Card (Capitec)'],['shop2shop','Shop2Shop']]
    .filter(([key])=>payment[key]>0).map(([key,label])=>({key,label,amount:payment[key]}));
  if(payment.cash_tendered>0){
    rows.push({key:'cash_tendered',label:'Cash tendered',amount:payment.cash_tendered});
    rows.push({key:'change',label:'Change',amount:payment.change});
  }
  return rows;
}
