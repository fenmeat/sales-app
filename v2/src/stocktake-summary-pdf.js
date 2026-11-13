import {PDFDocument,StandardFonts,PageSizes,rgb} from 'pdf-lib';
import {check,dateKey} from './domain.js';
import {supplierGroups,supplierKey} from './stocktake.js';

const amount=value=>new Intl.NumberFormat('en-ZA',{maximumFractionDigits:6}).format(value).replace(/\u00a0|\u202f/g,' ');
const labels={
 unit:['unit','units'],units:['unit','units'],eenhede:['unit','units'],
 roll:['roll','rolls'],rolls:['roll','rolls'],rolle:['roll','rolls'],
 'casing-rolle':['casing roll','casing rolls'],sakke:['bag','bags'],bag:['bag','bags'],bags:['bag','bags'],
 bakkies:['tray','trays'],trays:['tray','trays'],box:['box','boxes'],boxes:['box','boxes'],
 casings:['casing','casings'],voorskote:['apron','aprons'],saaglemme:['blade','blades'],
 elements:['element','elements'],'teflon-bande':['tape','tapes'],
 haarnette:['hairnet','hairnets'],baardnette:['beard cap','beard caps'],
 'houers van 5 l':['container (5 L)','containers (5 L)'],sakkies:['sachet','sachets'],
 patrone:['cartridge','cartridges'],spuitbusse:['spray can','spray cans'],
 pack:['pack','packs'],packs:['pack','packs'],caddy:['caddy','caddies']
};
function unitLabel(unit,quantity){const label=String(unit??'units').trim();return labels[label.toLowerCase()]?.[quantity===1?0:1]??label;}
const validQuantity=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

function countText(material){
 const {qty,count}=material.stock,unit=material.unit;
 const sameBasis=count?.unit===unit&&count.pack_qty===material.pack_qty;
 const displayUnit=sameBasis||!count?material.pack_spec?.unit_label??unit:unit;
 // The saved count owns its pack basis. Current pack sizes must never
 // reinterpret an older quantity, and loose stock must never disappear.
 const fullPacks=count&&Number.isSafeInteger(count.packs)&&count.packs>=0&&
  validQuantity(count.pack_qty)&&count.pack_qty>0&&count.unit===unit&&
  (count.loose??0)===0&&Math.abs(count.packs*count.pack_qty-qty)<1e-6;
 if(fullPacks){
  if(count.pack_qty===1&&!['kg','g','l','ml','litre','liter'].includes(unit.toLowerCase()))return amount(count.packs)+' '+unitLabel(displayUnit,count.packs);
  return amount(count.packs)+' × '+amount(count.pack_qty)+' '+unitLabel(displayUnit,count.pack_qty);
 }
 return amount(qty)+' '+unitLabel(displayUnit,qty);
}

// A daily summary never relabels an earlier count as a count for the selected
// day. All the same supplier rows remain visible, including explicit zeroes.
export function stocktakeSummaryRows(register,{supplier,date}){
 date=dateKey(date);
 check(typeof supplier==='string'&&supplier.length<=200,'Choose a supplier.');
 check(Array.isArray(register?.materials),'The saved material register is unavailable.');
 const group=supplierGroups(register.materials).find(g=>g.key===supplierKey(supplier));
 check(group,'Supplier not found.');
 const rows=group.materials.map(material=>{
  const stock=material.stock??{},qty=stock.qty??null;
  check(qty===null||validQuantity(qty),'The saved count for '+material.name+' is invalid.');
  const counted=qty!==null&&stock.date===date;
  return {id:material.id,name:material.name,countText:counted?countText(material):'Not counted',counted,qty:counted?qty:null,count_date:stock.date??null};
 });
 return {supplier:group.name,supplierKey:group.key,date,rows,total:rows.length,counted:rows.filter(r=>r.counted).length,other_date_count:rows.filter(r=>!r.counted&&r.count_date&&r.count_date!==date).length};
}

