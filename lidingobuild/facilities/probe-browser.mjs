import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
 args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage();
 await page.goto('http://localhost:5173/');
 console.log(JSON.stringify(await page.evaluate(async()=>({
   webgl:!!document.createElement('canvas').getContext('webgl2'),webgpu:!!(navigator.gpu&&await navigator.gpu.requestAdapter()),title:document.title
 }))));
} finally {await browser.close();}
