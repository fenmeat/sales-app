import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
export function fixture(group='TEST',count=6){
 const materials=Array.from({length:count},(_,i)=>({id:'M'+i,name:i===0?'Synthetic ingredient with a long descriptive name':'Synthetic ingredient '+i,unit:'kg'}));
 materials[count-1]={id:'RM25',name:'Dye Red',unit:'kg'};
 const recipe={group,name:'Synthetic recipe',version:2,status:'approved',complete:true,effective_date:'2026-11-05',ingredients:materials.map((m,i)=>({material:m.id,unit:'kg',qty:i===count-1?.02:10,status:'approved'})),consumables:[{material:'CASING',qty:2,unit:'roll'}],batch_kg:(count-1)*10+.02,notes:'PRIVATE_NOTE',source:'PRIVATE_SOURCE'};
 return {revision:7,register:{materials,recipes:[recipe]},saved_at:'2026-11-05T09:00:00Z'};
}
export async function pdfText(pdf){
 const task=getDocument({data:await pdf.save(),useSystemFonts:false}),doc=await task.promise;
 try{const page=await doc.getPage(1),content=await page.getTextContent();return content.items.map(x=>x.str).join('\n');}finally{await task.destroy();}
}
