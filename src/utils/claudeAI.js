// ============================================
// Claude AI helper — direct HTTPS call (no SDK)
// Uses process.env.ANTHROPIC_API_KEY
// ============================================
'use strict';

const https = require('https');

/**
 * Call Claude claude-haiku-4-5-20251001 with a single user message.
 * Returns the text content of the first response block.
 */
const callClaude = (userPrompt, systemPrompt = '') => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const text = json.content?.[0]?.text || '';
          resolve(text.trim());
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

module.exports = { callClaude };
