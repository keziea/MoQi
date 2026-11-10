/**
 * 发布 Gitee 发行版并上传安装包。
 *
 * 用法：GITEE_TOKEN=xxx node scripts/publish-gitee.js
 * 前置：release/Moqi-<版本>-Setup.exe 与 -portable.7z 已就位；
 *       docs/releases/v<版本>.md 已写好。
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URLSearchParams } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'azs_A';
const REPO = 'MoQi';

const { version } = require(path.join(ROOT, 'package.json'));
const TAG = `v${version}`;
const BODY = fs.readFileSync(path.join(ROOT, 'docs', 'releases', `${TAG}.md`), 'utf8');
const ASSETS = [
  path.join(ROOT, 'release', `Moqi-${version}-Setup.exe`),
  path.join(ROOT, 'release', `Moqi-${version}-portable.7z`),
];

const TOKEN = process.env.GITEE_TOKEN;
if (!TOKEN) {
  console.error('缺少 GITEE_TOKEN 环境变量');
  process.exit(1);
}

function request(method, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'gitee.com',
        path: urlPath,
        method,
        headers: {
          'User-Agent': 'moqi-release',
          ...(body ? { 'Content-Type': contentType, 'Content-Length': body.length } : {}),
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
            /* 非 JSON */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${urlPath} -> ${res.statusCode} ${buf.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function form(obj) {
  return Buffer.from(new URLSearchParams(obj).toString());
}

function multipart(file) {
  const boundary = `----moqi${Date.now()}`;
  const name = path.basename(file);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([head, fs.readFileSync(file), tail]),
  };
}

(async () => {
  console.log(`\n▸ 发布 Gitee 发行版 ${TAG}`);

  for (const file of ASSETS) {
    if (!fs.existsSync(file)) throw new Error(`缺少发布包：${file}`);
  }

  let release = null;
  try {
    release = await request(
      'GET',
      `/api/v5/repos/${OWNER}/${REPO}/releases/tags/${TAG}?access_token=${encodeURIComponent(TOKEN)}`
    );
    console.log(`  已存在发行版 #${release.id}，将复用并补传附件`);
  } catch {
    release = await request(
      'POST',
      `/api/v5/repos/${OWNER}/${REPO}/releases`,
      form({
        access_token: TOKEN,
        tag_name: TAG,
        name: `墨栖 ${TAG}`,
        body: BODY,
        target_commitish: 'main',
        prerelease: 'false',
      }),
      'application/x-www-form-urlencoded'
    );
    console.log(`  已创建发行版 #${release.id}`);
  }

  const existing = new Set((release.assets ?? []).map((a) => a.name));
  for (const file of ASSETS) {
    const name = path.basename(file);
    if (existing.has(name)) {
      console.log(`  跳过（已存在同名附件）：${name}`);
      continue;
    }
    const { boundary, body } = multipart(file);
    await request(
      'POST',
      `/api/v5/repos/${OWNER}/${REPO}/releases/${release.id}/attach_files?access_token=${encodeURIComponent(TOKEN)}`,
      body,
      `multipart/form-data; boundary=${boundary}`
    );
    console.log(`  上传成功 ${name}（${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB）`);
  }

  const final = await request(
    'GET',
    `/api/v5/repos/${OWNER}/${REPO}/releases/tags/${TAG}?access_token=${encodeURIComponent(TOKEN)}`
  );
  console.log(`\n  最终状态：prerelease=${final.prerelease}`);
  for (const asset of final.assets ?? []) {
    console.log(`  - ${asset.name}  ${asset.size ?? '?'} 字节`);
  }
  console.log(`  页面：https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}\n`);
})().catch((err) => {
  console.error('\n发布失败：', err.message);
  process.exit(1);
});
