
import fetch from 'node-fetch';
import fs from 'fs';

async function testProxy() {
  const baseUrl = 'http://localhost:3000';
  const provider = 'example';
  
  console.log('Testing Proxy for provider:', provider);

  // 1. Test Main Proxy Route
  try {
    const res = await fetch(`${baseUrl}/api/iframe-proxy/${provider}`);
    const text = await res.text();
    
    console.log('Proxy Status:', res.status);
    
    fs.writeFileSync('proxy_response.html', text);
    console.log('Saved response to proxy_response.html');

    // Check for script injection (loose check)
    if (text.includes('document.addEventListener') && text.includes('navigation blocked')) {
        console.log('✅ Navigation block script injected');
    } else {
        console.log('❌ Navigation block script seemingly MISSING. Check proxy_response.html');
    }

  } catch (e) {
      console.error('❌ Proxy Test Failed:', e.message);
  }

  // 2. Test Asset Proxy
  try {
      const assetUrl = `${baseUrl}/api/${provider}/non-existent-asset.js`;
      const res = await fetch(assetUrl);
      console.log(`Asset Proxy Status (${assetUrl}):`, res.status);
      
      if (res.status === 404) {
           console.log('✅ Asset proxy correctly returns 404 for missing file');
      } else {
           console.log('⚠️ Asset proxy returned', res.status);
      }
  } catch (e) {
      console.error('❌ Asset Proxy Test Failed:', e.message);
  }
}

testProxy();