export async function stocktakeSummaryPDF(saved,selection){
 const summary=stocktakeSummaryRows(saved.register,selection),doc=await PDFDocument.create();
 const normal=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const printable=value=>[...String(value??'').replace(/[\r\n\t\u00a0\u202f]+/g,' ').replace(/[\u2010-\u2015]/g,'-')].map(char=>{
  try{normal.encodeText(char);return char;}catch{return '[U+'+char.codePointAt(0).toString(16).toUpperCase()+']';}
 }).join('');
 const [width,height]=PageSizes.A4,margin=28,usable=width-margin*2,productWidth=usable*.62,countWidth=usable-productWidth;
 const tableTop=height-margin-64,headHeight=24,bottom=52,rowHeight=Math.min(20,(tableTop-headHeight-bottom)/summary.total);
 const bodySize=Math.min(11,rowHeight-5);
 check(bodySize>=9&&rowHeight>=14,'This supplier has too many products for one readable A4 stocktake page.');
 function fit(value,font,size,maxWidth){
  const text=printable(value);let fitted=size;
  while(fitted>=9&&font.widthOfTextAtSize(text,fitted)>maxWidth)fitted-=.25;
  check(fitted>=9,'A product name or count is too long for one readable stocktake line.');
  return {text,size:fitted};
 }
 const layout=summary.rows.map(row=>({...row,nameLabel:fit(row.name,normal,bodySize,productWidth-14),countLabel:fit(row.countText,row.counted?bold:normal,bodySize,countWidth-14)}));
 const supplierLabel=fit(summary.supplier,bold,11,usable-190);
 const page=doc.addPage(PageSizes.A4),ink=rgb(.08,.14,.19),line=rgb(.65,.72,.78),blue=rgb(.90,.95,.98),pale=rgb(.97,.98,.99);
 const text=(value,x,y,size=bodySize,font=normal)=>page.drawText(printable(value),{x,y,size,font,color:ink});
 const box=(x,y,w,h,fill)=>page.drawRectangle({x,y,width:w,height:h,borderWidth:.45,borderColor:line,...(fill?{color:fill}:{})});
 text('Stocktake Summary',margin,height-margin-18,18,bold);
 text('FEN MEAT',width-margin-bold.widthOfTextAtSize('FEN MEAT',10),height-margin-16,10,bold);
 text(supplierLabel.text,margin,height-margin-38,supplierLabel.size,bold);
 const date=new Date(summary.date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),dateLabel='Count date: '+date;
 text(dateLabel,width-margin-bold.widthOfTextAtSize(dateLabel,10),height-margin-38,10,bold);
 text(summary.counted+' of '+summary.total+' products counted for this date',margin,height-margin-53,9);
 box(margin,tableTop-headHeight,productWidth,headHeight,blue);box(margin+productWidth,tableTop-headHeight,countWidth,headHeight,blue);
 text('Product',margin+7,tableTop-16,10,bold);text('Stock count',width-margin-7-bold.widthOfTextAtSize('Stock count',10),tableTop-16,10,bold);
 let y=tableTop-headHeight;
 for(const [index,row] of layout.entries()){
  const fill=index%2===1?pale:undefined;
  box(margin,y-rowHeight,productWidth,rowHeight,fill);box(margin+productWidth,y-rowHeight,countWidth,rowHeight,fill);
  text(row.nameLabel.text,margin+7,y-rowHeight/2-row.nameLabel.size*.35,row.nameLabel.size);
  const font=row.counted?bold:normal;
  text(row.countLabel.text,width-margin-7-font.widthOfTextAtSize(row.countLabel.text,row.countLabel.size),y-rowHeight/2-row.countLabel.size*.35,row.countLabel.size,font);
  y-=rowHeight;
 }
 text('Not counted = no saved count for this date. Earlier counts are not carried forward.',margin,36,8.5);
 text('Saved counts',margin,23,8.5);text('Page 1 of 1',width-margin-normal.widthOfTextAtSize('Page 1 of 1',8.5),23,8.5);
 doc.setTitle('Fen Meat - Stocktake Summary - '+printable(summary.supplier)+' - '+summary.date);
 doc.setSubject('Saved material register revision '+saved.revision);doc.setAuthor('Fen Meat');
 return doc.save();
}
