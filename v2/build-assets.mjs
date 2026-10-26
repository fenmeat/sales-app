import {copyFile,mkdir} from 'node:fs/promises';
for (const name of ['domain.js','forecast.js','forecast-history.js','production.js','stocktake.js','invoice-domain.js']) await copyFile(new URL('./src/'+name,import.meta.url),new URL('./public/'+name,import.meta.url));

// Self-host the pinned PDF renderer and its fonts; no CDN or external viewer.
await mkdir(new URL('./public/pdfjs/',import.meta.url),{recursive:true});
for(const name of ['pdf.min.mjs','pdf.worker.min.mjs'])await copyFile(new URL('./node_modules/pdfjs-dist/legacy/build/'+name,import.meta.url),new URL('./public/pdfjs/'+name,import.meta.url));
for(const name of ['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf','LiberationSans-Italic.ttf','LiberationSans-BoldItalic.ttf','LICENSE_LIBERATION'])await copyFile(new URL('./node_modules/pdfjs-dist/standard_fonts/'+name,import.meta.url),new URL('./public/pdfjs/'+name,import.meta.url));
await copyFile(new URL('./node_modules/pdfjs-dist/LICENSE',import.meta.url),new URL('./public/pdfjs/LICENSE',import.meta.url));
