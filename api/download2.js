function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeAsciiSlug(value = 'Khach') {
  const normalized = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const slug = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || 'Khach';
}

function makeContentDisposition(filename) {
  const fallback = makeAsciiSlug(filename).replace(/\.mobileconfig$/i, '') + '.mobileconfig';
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export default function handler(req, res) {
  const { data } = req.query || {};

  if (!data) {
    return res.status(400).send('Thiếu dữ liệu');
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(data, 'base64').toString());
  } catch {
    return res.status(400).send('Dữ liệu không hợp lệ');
  }

  if (Date.now() > decoded.exp) {
    return res.status(410).send('Hết hạn');
  }

  const rawName = String(decoded.name || 'Khách').trim() || 'Khách';
  const displayName = escapeXml(rawName);
  const safeSlug = makeAsciiSlug(rawName);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>DNSSettings</key>
            <dict>
                <key>DNSProtocol</key>
                <string>HTTPS</string>
                <key>ServerAddresses</key>
                <array>
                    <string>1.1.1.1</string>
                    <string>1.0.0.1</string>
                    <string>45.90.28.0</string>
                    <string>45.90.30.0</string>
                    <string>2a07:a8c0::</string>
                    <string>2a07:a8c1::</string>
                </array>
                <key>ServerURL</key>
                <string>https://dns.adguard.com/dns-query</string>
                
                <key>SupplementalMatchDomains</key>
                <array>
                    <string>certs.apple.com</string>
                    <string>crl.apple.com</string>
                    <string>ocsp.apple.com</string>
                    <string>ocsp2.apple.com</string>
                    <string>valid.apple.com</string>
                    <string>crl3.digicert.com</string>
                    <string>crl4.digicert.com</string>
                    <string>ocsp.digicert.cn</string>
                    <string>ocsp.digicert.com</string>
                    
                    <string>api.revenuecat.com</string>
                    <string>app.revenuecat.com</string>
                    <string>in.appcenter.ms</string>
                    <string>app-measurement.com</string>
                    <string>firebaselogging-pa.googleapis.com</string>
                    <string>mixpanel.com</string>
                    <string>api.mixpanel.com</string>
                </array>
            </dict>
            <key>OnDemandRules</key>
            <array>
                <dict>
                    <key>Action</key>
                    <string>Connect</string>
                    <key>InterfaceTypeMatch</key>
                    <string>WiFi</string>
                </dict>
                <dict>
                    <key>Action</key>
                    <string>Connect</string>
                    <key>InterfaceTypeMatch</key>
                    <string>Cellular</string>
                </dict>
            </array>
            <key>PayloadDescription</key>
            <string>Configures device to use Locket VIP Freeze DNS</string>
            <key>PayloadDisplayName</key>
            <string>Locket VIP - ${displayName}</string>
            <key>PayloadIdentifier</key>
            <string>com.apple.dnsSettings.managed.locketvip.${safeSlug}</string>
            <key>PayloadType</key>
            <string>com.apple.dnsSettings.managed</string>
            <key>PayloadUUID</key>
            <string>C3D4E5F6-7890-1234-5678-90ABCDEF1234</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Chức Năng:
✔️ Hỗ Trợ Không Bị Mất Locket Gold
_Hoàng Quân_ </string>
    <key>PayloadDisplayName</key>
    <string>💛 Locket Gold VIP (Vĩnh Viễn) - ${displayName}</string>
    <key>PayloadIdentifier</key>
    <string>com.p12.locket.vip</string>
    <key>PayloadOrganization</key>
    <string>By CAO VĂN NAM</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>21098765-4321-DCBA-0F12-4567890ABCDE</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

  const fileName = `${rawName}_DNS_Locket_Gold.mobileconfig`;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Disposition', makeContentDisposition(fileName));
  res.setHeader('Content-Type', 'application/x-apple-aspen-config; charset=utf-8');
  return res.status(200).send(xml);
}
