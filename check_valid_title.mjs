
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs';
async function checkValidTitle() {
  // Fetch directly from upstream to see what a valid embed looks like
  const validUrl = 'https://indraembed.netlify.app/movie/1054867';
  
  try {
    const res = await fetch(validUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://google.com'
      }
    });
    
    const html = await res.text();
    const dom = new JSDOM(html);
    const title = dom.window.document.querySelector('title')?.textContent || '';
    fs.writeFileSync('valid_title.html', html);
    console.log('Valid embed title:', title);
    console.log('Status:', res.status);
    
  } catch(e) {
    console.error('Error:', e.message);
  }
}

checkValidTitle();
