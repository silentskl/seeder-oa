#!/usr/bin/env python3
"""Regression: Cloudflare Workers do not support fetch redirect='error'."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = (
    "overlay/lib/oa/finance-mail-sync.ts",
    "overlay/app/api/oa/finance/inbound/route.ts",
    "deploy/finance-mail-cron/worker.mjs",
)

class EdgeFetchTests(unittest.TestCase):
    def test_no_unsupported_redirect_error_mode(self):
        for filename in FILES:
            with self.subTest(filename=filename):
                src = (ROOT / filename).read_text()
                self.assertNotRegex(src, r'redirect\s*:\s*["\']error["\']')

    def test_authenticated_requests_do_not_follow_redirects(self):
        src = (ROOT / FILES[0]).read_text()
        self.assertIn('redirect:"manual"', src)
        self.assertIn('response.status>=300&&response.status<400', src)
        worker = (ROOT / FILES[2]).read_text()
        self.assertIn('redirect:"manual"', worker)
        self.assertIn('response.status>=300&&response.status<400', worker)

if __name__ == "__main__":
    unittest.main(verbosity=2)
