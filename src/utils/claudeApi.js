// ============================================
// CLAUDE API — Anthropic Messages via HTTPS
// Uses raw HTTPS so no SDK dependency needed.
// Docs: https://docs.anthropic.com/en/api/messages
// ============================================
const https = require('https');

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL     = 'claude-haiku-4-5-20251001'; // fast + affordable for real-time UX
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Call Anthropic Messages API.
 * @param {Object} opts
 * @param {string}   opts.system       - System prompt
 * @param {Array}    opts.messages     - [{role:'user'|'assistant', content:'...'}]
 * @param {string}   [opts.model]      - Model override
 * @param {number}   [opts.max_tokens] - Token limit
 * @param {number}   [opts.temperature]
 * @returns {Promise<{text:string, inputTokens:number, outputTokens:number}>}
 */
const callClaude = (opts) => {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return reject(new Error('ANTHROPIC_API_KEY not configured'));
    }

    const payload = JSON.stringify({
      model:      opts.model      || DEFAULT_MODEL,
      max_tokens: opts.max_tokens || DEFAULT_MAX_TOKENS,
      system:     opts.system     || '',
      messages:   opts.messages   || [],
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const text = parsed.content?.[0]?.text || '';
            resolve({
              text,
              inputTokens:  parsed.usage?.input_tokens  || 0,
              outputTokens: parsed.usage?.output_tokens || 0,
            });
          } else {
            console.error('[Claude API] Error:', res.statusCode, parsed?.error?.message || data);
            reject(new Error(parsed?.error?.message || `Claude API error ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error('Failed to parse Claude API response'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

module.exports = { callClaude };
