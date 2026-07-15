const MAX_ITEMS = 40;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseModelJson(content) {
  const text = String(content || '').replace(/```json|```/gi, '').trim();
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('DeepSeek 返回的不是有效 JSON');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: '只支持 POST 请求' });
  if (!process.env.DEEPSEEK_API_KEY) return json(res, 500, { error: 'Vercel 尚未配置 DEEPSEEK_API_KEY' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const products = Array.isArray(body.products) ? body.products.slice(0, MAX_ITEMS) : [];
    if (!products.length) return json(res, 200, { items: [] });

    const prompt = [
      '请为下面的商品名称判断最合适的商品类型。',
      '规则：分类名称要简短、具体、适合做 Excel 工作表名称；可以创建新的分类；不要返回“未分类”；只根据商品名称和规格判断。',
      '必须只返回 JSON，格式为：{"items":[{"id":"原id","category":"分类名称"}]}。',
      JSON.stringify(products, null, 2),
    ].join('\n');

    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.1,
        messages: [
          { role: 'system', content: '你是一个严谨的商品目录分类助手。' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const result = await upstream.json();
    if (!upstream.ok) return json(res, upstream.status, { error: result?.error?.message || 'DeepSeek 请求失败' });
    const parsed = parseModelJson(result?.choices?.[0]?.message?.content);
    const allowed = new Set(products.map(p => String(p.id)));
    const items = Array.isArray(parsed.items) ? parsed.items.filter(item => allowed.has(String(item.id))).map(item => ({
      id: String(item.id),
      category: String(item.category || '').trim().slice(0, 30),
    })) : [];
    return json(res, 200, { items });
  } catch (error) {
    return json(res, 500, { error: error.message || '分类服务异常' });
  }
}
