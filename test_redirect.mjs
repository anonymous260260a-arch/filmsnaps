
import fetch from 'node-fetch';

async function testRedirectDetection() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('=== Testing Valid URL ===');
  const validUrl = `${baseUrl}/api/iframe-proxy/vidking?url=${encodeURIComponent('/embed/movie/1306368?color=ff0000')}`;
  try {
    const res = await fetch(validUrl);
    console.log(`Valid URL Status: ${res.status}`);
    if (res.status === 200) {
        console.log('✅ Valid URL returns 200');
    } else {
        console.log(`❌ Valid URL failed with ${res.status}`);
    }
  } catch(e) {
    console.error('Valid URL error:', e.message);
  }

  console.log('\n=== Testing Invalid URL (should redirect to landing page) ===');
  const invalidUrl = `${baseUrl}/api/iframe-proxy/vidking?url=${encodeURIComponent('/embed/moviewrong/1306368?color=ff0000')}`;
  try {
    const res = await fetch(invalidUrl);
    console.log(`Invalid URL Status: ${res.status}`);
    if (res.status === 404) {
        console.log('✅ Invalid URL correctly returns 404 (landing page redirect blocked)');
        const text = await res.text();
        if (text.includes('Embed not found')) {
            console.log('✅ Correct error message');
        }
    } else {
        console.log(`❌ Invalid URL returned ${res.status} instead of 404`);
    }
  } catch(e) {
    console.error('Invalid URL error:', e.message);
  }
}

testRedirectDetection();
