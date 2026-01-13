export const config = { runtime: 'edge' };

const ALLOWED_CURRENCIES = ['usd', 'eur', 'gbp', 'jpy', 'cny', 'btc', 'eth'];
const MAX_COIN_IDS = 20;
const COIN_ID_PATTERN = /^[a-z0-9-]+$/;

// Simple in-memory cache for edge function (reset on cold start)
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 120 * 1000; // 2 minutes

function validateCoinIds(idsParam) {
  if (!idsParam) return 'bitcoin,ethereum,solana';

  const ids = idsParam.split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => COIN_ID_PATTERN.test(id) && id.length <= 50)
    .slice(0, MAX_COIN_IDS);

  return ids.length > 0 ? ids.join(',') : 'bitcoin,ethereum,solana';
}

function validateCurrency(val) {
  const currency = (val || 'usd').toLowerCase();
  return ALLOWED_CURRENCIES.includes(currency) ? currency : 'usd';
}

function validateBoolean(val, defaultVal) {
  if (val === 'true' || val === 'false') return val;
  return defaultVal;
}

export default async function handler(req) {
  const url = new URL(req.url);

  const ids = validateCoinIds(url.searchParams.get('ids'));
  const vsCurrencies = validateCurrency(url.searchParams.get('vs_currencies'));
  const include24hrChange = validateBoolean(url.searchParams.get('include_24hr_change'), 'true');

  // Return cached data if fresh
  const cacheKey = `${ids}:${vsCurrencies}:${include24hrChange}`;
  if (cache.data && cache.key === cacheKey && Date.now() - cache.timestamp < CACHE_TTL) {
    return new Response(cache.data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=60',
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    const geckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vsCurrencies}&include_24hr_change=${include24hrChange}`;
    const response = await fetch(geckoUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    // If rate limited, return cached data if available
    if (response.status === 429 && cache.data && cache.key === cacheKey) {
      return new Response(cache.data, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120, stale-while-revalidate=60',
          'X-Cache': 'STALE',
        },
      });
    }

    const data = await response.text();

    // Cache successful responses
    if (response.ok) {
      cache = { data, key: cacheKey, timestamp: Date.now() };
    }

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=60',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    // Return cached data on error if available
    if (cache.data && cache.key === cacheKey) {
      return new Response(cache.data, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120',
          'X-Cache': 'ERROR-FALLBACK',
        },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
