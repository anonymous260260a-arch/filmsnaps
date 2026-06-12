import fetch from 'node-fetch';
import fs from 'fs';

async function checkValidEmbed() {
  const baseUrl = 'http://localhost:3000';
  const contentid = '1054867';
  const plat = 'movie';
  const selectedSeason = 1;
  const activeEpisode = 1;
  const Providers = [
    {
      name: 'VidKing',
      proxyKey: 'vidking',
      iframeSrc: `https://www.vidking.net/embed/${plat}/${contentid}${
        plat === 'tv' ? `/${selectedSeason}/${activeEpisode}` : ''
      }?color=ff0000`,
    },
    {
      name: 'Vidsrc',
      proxyKey: 'vidsrc',
      iframeSrc: `https://vidsrc.wtf/api/1/${plat}/?id=${contentid}&color=e01621`,
    },
    {
      name: 'Vidsrc 2',
      proxyKey: 'vidsrc2',
      iframeSrc: `https://vidsrc.wtf/api/2/${plat}/?id=${contentid}&color=e01621`,
    },
    {
      name: 'Vidsrc 3',
      proxyKey: 'vidsrc3',
      iframeSrc: `https://vidsrc.wtf/api/3/${plat}/?id=${contentid}&color=e01621`,
    },
    {
      name: 'Vidsrc 4',
      proxyKey: 'vidsrc4',
      iframeSrc: `https://vidsrc.wtf/api/4/${plat}/?id=${contentid}&color=e01621`,
    },
    {
      name: 'Vidsrc 5',
      proxyKey: 'vidsrc5',
      iframeSrc: `https://vidsrc.su/${plat}/${contentid}&colour=00ff9d`,
    },
    {
      name: 'Vidsrc 6',
      proxyKey: 'vidsrc6',
      iframeSrc: `https://vidsrc-embed.ru/embed/movie/${contentid}`,
    },
    {
      name: 'Vidsrc 7',
      proxyKey: 'vidsrc7',
      iframeSrc: `https://vidlink.pro/movie/${contentid}`,
    },
    {
      name: 'Vidnest',
      proxyKey: 'vidnest',
      iframeSrc: `https://vidnest.fun/movie/${contentid}`,
    },
    {
      name: 'PrimeSrc',
      proxyKey: 'primesrc',
      iframeSrc: `https://primesrc.me/embed/movie?tmdb=${contentid}`,
    },

    {
      name: 'Vidpro',
      proxyKey: 'vidpro',
      iframeSrc: `https://vidlink.pro/${plat}/${contentid}`,
    },
    {
      name: 'Vixsrc',
      proxyKey: 'vixsrc',
      iframeSrc: `https://vixsrc.to/${plat}/${contentid}`,
    },
    {
      name: 'Vidfast',
      proxyKey: 'vidfast',
      iframeSrc: `https://vidfast.pro/movie/${contentid}`,
    },
    {
      name: 'Moviesapi',
      proxyKey: 'moviesapi',
      iframeSrc: `https://moviesapi.club/movie/${contentid}`,
    },
    {
      name: 'Vidup',
      proxyKey: 'vidup',
      iframeSrc: `https://vidup.to/movie/${contentid}?autoPlay=true`,
    },
  ];
  Providers.map(async (provider) => {
    try {
      console.log('Testing Embed for provider:', provider.name);
      const res = await fetch(provider.iframeSrc, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: 'https://google.com',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const html = await res.text();
      fs.writeFileSync(`${provider.name}_embed.html`, html);
      console.log(`Saved to valid_embed.html (${html.length} bytes)`);
    } catch (e) {
      console.error('Error:', e.message);
    }
  });
}

checkValidEmbed();
