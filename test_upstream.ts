
import fetch from 'node-fetch';

async function testFetch() {
    // Vidsrc test URL (example - checking if homepage or asset loads)
    // Note: vidsrc often returns 404 for root, we need a valid endpoint.
    // Let's try to fetch a known asset pattern or just the embed page to check general blocking
    const targetUrl = 'https://vidsrc.wtf/embed/movie/123';
    const origin = 'https://vidsrc.wtf';

    console.log(`Fetching: ${targetUrl}`);
    
    try {
        const res = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': origin + '/',
                'Origin': origin
            }
        });

        console.log(`Status: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.log(`Content Type: ${res.headers.get('content-type')}`);
        
        if (text.includes('Just a moment...') || text.includes('Cloudflare')) {
            console.log('BLOCKED: Cloudflare challenge detected.');
        } else {
            console.log('SUCCESS: Content retrieved. Length:', text.length);
        }

    } catch (e) {
        console.error('Fetch error:', e);
    }
}

testFetch();
