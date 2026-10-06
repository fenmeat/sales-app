import {copyFile} from 'node:fs/promises';
for (const name of ['domain.js','forecast.js','forecast-history.js','production.js']) await copyFile(new URL('./src/'+name,import.meta.url),new URL('./public/'+name,import.meta.url));
