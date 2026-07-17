const MAX_ITEMS = 40;
const MAX_NAME_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 30;
const CATEGORY_OPTIONS = ['五金工具', '电气照明', '给排水管件', '涂料胶粘', '建筑装饰', '劳保用品', '家具办公', '清洁用品', '绿化园艺', '其他'];

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
      '请规范化下面的商品资料，并判断每个商品最合适的商品分类。',
      '名称规则：去掉数量、价格、促销词、备注和重复空格；名称以通用商品类型和关键规格为主；品牌或厂家不要作为分类，也不要为了品牌单独创建商品类别；能识别品牌时放入 brand 字段。不要凭空补充不存在的信息。',
      `分类规则：只能从以下固定的大类中选择一个：${CATEGORY_OPTIONS.join('、')}。分类只依据商品的用途和类型，不依据品牌、厂家、型号、颜色或尺寸；同类商品必须使用完全相同的分类名；无法确定时使用“其他”。`,
      '只根据提供的名称、SKU、规格和已有分类判断。必须只返回 JSON，格式为：{"items":[{"id":"原id","name":"规范化商品名称","brand":"品牌或厂家，没有则为空","category":"固定大类","confidence":0.0}]}。',
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
        temperature: 0.05,
        response_format: { type: 'json_object' },
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
      name: String(item.name || '').trim().slice(0, MAX_NAME_LENGTH),
      brand: String(item.brand || '').trim().slice(0, MAX_NAME_LENGTH),
      category: CATEGORY_OPTIONS.includes(String(item.category || '').trim()) ? String(item.category).trim().slice(0, MAX_CATEGORY_LENGTH) : '其他',
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    })).filter(item => item.name && item.category) : [];
    return json(res, 200, { items });
  } catch (error) {
    return json(res, 500, { error: error.message || '分类服务异常' });
  }
}
