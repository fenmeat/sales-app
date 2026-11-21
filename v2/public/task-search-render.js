// Keep the search input AND its ancestors connected while the surrounding list
// changes. Replacing or temporarily detaching the input dismisses iOS keyboards;
// focusing a replacement after the request returns cannot recover lost typing.
export function renderWithSearch(root,html,selector){
 const template=root.ownerDocument.createElement('template');template.innerHTML=html;
 const previous=root.querySelector(selector),next=template.content.querySelector(selector);
 if(!previous||!next){root.innerHTML=html;return;}
 const path=(input,container)=>{const nodes=[];for(let el=input;el!==container;el=el.parentNode)nodes.push(el);return nodes;};
 const oldPath=path(previous,root),newPath=path(next,template.content);
 if(oldPath.length!==newPath.length||oldPath.some((el,i)=>el.localName!==newPath[i].localName)){root.innerHTML=html;return;}
 // Only an intentional change to the search value should affect its selection.
 if(previous.value!==next.value)previous.value=next.value;
 for(let i=0;i<oldPath.length;i++){
  const kept=oldPath[i],fresh=newPath[i],parent=kept.parentNode;
  for(const attr of [...kept.attributes])if(attr.name!=='value'&&!fresh.hasAttribute(attr.name))kept.removeAttribute(attr.name);
  for(const attr of [...fresh.attributes])if(attr.name!=='value'&&kept.getAttribute(attr.name)!==attr.value)kept.setAttribute(attr.name,attr.value);
  const siblings=[...fresh.parentNode.childNodes],index=siblings.indexOf(fresh);
  while(kept.previousSibling)parent.removeChild(kept.previousSibling);
  while(kept.nextSibling)parent.removeChild(kept.nextSibling);
  for(const node of siblings.slice(0,index))parent.insertBefore(node,kept);
  for(const node of siblings.slice(index+1))parent.appendChild(node);
 }
}
