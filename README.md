<div align="center">

<img src="src/assets/logo.png" width="108" alt="墨栖" />

# 墨栖 · Moqi

**给文字一个可以久留的地方**

一款 Windows 桌面中文阅读器。没有账号、没有广告、没有推荐、没有云同步。<br />
打开先看到自己的工作台，翻开书就只剩文字。

[![License: MIT](https://img.shields.io/badge/license-MIT-c9a227?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-4b5563?style=flat-square)](#)
[![Electron](https://img.shields.io/badge/Electron-33-47848f?style=flat-square&logo=electron&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white)](#)
[![Offline](https://img.shields.io/badge/100%25%20%E6%9C%AC%E5%9C%B0-%E4%B8%8D%E8%81%94%E7%BD%91-5b8266?style=flat-square)](#)

**GitHub** · https://github.com/keziea/MoQi 　|　 **Gitee** · https://gitee.com/azs_A/ink-residence

</div>

---

## 这是什么

一个给**长时间阅读**用的桌面软件。

它不追求功能堆砌，只追求一件事：**让一个人翻开书之后，忘了软件的存在**。

- 版心只占屏幕一半，一行 33 字左右——这是纸书的密度
- 首行缩进两格、两端对齐、标点不出现在行首
- 默认分页，底部是「第 N / M 页」，不是无尽的滚动条
- 关掉再开，精确回到上次那一行；换字号、改窗口大小也不会丢

## 它不是什么

| 不是 | 原因 |
|---|---|
| ❌ 不是书城 | 没有任何在线书源、推荐、排行榜。书是你自己的文件 |
| ❌ 不是云阅读 | 没有账号、没有同步、没有遥测。断网照常用 |
| ❌ 不是格式转换器 | 只负责读，不改你的原文件 |
| ❌ 不是全平台 | 目前只有 Windows（10 / 11，x64） |

---

## 界面

界面按「工作台 → 书架 → 书籍详情 → 正文」走，没有多余层级，也不会把功能全塞进书本页面。

- **工作台** 首页有今日目标环、继续阅读、今天读了多久、连续阅读、最近笔记和书架一角；左侧五个入口：首页 / 书架 / 笔记 / 阅读统计 / 阅读记录。
- **书架** 同一本书的 EPUB / MOBI / PDF / TXT 会合并成一张卡，格式 pill 直接摆在下方，点一下换一种文件读。
- **书籍详情** 封面、字数、章数、累计阅读、笔记数集中在一屏；下面直接选版本，EPUB 排版最好就默认选它。
- **正文** 一页一页像纸书：`←` `→`、滚轮、长按箭头都能连续翻页。左侧导航栏覆盖在正文留白上，展开也不挤压正文、不会重新分页。
- **目录** 严格按原书层级，这本书就是 9 章 / 133 节，父子关系和原文件一致，不再自己猜。
- **阅读统计** 7 / 30 / 56 天的阅读时长、读得最多的书、笔记习惯放在一起，能一键复制成复盘文字。

---

## 功能一览

### 工作台
启动进入「我的阅读」：左侧首页 / 书架 / 笔记 / 阅读统计 / 阅读记录，不再把功能全塞进书本页面。首页有今日目标环、继续阅读、今天读了多久、连续阅读、最近笔记和书架一角。

### 书架
书库搜索、在读 / 读完 / 未读筛选、最近 / 书名排序；继续阅读卡永远在最上面。

### 读到哪里，永远记得
- **自动续读**：翻页或滚动时悄悄记住位置，关掉再开精确回到同一段
- **「读到此处」标记**：单击某一段，左侧出现书签和竖线；下方浮出「上次标记在《第 3 章》回到那里」

### 划一句，写一句
选中任意文字（可跨段落）浮出四色高亮和「写笔记」；笔记面板按颜色筛选、点击回原文、一键复制全部笔记、导出 Markdown。

### 时间与数据
底栏实时走秒，导航栏有大时钟；数据面板有「今日小结 / 本周 / 这本书 / 我的笔记」四种模板，一键复制成文字。

### 眼睛不累
四套主题：纸白 / 米黄 / 护眼绿 / 夜间。字号 14–32、行距 4 档、字体宋 / 黑 / 楷、版心 5 档，随手就调。

---

## 快速开始

### 方式一：直接用（给只想读书的人）

> **本仓库只收录源码，不收录约 300MB 的打包产物。** 如果 [Releases](../../releases) 页有绿色版，下载解压即可使用；
> 没有的话按下面的方式二自行构建，全程约 2 分钟。

绿色版不需要安装，解压后双击 `墨栖.exe` 即可。

> ⚠️ 绿色版必须放在**路径不含中文、且不在源码目录内**的位置。
> 这是 Electron 在这台机器上的环境限制，详见 [`docs/09-构建与发布.md`](docs/09-构建与发布.md)。

### 方式二：从源码运行（给开发者）

需要 **Node.js ≥ 18**（推荐 20 或 22）和 **Git**。

```bash
# 1. 克隆（两个源任选其一，内容完全同步）
git clone https://github.com/keziea/MoQi.git moqi
# 国内访问 GitHub 慢时，改用 Gitee：
# git clone https://gitee.com/azs_A/ink-residence.git moqi
cd moqi

# 2. 安装依赖
npm install

# 3. 开发模式（改代码即时热更新）
npm run dev
```

### 方式三：自己打一个绿色版

```bash
npm run build        # 编译主进程 + 界面
npm run dist         # 打包 Windows 安装包 → release/
# 或
npm run pack         # 打绿色版 → 输出到项目同级目录
```

打完把整个输出文件夹拷到任意英文路径下，双击 `墨栖.exe` 就能用。

---

## 支持的格式

| 格式 | 说明 |
|---|---|
| **EPUB** | 首选。保留原书目录层级、排版、封面 |
| **MOBI** | 支持早期 Kindle 格式 |
| **PDF** | 适合影印版、扫描版 |
| **TXT** | 自动识别 UTF-8 / GBK 编码，自动分章 |

同一本书有多个格式时自动合并成一本，优先用排版最好的那份。

---

## 快捷键

| 键 | 作用 |
|---|---|
| `Ctrl + O` | 导入书籍 |
| `Ctrl + 1..5` | 切换：首页 / 书架 / 笔记 / 阅读统计 / 阅读记录 |
| `Ctrl + T` | 目录 |
| `Ctrl + N` | 笔记 |
| `Ctrl + D` | 阅读数据 |
| `Ctrl + F` | 搜索全书 |
| `Ctrl + B` | 标记 / 取消标记 |
| `Ctrl + \` | 打开 / 收起左侧导航栏 |
| `Ctrl + =` / `Ctrl + -` | 放大 / 缩小字号 |
| `Space` | 下一页 / 下翻一屏 |
| `Esc` | 关闭面板 / 返回首页 |
| `F11` | 全屏 |

记不住没关系，设置面板里列着，每个按钮也有提示。

---

## 你的数据在哪

```
%APPDATA%\moqi-reader\data\
├── library.json        书库索引
├── settings.json       阅读设置
├── books\              解析缓存（可删，会自动重建）
└── user\
    ├── progress.json   阅读进度与标记
    ├── notes.json      全部笔记
    └── sessions.json   阅读时长
```

**全部在本机，不上传、不联网。** 建议定期备份 `user` 文件夹——那里是你的笔记。

---

## 项目结构

```
moqi-reader/
├── electron/            主进程：窗口、IPC、四种格式的解析器、本地 JSON 存储
│   ├── ipc/             主进程与界面之间的通道
│   ├── parsers/         epub / mobi / pdf / txt 解析
│   └── store/           书库、设置的读写
├── src/                 渲染进程（React）
│   ├── pages/           工作台 / 阅读器
│   ├── components/      书架、阅读器、工作台三组组件
│   ├── store/           zustand 状态
│   └── styles/          按页面拆分的样式
├── shared/              主进程与界面共用的类型定义
├── docs/                设计文档（从 00 开始读）
├── build/               图标等打包资源
└── scripts/             构建与截图脚本
```

技术栈：**Electron 33 + Vite 6 + React 18 + TypeScript 5 + Tailwind 3 + zustand 5 + framer-motion**

---

## 文档

这个项目的规矩是**文档先行**：任何改动先改文档，再改代码。

| 文件 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 项目宪法。接手前只读这一个就够：铁律、文档拓扑、改动牵连矩阵 |
| [`docs/00-项目总览.md`](docs/00-项目总览.md) | 这是什么、给谁用、不做什么 |
| [`docs/01-技术架构.md`](docs/01-技术架构.md) | 进程模型、数据流 |
| [`docs/03-数据模型与存储.md`](docs/03-数据模型与存储.md) | 本地 JSON 结构 |
| [`docs/04-书籍解析规范.md`](docs/04-书籍解析规范.md) | 四种格式怎么解、目录怎么还原 |
| [`docs/06-UI设计规范.md`](docs/06-UI设计规范.md) | 颜色、字号、间距、版心 |
| [`docs/09-构建与发布.md`](docs/09-构建与发布.md) | 打包流程与环境坑 |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | 每一版改了什么、牵连了谁 |

---

## 参与

欢迎提 Issue 和 PR。

- 提 Bug 请附：**系统版本、书籍格式、复现步骤**（能附截图最好）
- 改代码前请先读 [`AGENTS.md`](AGENTS.md)，里面写着什么不能动
- 截图请用 `npx electron scripts/capture-screens.js` 生成，保证和实际界面一致

---

## 许可

[MIT](LICENSE) © 2026 Moqi

随便用、随便改、随便分发，保留版权声明即可。

第三方依赖的许可见 `LICENSES.chromium.html` 与各依赖包自带声明；Electron 相关见 `LICENSE.electron.txt`。
