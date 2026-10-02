#!/usr/bin/env python3
"""Helper script to extract clean structured text and links from raw HTML or text."""

import argparse
import json
import sys
from html.parser import HTMLParser
from typing import Dict, List, Any

class SimpleHTMLCleaner(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_chunks: List[str] = []
        self.links: List[Dict[str, str]] = []
        self.title: str = ""
        self._in_title = False
        self._ignore_tags = {"script", "style", "nav", "footer", "noscript"}
        self._current_tag_stack: List[str] = []
        self._current_link_text: List[str] = []
        self._current_href: str = ""

    def handle_starttag(self, tag, attrs):
        self._current_tag_stack.append(tag)
        attrs_dict = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "a" and "href" in attrs_dict:
            self._current_href = attrs_dict["href"]
            self._current_link_text = []

    def handle_endtag(self, tag):
        if self._current_tag_stack and self._current_tag_stack[-1] == tag:
            self._current_tag_stack.pop()
        if tag == "title":
            self._in_title = False
        elif tag == "a" and self._current_href:
            link_text = "".join(self._current_link_text).strip()
            if link_text and self._current_href.startswith(("http://", "https://", "/")):
                self.links.append({"text": link_text, "url": self._current_href})
            self._current_href = ""
            self._current_link_text = []

    def handle_data(self, data):
        if any(ignored in self._current_tag_stack for ignored in self._ignore_tags):
            return
        cleaned = data.strip()
        if not cleaned:
            return
        if self._in_title:
            self.title = (self.title + " " + cleaned).strip()
        else:
            self.text_chunks.append(cleaned)
            if self._current_href:
                self._current_link_text.append(cleaned)

def extract_content(html_content: str) -> Dict[str, Any]:
    parser = SimpleHTMLCleaner()
    try:
        parser.feed(html_content)
    except Exception as e:
        return {"error": str(e), "title": "", "content": "", "links": []}
    return {
        "title": parser.title,
        "content": "\n".join(parser.text_chunks),
        "links": parser.links[:50],
        "total_chunks": len(parser.text_chunks)
    }

def main():
    parser = argparse.ArgumentParser(description="Structured Data Web Extractor")
    parser.add_argument("--input", "-i", type=str, help="Input HTML file path (default: stdin)")
    parser.add_argument("--output", "-o", type=str, help="Output JSON file path (default: stdout)")
    args = parser.parse_args()

    raw_html = ""
    if args.input:
        with open(args.input, "r", encoding="utf-8", errors="ignore") as f:
            raw_html = f.read()
    else:
        raw_html = sys.stdin.read()

    data = extract_content(raw_html)
    json_output = json.dumps(data, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json_output)
    else:
        print(json_output)

if __name__ == "__main__":
    main()
