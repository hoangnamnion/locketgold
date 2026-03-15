import aiohttp
import asyncio
import datetime

NEXTDNS_BASE_URL = "https://api.nextdns.io"

async def create_or_get_daily_profile(api_key: str, log_callback=None):
    """
    Tạo hoặc reuse profile daily (tên theo ngày) để tránh tạo thừa.
    Trả về (profile_id, config_link) hoặc (None, None) nếu fail.
    """
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)  # luôn in console cho dễ debug

    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json"
    }

    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    profile_name = f"LocketVIP-{today_str}"
    log(f"[*] Checking for existing daily profile: {profile_name}...")

    async with aiohttp.ClientSession(headers=headers) as session:
        # 1. List all profiles
        try:
            async with session.get(f"{NEXTDNS_BASE_URL}/profiles") as res:
                if res.status != 200:
                    text = await res.text()
                    log(f"[!] Error listing profiles: {res.status} - {text}")
                    return None, None
                data = await res.json()
                profiles = data.get('data', [])
                for p in profiles:
                    if p.get('name') == profile_name:
                        pid = p.get('id')
                        log(f"[+] Found existing daily profile: {pid} (REUSING)")
                        await _ensure_denylist_blocks(session, pid, log)
                        config_link = f"https://apple.nextdns.io/?profile={pid}"
                        log(f"[SUCCESS] DNS VIP Node Active (Reused). Link: {config_link}")
                        return pid, config_link
        except Exception as e:
            log(f"[!] Error during list profiles: {str(e)}")

        # 2. Create new if not found
        log(f"[*] Creating new daily profile: {profile_name}")
        log(f"[*] Initializing High-Speed VIP DNS Node...")
        payload = {"name": profile_name}

        try:
            async with session.post(f"{NEXTDNS_BASE_URL}/profiles", json=payload) as res:
                if res.status != 200:
                    text = await res.text()
                    log(f"[!] Create profile failed: {res.status} - {text}")
                    return None, None
                data = await res.json()
                pid = data.get('data', {}).get('id')
                if not pid:
                    log("[!] No profile ID returned after creation")
                    return None, None
                log(f"[+] Profile created: {pid}")
                await _ensure_denylist_blocks(session, pid, log)
                config_link = f"https://apple.nextdns.io/?profile={pid}"
                log(f"[SUCCESS] DNS VIP Node Active. Link: {config_link}")
                return pid, config_link
        except Exception as e:
            log(f"[!] Error creating profile: {str(e)}")
            return None, None

async def _ensure_denylist_blocks(session: aiohttp.ClientSession, pid: str, log):
    """Internal: Apply & verify blocks for RevenueCat domains"""
    denylist_url = f"{NEXTDNS_BASE_URL}/profiles/{pid}/denylist"
    domains_to_block = [
        "revenuecat.com",
        "api.revenuecat.com",
        "rc.com",
        "www.revenuecat.com"
    ]
    log(f"[>] Applying Anti-Revoke Rules ({len(domains_to_block)} domains)...")

    for domain in domains_to_block:
        # Payload ĐÚNG: object đơn lẻ (không array, không wrap "denylist")
        payload = {
            "id": domain,
            "active": True
        }
        try:
            async with session.post(denylist_url, json=payload) as r:
                text = await r.text()
                log(f"[Block {domain}] Status: {r.status} - Response: {text or 'Empty (success)'}")
                if r.status not in (200, 201):
                    log(f"[!] Block {domain} FAILED: {r.status} - {text}")
                else:
                    log(f"[+] Blocked: {domain} (Status {r.status})")
        except Exception as e:
            log(f"[!] Error blocking {domain}: {str(e)}")
        await asyncio.sleep(2.0)  # tăng sleep lên 2s để tránh rate limit

    # Verify
    try:
        async with session.get(denylist_url) as verify_r:
            if verify_r.status == 200:
                verify_data = await verify_r.json()
                rules = verify_data.get('data', [])
                blocked = [d.get('id') for d in rules if d.get('active')]
                log(f"[+] Verified blocked domains: {', '.join(blocked) or 'None visible yet'}")
                if blocked:
                    log("[SUCCESS] Denylist has been applied! ✅")
                else:
                    log("[WARNING] Denylist still empty after apply - check logs above")
            else:
                text = await verify_r.text()
                log(f"[!] Verify denylist failed: {verify_r.status} - {text}")
    except Exception as e:
        log(f"[!] Verify error: {str(e)}")

async def add_to_denylist(api_key: str, profile_id: str, domain: str, log_callback=None):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json"
    }

    url = f"{NEXTDNS_BASE_URL}/profiles/{profile_id}/denylist"
    payload = {
        "id": domain,
        "active": True
    }  # object đơn lẻ

    async with aiohttp.ClientSession(headers=headers) as session:
        try:
            async with session.post(url, json=payload) as r:
                text = await r.text() if r.status != 200 else ""
                log(f"[Add {domain}] Status: {r.status} - Response: {text}")
                if r.status in (200, 201):
                    log(f"[+] Added to denylist: {domain}")
                else:
                    log(f"[!] Add failed: {r.status} - {text}")
        except Exception as e:
            log(f"[!] Error: {str(e)}")