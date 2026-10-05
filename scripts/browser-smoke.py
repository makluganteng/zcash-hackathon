"""Three independent browser bidders against an existing LOCAL auction.
Requires Python Playwright + Chromium. Does not create an auction or simulate payment.
Usage: python3 scripts/browser-smoke.py AUCTION_ID [http://localhost:3000]
Private identity backups/storage state are saved under ignored .data/browser-tests.
"""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

auction_id = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"
if not auction_id.isdigit() or not base.startswith(("http://localhost:", "http://127.0.0.1:")):
    raise SystemExit("This smoke test is local-only.")
private = Path(".data/browser-tests") / auction_id
private.mkdir(parents=True, exist_ok=True)
os.chmod(private, 0o700)
evidence = Path(".omx/evidence")
evidence.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for i, amount in enumerate(["2", "5", "3"], 1):
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{base}/auctions/{auction_id}", wait_until="networkidle")
        config = page.request.get(f"{base}/api/config").json()
        if config["chainId"] != 31337:
            raise RuntimeError("Refusing browser fixtures on a public chain")
        page.get_by_role("button", name="Create local identity").click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Export backup").click()
        path = private / f"identity-{i}.json"
        download.value.save_as(str(path))
        os.chmod(path, 0o600)
        page.get_by_label("Your sealed bid").fill(amount)
        responses = []
        page.on("response", lambda r: responses.append(r) if f"/api/auctions/{auction_id}/bids" in r.url and r.request.method == "POST" else None)
        page.get_by_role("button", name="Encrypt & submit bid").click()
        try:
            page.wait_for_function("document.body.innerText.includes('REGISTRATION PENDING') || document.body.innerText.includes('BID ACCEPTED') || !!document.querySelector('.notice.error[role=alert]')", timeout=60000)
            if not responses:
                raise RuntimeError(page.locator(".notice.error[role=alert]").inner_text())
            response = responses[-1]
            receipt = response.json()
            if response.status != 200:
                raise RuntimeError(json.dumps(receipt))
            if errors:
                raise RuntimeError(json.dumps(errors))
            path = private / f"profile-{i}.json"
            context.storage_state(path=str(path))
            os.chmod(path, 0o600)
            page.screenshot(path=str(evidence / f"auction-{auction_id}-bidder-{i}.png"), full_page=True)
            results.append({"bidder": i, "receipt": receipt, "pageErrors": errors})
            print(json.dumps({"bidder": i, "status": receipt["status"], "pageErrors": errors}), flush=True)
        except Exception:
            page.screenshot(path=str(evidence / "browser-bid-failure.png"), full_page=True)
            raise
        finally:
            context.close()
    browser.close()
(evidence / f"browser-auction-{auction_id}.json").write_text(json.dumps(results, indent=2) + "\n")
