import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderWithSearch} from '../public/task-search-render.js';

test('search keeps its connected input and ancestors while results and notifications change',()=>{
 const {document}=parseHTML('<div id="app"></div>'),root=document.querySelector('#app');
 const view=(value,result,notice='')=>`<header>${notice}</header><main class="shell"><section class="pa-register"><h2>Tasks</h2><div class="filters"><select><option>Pending</option></select><input id="pa-search" type="search" value="${value}"></div><p>${result}</p></section></main>`;
 renderWithSearch(root,view('','All tasks'),'#pa-search');
 const input=root.querySelector('input'),ancestors=[input.parentNode,input.parentNode.parentNode,input.parentNode.parentNode.parentNode];
 input.value='First Labels';input.selectionStart=6;input.selectionEnd=12;
 renderWithSearch(root,view('First Labels','One matching task','New notification'),'#pa-search');
 assert.equal(root.querySelector('input'),input);
 assert.deepEqual([input.parentNode,input.parentNode.parentNode,input.parentNode.parentNode.parentNode],ancestors);
 assert.equal(input.value,'First Labels');assert.equal(input.selectionStart,6);assert.equal(input.selectionEnd,12);
 assert.match(root.textContent,/New notification/);assert.match(root.textContent,/One matching task/);assert.doesNotMatch(root.textContent,/All tasks/);
 renderWithSearch(root,view('','All tasks'),'#pa-search');assert.equal(input.value,'');
 renderWithSearch(root,'<main><h1>Rabbi</h1></main>','#pa-search');assert.equal(root.querySelector('input'),null);
 renderWithSearch(root,view('','All tasks'),'#pa-search');assert.ok(root.querySelector('input'));
});
