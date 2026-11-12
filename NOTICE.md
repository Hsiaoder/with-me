# 许可与素材声明

## 本项目

Copyright (C) 2026 Hsiaoder

本程序是自由软件：你可以在 Free Software Foundation 发布的 **GNU General Public License
版本 3**（不含更高版本选项）条款下再分发和/或修改它。

本程序发行的同时期望它有用，但**不提供任何担保**；连适销性或特定用途适用性的隐含担保也不提供。
完整条款见仓库根 [`LICENSE`](LICENSE)。

**源码与安装包同处**：本次安装包（`with-me-<版本>-setup.exe`）与免压 zip 对应的完整机器可读源码
就在本仓库的同一个 GitHub Release 的 tag 里。这是 GPLv3 §6 的要求，不是好意——
只要这些安装包还挂着，源码就得一直可取。

## 台词与语音（受 GPL-3.0-only 覆盖的那部分）

`src/shared/talk.ts` 的 `TALK_LINES` **改写自** [qqpet](https://github.com/AnkioTomas/qqpet)
（© Ankio，以 GPL-3.0-only 发布）的 talk/greet 数据。

- 改动日期：2026-11-10。
- 改了什么：过滤掉暴露企鹅身份与腾讯相关的句子；`[host]` 统一替换为「主人」；
  超过气泡三行容量的长句剔除。未压缩语义、未改写成原创。
- qqpet 的许可证只豁免它 `resources/pet` 下的原版美术素材（见其 README 的许可声明），
  台词数据不属豁免，因此这条派生关系是**本项目整体按 GPL-3.0-only 发行**的原因。

`src/renderer/voice/` 的 200 条 mp3（16MB）是上述台词的朗读，由 BreezeBlue TTS 合成，
属同一条派生链。平台条款允许再分发（账号持有人 2026-11-12 确认），所以语音随包发行。

## 其他素材逐项

| 位置 | 许可 | 出处与说明 |
|---|---|---|
| `src/renderer/icons`、`foods`、`emotes` | CC0-1.0 | [Kenney](https://kenney.nl) UI Pack / Emotes；部分按本项目配色重染、削描边。CC0 无署名义务，这里写出来是为了可追溯 |
| `src/renderer/fonts` | OFL-1.1 | Noto Sans SC 可变字重子集与 Fredoka 数字子集。两份 `OFL-*.txt` 是**上游发布的原文，逐字节不改**——其中思源那份的版权行写的是 Adobe 与保留名 `Source`，这是 google/fonts 对 Noto Sans SC 的原始发布正文；子集已改名 `with-me-*`，没有使用保留名 |
| `skins/block` | GPL-3.0-only | 本项目 `tools/make-test-skin.mjs` 用 ffmpeg 现场生成的蓝幕抠像片段，纯占位 |
| `assets/with-me.ico` | GPL-3.0-only | 本项目自制：由 `src/renderer/icons/game-fly.png`（ImageGen 出图）缩放，用作 exe 与托盘图标 |

新增任何第三方素材都要登记进 [`licenses.json`](licenses.json)，
`node tools/check-licenses.mjs` 会在 CI 拦住没登记的那一份。

## 大肥鱼形象（**不在本程序授权范围内**）

大肥鱼形象与动画原片来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，
授权为 **CC BY-NC-SA 4.0**（署名 · 非商业 · 相同方式共享），**禁止商用**。

- 它以**单独的皮肤包**形式在同一个 GitHub Release 提供，许可与署名见包内 `ATTRIBUTION.md`。
- 本仓库与两个安装包**都不含这些素材**，一个字节都不带；许可闸门（`tools/check-licenses.mjs`）会拦。
- 应用图标与托盘图标**没有使用大肥鱼形象**：`assets/with-me.ico` 是一尾通用蓝鲸（本项目自制），
  避免把 CC BY-NC-SA 素材带进 GPL 主程序。
- 本程序的 GPL 授权不覆盖、也不会放开该形象。想商用的一律用内置的 `block` 皮肤或自皮肤。
- 形象谱系（按 dsh-pet 的要求转述）：大肥鱼是社区二创的 DeepSeek「鲸鱼娘」，**非 DeepSeek 官方形象**；
  原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)，
  DeepSeek 版（女仆鲸鱼娘）设计出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。
