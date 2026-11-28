import sanitize from 'sanitize-html';

const color = /^(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d., %]+\))$/i;
const lengths = /^(?:-?[\d.]+(?:px|pt|em|rem|%)?|auto)(?: (?:-?[\d.]+(?:px|pt|em|rem|%)?|auto)){0,3}$/;
const border = /^[\d.]+(?:px|pt) (?:solid|dashed|dotted) #[\da-f]{3,8}$/i;
const styles = {
 color:[color], 'background-color':[color], 'font-family':[/^[a-z0-9 ,'"-]{1,90}$/i],
 'font-weight':[/^(?:normal|bold|[1-9]00)$/], 'font-style':[/^(?:normal|italic)$/],
 'text-align':[/^(?:left|center|right|justify)$/], 'text-decoration':[/^(?:none|underline|line-through)$/],
 'white-space':[/^(?:normal|nowrap|pre-wrap)$/], 'border-collapse':[/^(?:collapse|separate)$/]
};
for(const key of ['width','max-width','font-size','line-height','letter-spacing','margin','padding','padding-left','padding-right','margin-top','margin-bottom'])styles[key]=[lengths];
for(const key of ['border','border-top','border-left','border-bottom','border-right'])styles[key]=[border];
const options={
 allowedTags:['p','div','span','br','hr','b','strong','i','em','u','s','sub','sup','blockquote','ul','ol','li','pre','code','h1','h2','h3','h4','h5','h6','table','thead','tbody','tfoot','tr','th','td','a'],
 allowedAttributes:{'*':['style'],a:['href'],table:['role','cellpadding','cellspacing','border'],td:['colspan','rowspan'],th:['colspan','rowspan']},
 allowedStyles:{'*':styles},allowedSchemes:['https','http','mailto','tel'],allowProtocolRelative:false
};
export const cleanMailHtml=html=>html?sanitize(html,options):'';
