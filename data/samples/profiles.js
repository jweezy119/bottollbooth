/* bot-tollbooth — real-world traffic profiles for the demo
 * --------------------------------------------------------
 * Presets grounded in public 2026 industry data (Cloudflare Radar / HUMAN
 * Security / CoMP research), so the demo reflects what real sites face today:
 *   - Shopping/e-commerce is the single most-crawled vertical (~32% of AI
 *     crawler traffic): product catalogs attract training + price scrapers.
 *   - News/editorial attracts heavy AI training + AI-search (ChatGPT-User,
 *     Perplexity), while Google still sends a share of organic referrals.
 *   - Local businesses see mostly humans with light AI crawling and uptime
 *     monitors.
 * Each profile supplies the mixer weights and the actual user-agent pool the
 * demo draws from. Custom profiles use the defaults in index.html.
 */
'use strict';

var SAMPLE_PROFILES = [
  {
    id: 'local-business',
    label: 'Local Business (Coffee Shop)',
    desc: 'Healthy local-business mix: mostly real browsers, uptime monitors, modest crawl pressure.',
    humanPct: 82,
    aiWeight: 3,
    spamWeight: 2,
    searchWeight: 5,
    monWeight: 4,
    rpm: 8,
    fillScale: 50,
    count: 1200,
    aiUAs: [
      { ua: 'GPTBot/1.2 (+https://openai.com/gptbot)', w: 2 },
      { ua: 'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)', w: 2 },
      { ua: 'PerplexityBot/1.0 (+https://perplexity.ai/bot)', w: 1 },
      { ua: 'Google-Extended/1.0', w: 1 },
      { ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)', w: 1 },
    ],
    searchUAs: [
      { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)', w: 6 },
      { ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', w: 2 },
      { ua: 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', w: 2 },
      { ua: 'DuckDuckBot/1.0 (+https://duckduckgo.com/duckduckbot.html)', w: 1 },
    ],
    spamUAs: [
      { ua: 'python-requests/2.32.3', w: 2 },
      { ua: 'curl/8.5.0', w: 1 },
      { ua: 'MJ12bot/1.4.6', w: 1 },
    ],
    monUAs: [
      { ua: 'UptimeRobot/2.0', w: 3 },
      { ua: 'StatusCakeBot/1.0', w: 1 },
      { ua: 'Pingdom/1.0', w: 1 },
    ],
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    desc: 'The single most-crawled vertical: AI training + price scrapers harvest product catalogs (~32% of AI crawl traffic hits shopping sites).',
    humanPct: 45,
    aiWeight: 12,
    spamWeight: 6,
    searchWeight: 6,
    monWeight: 1,
    rpm: 20,
    fillScale: 40,
    count: 2500,
    aiUAs: [
      { ua: 'GPTBot/1.2 (+https://openai.com/gptbot)', w: 2 },
      { ua: 'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)', w: 2 },
      { ua: 'PerplexityBot/1.0 (+https://perplexity.ai/bot)', w: 2 },
      { ua: 'Amazonbot/0.1 (+https://developer.amazon.com/amazonbot)', w: 3 },
      { ua: 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', w: 2 },
      { ua: 'OAI-SearchBot/1.0', w: 1 },
      { ua: 'Google-Extended/1.0', w: 1 },
    ],
    searchUAs: [
      { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)', w: 7 },
      { ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', w: 2 },
      { ua: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', w: 1 },
    ],
    spamUAs: [
      { ua: 'python-requests/2.32.3', w: 3 },
      { ua: 'curl/8.5.0', w: 1 },
      { ua: 'wget/1.21.4', w: 1 },
      { ua: 'SemrushBot/7~bl', w: 1 },
    ],
    monUAs: [
      { ua: 'UptimeRobot/2.0', w: 1 },
      { ua: 'Pingdom/1.0', w: 1 },
    ],
  },
  {
    id: 'editorial',
    label: 'Editorial / News',
    desc: 'Most heavily crawled beyond shopping: AI training + AI-search (ChatGPT-User, Perplexity, Meta-ExternalAgent) over content that once sent referrals back.',
    humanPct: 50,
    aiWeight: 13,
    spamWeight: 2,
    searchWeight: 8,
    monWeight: 1,
    rpm: 15,
    fillScale: 45,
    count: 2500,
    aiUAs: [
      { ua: 'GPTBot/1.2 (+https://openai.com/gptbot)', w: 2 },
      { ua: 'ChatGPT-User/1.0 (+https://openai.com/bot)', w: 2 },
      { ua: 'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)', w: 3 },
      { ua: 'PerplexityBot/1.0 (+https://perplexity.ai/bot)', w: 2 },
      { ua: 'OAI-SearchBot/1.0', w: 1 },
      { ua: 'Mozilla/5.0 Meta-ExternalAgent/1.0', w: 2 },
      { ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)', w: 1 },
      { ua: 'Google-Extended/1.0', w: 1 },
    ],
    searchUAs: [
      { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)', w: 7 },
      { ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', w: 2 },
      { ua: 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', w: 1 },
    ],
    spamUAs: [
      { ua: 'python-requests/2.32.3', w: 1 },
      { ua: 'SemrushBot/7~bl', w: 1 },
    ],
    monUAs: [
      { ua: 'UptimeRobot/2.0', w: 1 },
      { ua: 'StatusCakeBot/1.0', w: 1 },
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SAMPLE_PROFILES;
} else {
  window.SAMPLE_PROFILES = SAMPLE_PROFILES;
}