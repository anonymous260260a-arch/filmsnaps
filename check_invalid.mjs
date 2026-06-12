
import fetch from 'node-fetch';
import fs from 'fs';

async function checkInvalidResponse() {
  const baseUrl = 'http://localhost:3000';
  const invalidUrl = `${baseUrl}/api/iframe-proxy/vidking?url=${encodeURIComponent('/embed/moviewrong/1306368?color=ff0000')}`;
  
  try {
    const res = await fetch(invalidUrl);
    const html = await res.text();
    
    fs.writeFileSync('invalid_response.html', html);
    console.log('Saved to invalid_response.html');
    console.log('Status:', res.status);
    console.log('First 500 chars:', html.slice(0, 500));
    
    // Check for common landing page indicators
    if (html.includes('<title>VidKing</title>') || html.includes('class="home"') || html.includes('landing')) {
        console.log('⚠️ This looks like a landing page');
    }
    
  } catch(e) {
    console.error('Error:', e.message);
  }
}

checkInvalidResponse();
