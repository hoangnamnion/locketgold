export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method không hợp lệ' });
  }

  const { name, ttlMinutes } = req.body || {};

  const cleanName = String(name || '').trim();
  const minutes = Number(ttlMinutes);

  if (!cleanName) {
    return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  }

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'Thời gian sống phải là số phút lớn hơn 0' });
  }

  const safeMinutes = Math.floor(minutes);

  const payload = {
    name: cleanName,
    ttlMinutes: safeMinutes,
    exp: Date.now() + safeMinutes * 60 * 1000,
    ip: null,
    ua: null
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return res.status(200).json({ data: encoded });
}
