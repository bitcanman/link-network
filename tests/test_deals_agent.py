import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "sites/linkcowboy/today/agent/extract_deals.py"
spec = importlib.util.spec_from_file_location("deals_agent", path)
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class DealsMergeTests(unittest.TestCase):
    def setUp(self):
        self.source = {"name": "Cafe", "url": "https://example.com", "type": "business"}
        self.old = agent.normalize({
            "business": "Cafe", "deal": "$5 special", "days": ["Mon"], "times": "2-6pm",
            "requirements": ["student ID"], "category": "food", "alcohol": True,
            "expires_at": "2026-09-20", "address": "Old address",
        }, self.source, "2026-09-19")

    def test_refresh_changes_fields_and_clears_expiration_without_dropping_deal(self):
        fresh = agent.normalize({
            "business": "Cafe", "deal": "$5 special", "days": ["Tue"], "times": "",
            "requirements": [], "category": "drink", "alcohol": False,
            "expires_at": None, "address": "New address",
        }, self.source, "2026-09-21")
        kept, stats = agent.merge([self.old], [fresh], 45, "2026-09-21")
        self.assertEqual(stats, {"added": 0, "refreshed": 1, "expired": 0, "total": 1})
        for field in ("days", "times", "requirements", "category", "alcohol", "expires_at", "address"):
            self.assertEqual(kept[0][field], fresh[field])
        self.assertEqual(kept[0]["first_seen"], "2026-09-19")
        self.assertEqual(kept[0]["verified_at"], "2026-09-21")
        self.assertEqual(self.old["days"], ["Mon"])

    def test_omitted_fields_preserve_existing_values(self):
        self.old["expires_at"] = None
        fresh = agent.normalize({"business": "Cafe", "deal": "$5 special"}, self.source, "2026-09-21")
        kept, _ = agent.merge([self.old], [fresh], 45, "2026-09-21")
        for field in ("days", "times", "requirements", "category", "alcohol", "address"):
            self.assertEqual(kept[0][field], self.old[field])

    def test_expired_and_stale_deals_are_still_removed(self):
        kept, stats = agent.merge([self.old], [], 45, "2026-09-21")
        self.assertEqual(kept, [])
        self.assertEqual(stats["expired"], 1)
        self.old.update(expires_at=None, verified_at="2026-08-06")
        kept, _ = agent.merge([self.old], [], 45, "2026-09-21")
        self.assertEqual(kept, [])

    def test_new_deal_has_defaults_when_optional_fields_are_missing(self):
        fresh = agent.normalize({"business": "Cafe", "deal": "$5 special"}, self.source, "2026-09-21")
        kept, stats = agent.merge([], [fresh], 45, "2026-09-21")
        self.assertEqual(kept[0]["requirements"], [])
        self.assertIsNone(kept[0]["expires_at"])
        self.assertEqual(stats["added"], 1)


if __name__ == "__main__":
    unittest.main()
