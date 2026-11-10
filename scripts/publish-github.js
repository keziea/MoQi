/**
 * 发布 GitHub Release 并上传安装包。
 *
 * 为什么不用 GitHub Actions：Actions 需要排队、且历史上有环境问题；
 * 这里直接调 REST API，几秒就能确认结果。
 *
 * 用法：node scripts/publish-github.js
 * 前置：release/Moqi-<版本>-Setup.exe 与 -portable.7z 已就位；
 *       docs/releases/v<版本>.md 已写好；
 *       本机 git 凭据里存有可用的 GitHub token。
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'keziea';
const REPO = 'MoQi';

const { version } = require(path.join(ROOT, 'package.json'));
const TAG = `v${version}`;
const BODY = fs.readFileSync(path.join(ROOT, 'docs', 'releases', `${TAG}.md`), 'utf8');
const ASSETS = [
  path.join(ROOT, 'release', `Moqi-${version}-Setup.exe`),
  path.join(ROOT, 'release', `Moqi-${version}-portable.7z`),
];

function token() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const line = out.split('\n').find((l) => l.startsWith('password='));
  if (!line) throw new Error('没有从 git 凭据里取到 GitHub token');
  return line.slice('password='.length).trim();
}

const TOKEN = token();

function api(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'moqi-release',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {
            /* 非 JSON 响应 */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${urlPath} -> ${res.statusCode} ${buf.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function upload(uploadUrl, file) {
  return new Promise((resolve, reject) => {
    const name = path.basename(file);
    const size = fs.statSync(file).size;
    const url = new URL(uploadUrl.replace('{?name,label}', ''));
    url.searchParams.set('name', name);

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'moqi-release',
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`  上传成功 ${name}（${(size / 1024 / 1024).toFixed(1)} MB）`);
            resolve();
          } else {
            reject(new Error(`上传 ${name} 失败 -> ${res.statusCode} ${buf.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    fs.createReadStream(file).pipe(req);
  });
}

(async () => {
  console.log(`\n▸ 发布 GitHub Release ${TAG}`);

  for (const file of ASSETS) {
    if (!fs.existsSync(file)) throw new Error(`缺少发布包：${file}`);
  }

  // 已存在就复用，避免重复创建报 422
  let release = null;
  try {
    release = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    // Actions 自动发布时 body 来自 workflow 模板，会和 docs/releases/ 不一致；
    // 这里统一覆盖成发布说明原文，保证 GitHub 与 Gitee 逐字相同。
    release = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, {
      name: `墨栖 ${TAG}`,
      body: BODY,
    });
    console.log(`  已存在 Release #${release.id}，说明已同步为 docs/releases/${TAG}.md`);
  } catch {
    release = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      target_commitish: 'main',
      name: `墨栖 ${TAG}`,
      body: BODY,
      draft: false,
      prerelease: false,
    });
    console.log(`  已创建 Release #${release.id}`);
  }

  const existing = new Set((release.assets ?? []).map((a) => a.name));
  for (const file of ASSETS) {
    const name = path.basename(file);
    if (existing.has(name)) {
      console.log(`  跳过（已存在同名附件）：${name}`);
      continue;
    }
    await upload(release.upload_url, file);
  }

  const final = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  console.log(`\n  最终状态：draft=${final.draft} prerelease=${final.prerelease}`);
  for (const asset of final.assets) {
    console.log(`  - ${asset.name}  ${asset.size} 字节  ${asset.state}`);
  }
  console.log(`  页面：${final.html_url}\n`);
})().catch((err) => {
  console.error('\n发布失败：', err.message);
  process.exit(1);
});
