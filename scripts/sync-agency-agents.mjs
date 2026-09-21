#!/usr/bin/env node
/**
 * Regenerate src/agent/workspaces/agency-agents.catalog.json from
 * https://github.com/msitarzewski/agency-agents (via jsDelivr + gh tree API).
 *
 * Usage: node scripts/sync-agency-agents.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = `
import json, re, subprocess, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

raw = subprocess.check_output([
  'gh','api','repos/msitarzewski/agency-agents/git/trees/main?recursive=1'
], text=True)
tree = json.loads(raw)['tree']
skip_dirs = {'integrations','strategy','examples','scripts','.github'}
paths = []
for t in tree:
    if t.get('type') != 'blob' or not t['path'].endswith('.md'):
        continue
    parts = t['path'].split('/')
    if len(parts) != 2: continue
    div, name = parts
    if div in skip_dirs: continue
    paths.append(t['path'])
print(f'agent files: {len(paths)}', flush=True)

FM_RE = re.compile(r'^---\\s*\\n(.*?)\\n---\\s*\\n', re.S)

def parse_fm(text):
    m = FM_RE.match(text)
    if not m: return {}
    data = {}
    for line in m.group(1).splitlines():
        if ':' not in line: continue
        k, v = line.split(':', 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    return data

def slugify(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower().strip())
    return s.strip('-')[:48] or 'agent'

def fetch(path):
    url = f'https://cdn.jsdelivr.net/gh/msitarzewski/agency-agents@main/{path}'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            content = r.read().decode('utf-8', errors='replace')
    except Exception as e:
        return None, str(e)
    fm = parse_fm(content)
    name = fm.get('name') or Path(path).stem.replace('-', ' ').title()
    desc = fm.get('description') or ''
    vibe = fm.get('vibe') or ''
    div = path.split('/')[0]
    body = FM_RE.sub('', content, count=1).strip()
    lines = [ln for ln in body.splitlines() if ln.strip()]
    excerpt_lines = []
    for ln in lines:
        excerpt_lines.append(ln)
        if len('\\n'.join(excerpt_lines)) > 1800: break
    excerpt = '\\n'.join(excerpt_lines).strip()
    stem = Path(path).stem
    prefix = div + '-'
    if stem.startswith(prefix): stem = stem[len(prefix):]
    bot_id = slugify(stem)
    system = (
        f"You are {name}. {desc}\\n"
        + (f"Vibe: {vibe}\\n" if vibe else "")
        + f"\\n{excerpt}\\n\\n"
        + "Respond in Indonesian unless the user asks otherwise. "
        + "In workspace group chat, speak ONLY as your own role — stay concise and complementary. "
        + f"\\n[Agency source: https://github.com/msitarzewski/agency-agents/blob/main/{path}]"
    )
    tools = ["ls","read_file","glob","web_search","web_extract"]
    if div in {'engineering','testing','security','product','project-management','specialized','gis','spatial-computing','game-development'}:
        tools = ["ls","read_file","glob","grep","execute","write_file","edit_file","web_search","web_extract"]
    skills = ["pdf"] if any(x in bot_id for x in ('writer','proposal','content','document')) else None
    return {
        "id": bot_id,
        "name": name[:64],
        "role": name[:64],
        "description": (desc or vibe or name)[:240],
        "systemPrompt": system[:6000],
        "tools": tools,
        **({"skills": skills} if skills else {}),
        "active": True,
        "agencySource": path,
        "division": div,
    }, None

agents = []
errors = 0
with ThreadPoolExecutor(max_workers=16) as ex:
    futs = {ex.submit(fetch, p): p for p in paths}
    done = 0
    for fut in as_completed(futs):
        done += 1
        if done % 30 == 0 or done == len(paths):
            print(f'  progress {done}/{len(paths)} errors={errors}', flush=True)
        r, err = fut.result()
        if r is None: errors += 1
        else: agents.append(r)

from collections import defaultdict
by_div = defaultdict(list)
seen = defaultdict(set)
for a in sorted(agents, key=lambda x: (x['division'], x['id'])):
    div = a['division']
    bid = a['id']
    if bid in seen[div]:
        bid = slugify(f"{bid}-{a['agencySource'].split('/')[-1][:12]}")
        a = {**a, 'id': bid}
    seen[div].add(bid)
    entry = {k:v for k,v in a.items() if k != 'division'}
    by_div[div].append(entry)

try:
    with urllib.request.urlopen('https://cdn.jsdelivr.net/gh/msitarzewski/agency-agents@main/divisions.json', timeout=30) as r:
        div_meta = json.loads(r.read().decode())['divisions']
except Exception:
    div_meta = {}

out = {
    "source": "https://github.com/msitarzewski/agency-agents",
    "generatedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    "divisionMeta": div_meta,
    "divisions": {k: v for k,v in sorted(by_div.items())},
}
out_path = Path(${JSON.stringify(join(root, "src/agent/workspaces/agency-agents.catalog.json"))})
out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
print('wrote', out_path, 'agents', sum(len(v) for v in by_div.values()), 'errors', errors, flush=True)
`;

const result = spawnSync("python3", ["-c", py], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(result.status ?? 1);
