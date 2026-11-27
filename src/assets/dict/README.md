# 内置字词库

`dict.json` 是构建产物，不要手改。重新生成：

```bash
node scripts/build-dict.js
```

脚本默认从系统临时目录读取三个源文件，也可以用环境变量指定：

| 变量 | 文件 | 说明 |
|---|---|---|
| `MOQI_DICT_WORD` | `word.json` | 单字：拼音、部首、笔画、释义 |
| `MOQI_DICT_MODERN` | `XDHYCD7th.txt` | 《现代汉语词典》第 7 版全文，词语与单字释义（优先） |
| `MOQI_DICT_CI` | `ci.json` | 古汉语词语（没有现代词典时的退路） |
| `MOQI_DICT_FREQ` | `jieba.txt` | 词频，用来只保留常用词 |

## 数据来源与许可

- 单字基础信息：[pwxcoo/chinese-xinhua](https://github.com/pwxcoo/chinese-xinhua)，MIT 许可。
- 现代单字/词语释义与拼音：[CNMan/XDHYCD7th](https://github.com/CNMan/XDHYCD7th)，社区校对的《现代汉语词典》第 7 版全文。
- 词频：[fxsjy/jieba](https://github.com/fxsjy/jieba)，MIT 许可。

《现代汉语词典》正文版权归商务印书馆所有；上面的社区文本只适合个人学习使用。**如果要商业发行，请自行取得授权，或替换为有明确授权的词库**（例如 CC-CEDICT）。

## 生成物的结构

```json
{
  "v": 1,
  "chars": { "一": ["yī", "一", 1, "", "1. 数目…\n2. 纯，专…"] },
  "words": { "认真": ["rèn zhēn", "1. 严肃对待，不马虎。"] }
}
```

- `chars[字]`：`[全部读音用 | 分隔, 部首, 笔画, 结构(暂空), 释义用 \n 分隔]`
- `words[词]`：`[整词拼音, 释义用 \n 分隔]`；拼音为空时前端不猜读音

运行时不联网，所有查询都在本机完成。
