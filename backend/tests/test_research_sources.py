from datetime import timezone
from unittest import TestCase
from unittest.mock import patch

from backend.research.sources import _parse_reuters_feed, fetch_reuters_news


REUTERS_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>NVDA rises as chip demand strengthens - Reuters</title>
      <link>https://news.google.com/rss/articles/example</link>
      <guid>reuters-example-1</guid>
      <pubDate>Fri, 04 Sep 2026 14:08:14 GMT</pubDate>
      <description><![CDATA[Chip demand improves]]></description>
      <source url="https://www.reuters.com">Reuters</source>
    </item>
  </channel>
</rss>"""


class ResearchSourceTests(TestCase):
    def test_reuters_feed_is_parsed_with_ticker_and_publisher_metadata(self) -> None:
        items = _parse_reuters_feed(
            REUTERS_RSS,
            "https://news.google.com/rss/search",
            {"NVDA"},
        )

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].source, "Reuters")
        self.assertEqual(items[0].ticker, "NVDA")
        self.assertEqual(items[0].topic, "company")
        self.assertEqual(items[0].published_at.tzinfo, timezone.utc)
        self.assertEqual(items[0].raw_data["retrieval_source"], "Google News RSS")
        self.assertEqual(items[0].raw_data["publisher_url"], "https://www.reuters.com")

    @patch("backend.research.sources._request")
    def test_reuters_fetch_uses_public_index_when_no_direct_feed_is_configured(self, request) -> None:
        request.return_value.text = REUTERS_RSS
        with patch.dict("os.environ", {"REUTERS_NEWS_ENABLED": "true", "REUTERS_RSS_URLS": ""}, clear=False):
            items = fetch_reuters_news({"NVDA"}, max_items=10)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].source, "Reuters")
        self.assertEqual(request.call_count, 4)
        queries = [call.kwargs["params"]["q"] for call in request.call_args_list]
        self.assertTrue(any("semiconductor" in query for query in queries))
        self.assertTrue(any("NVDA" in query for query in queries))
