
import fs from 'fs';
import { baseSanitize } from './lib/movieProviders/common';
import { JSDOM } from 'jsdom';

// Mock browser environment for JSDOM if needed implicitly (common.ts handles it)

async function runDebug() {
    const rawHtml = fs.readFileSync('ProvidersResponses/Vidpro_embed.html', 'utf-8');
    const url = 'https://vidlink.pro/movie/123';
    
    console.log('--- Original Script Count ---');
    const dom = new JSDOM(rawHtml);
    console.log(dom.window.document.querySelectorAll('script').length);

    console.log('\n--- Running Sanitizer ---');
    const sanitizedApi = baseSanitize(rawHtml, url);
    
    const dom2 = new JSDOM(sanitizedApi);
    const scripts = dom2.window.document.querySelectorAll('script');
    console.log('Sanitized Script Count:', scripts.length);
    
    // Check if first script is hardening script
    const firstScript = scripts[0];
    if (firstScript && firstScript.textContent?.includes('rewriteUrl')) {
        console.log('SUCCESS: Hardening script injected at top.');
    } else {
        console.log('FAILURE: Hardening script NOT unknown location.');
    }

    const base = dom2.window.document.querySelector('base');
    console.log('Base Tag:', base ? base.outerHTML : 'MISSING');

    if (scripts.length === 0) {
        console.log('CRITICAL: All scripts were removed!');
    } else {
        console.log('Scripts remaining:', scripts.length);
        scripts.forEach((s, i) => {
            console.log(`Script ${i} length: ${s.textContent?.length}`);
        });
    }
}

runDebug();
