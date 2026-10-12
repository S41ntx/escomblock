#!/usr/bin/env python3
"""Turn app/dist-artifact/index.html into a body-only page for hosts that wrap
the content in their own <html>/<head>/<body> skeleton (e.g. Claude Artifacts).

usage: scripts/artifact-page.py app/dist-artifact/index.html out.html
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()

title = re.search(r"<title>.*?</title>", html, re.S).group(0)
links = re.findall(r'<link rel="stylesheet"[^>]*>', html)
styles = re.findall(r"<style[^>]*>.*?</style>", html, re.S)
scripts = re.findall(r"<script[^>]*>.*?</script>", html, re.S)

page = "\n".join([title, *links, *styles, '<div id="root"></div>', *scripts]) + "\n"
open(out, "w", encoding="utf-8").write(page)
print(f"wrote {out} ({len(page) / 1024:.0f} KiB)")
