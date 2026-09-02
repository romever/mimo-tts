# MiMo TTS Studio

一个基于 React + Vite 的 MiMo TTS WebUI，面向语音创作者和开发者，提供预置音色、设计音色和音色复刻三种工作流。

## 功能概览

- 预置音色：使用 `mimo-v2.5-tts`，支持冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean。
- 设计音色：使用 `mimo-v2.5-tts-voicedesign`，通过自然语言描述声音特征。
- 音色复刻：使用 `mimo-v2.5-tts-voiceclone`，上传 MP3 / WAV 音频样本。
- 声音库：独立管理内置音色和本地自建音色，支持收藏、详情、试听、编辑、重命名、删除和在工作台使用。
- 本地音色资产：设计音色保存描述文本，复刻音色的样本保存到 `data/voices/`，刷新或重启后仍可使用。
- 文本编辑：支持文本计数、风格标签、停顿和音频标签入口。
- 音频输出：支持 WAV 和 MP3；预置音色默认启用流式输出。
- 音色试听：声音库中的试听按钮会调用真实的 MiMo TTS 请求。
- 音频操作：生成结果支持在线播放、进度控制、跳转、重命名和下载。
- 多音色分段创作：手动拆分文本、为每段选择已保存音色、限并发批量生成，支持单段试听、重生成和完整 WAV 合成。
- 响应解析：支持 MiMo 返回的 Base64 音频和 Data URL 音频；流式 PCM16 会封装为可播放 WAV。

详细的模型能力、消息格式和参数限制请参考 [MiMo TTS 官方文档](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)。

## 环境要求

请使用 Node.js 22.5+ 环境，并确保浏览器支持现代 JavaScript、Fetch 和 HTML Audio API。项目使用 Node.js 内置的 `node:sqlite` 保存本地配置和音色元数据。

## 快速开始

```bash
npm install
npm run dev
```

启动后打开终端显示的本地地址，默认通常为：

```text
http://localhost:5173
```

也可以显式指定本机访问地址：

```bash
npm run dev -- --host 127.0.0.1
```

## 配置 MiMo API

1. 打开「API 设置」。
2. API Base URL 填写：

   ```text
   https://api.xiaomimimo.com/v1
   ```

3. 填入 API Key 并保存。
4. 返回「工作台」选择模型、音色和文本，然后点击「生成语音」。

在工作台顶部切换到「分段创作」后，可以按换行拆分文本，也可以手动新增、复制、删除和调整段落顺序。每个段落可单独选择声音库中的已保存音色；点击「批量生成」后最多同时生成 3 段。段落生成完成后可单独试听或重新生成，全部满意后点击「合成完整音频」，浏览器会按段落顺序导出一个 WAV 文件。

声音库中的卡片点击后会打开详情面板；只有点击「在工作台使用」才会切换到工作台。创建音色时可以先试听草稿，再选择「保存音色」或「保存并使用」。工作台的「保存当前配置为新音色」始终创建新资产，不会静默覆盖已有音色。

Base URL 可以填写到 `/chat/completions`，应用会识别完整地址；如果只填写 `/v1`，应用会自动拼接 `/chat/completions`。

点击保存后，API Base URL 和 API Key 会写入项目下的 `data/mimo-tts.sqlite`；重新打开或刷新页面时会自动读取。数据库文件只绑定到本机 `127.0.0.1` 的本地配置服务，当前 API Key 以本地 SQLite 文件中的明文保存，尚未接入系统密钥链加密，请勿把数据库文件提交或分享。由于 MiMo 请求仍由浏览器直连，实际部署时需要确认 MiMo API 的 CORS 配置；生产环境更建议通过服务端代理调用，避免在浏览器中暴露 API Key。

本地配置服务默认监听 `127.0.0.1:8787`。可以通过 `MIMO_TTS_API_PORT` 修改端口，或通过 `MIMO_TTS_DB_PATH` 指定 SQLite 文件路径。音色管理接口包括 `/api/voices`、`/api/voices/:id`、`/api/voices/:id/sample` 和 `/api/voice-preferences`。

## MiMo 请求约定

应用按 MiMo 文档组织请求：

- 目标合成文本放在 `messages` 的 `assistant` 消息中。
- 预置音色和音色复刻的风格指令放在 `user` 消息中。
- 设计音色的声音描述放在 `user` 消息中。
- 预置音色开启流式输出时，请求使用 `audio.format: "pcm16"`，并按 24kHz、单声道、16-bit PCM 封装为 WAV。
- 设计音色和音色复刻在当前 UI 中使用非流式请求。
- 音色复刻样本仅接受 MP3 / WAV；应用会校验文件签名，并按官方要求限制 Base64 编码后的大小不超过 10 MB。

## 常用命令

```bash
# 启动开发服务器
npm run dev

# 运行音频协议与播放逻辑测试
npm test

# 构建生产文件
npm run build

# 预览生产构建结果
npm run preview
```

## 项目结构

```text
.
├── src/
│   ├── main.jsx                    # 页面、工作台和交互逻辑
│   ├── styles.css                  # 页面样式与响应式布局
│   └── services/
│       ├── mimoClient.js           # MiMo API 请求、SSE 和音频格式处理
│       ├── audioPlayback.js        # 播放进度同步逻辑
│       ├── audioComposer.js         # 浏览器端音频解码、拼接和 WAV 导出
│       ├── settingsClient.js       # 本地 API 配置接口
│       └── voiceClient.js          # 本地音色资源接口
├── server/
│   ├── api.mjs                     # 本地配置与音色资源 HTTP 服务
│   ├── database.mjs                # SQLite 初始化与配置读写
│   ├── voiceStore.mjs              # 音色元数据、样本文件和收藏持久化
│   └── dev.mjs                     # 同时启动前端和本地服务
├── vite.config.js                  # /api 请求代理
├── tests/
│   ├── mimoClient.test.mjs         # 音频响应、播放和请求映射测试
│   ├── settingsPersistence.test.mjs # SQLite 配置持久化测试
│   └── voiceStore.test.mjs         # 音色资源、样本和路径安全测试
├── index.html
├── package.json
└── package-lock.json
```

## 当前限制

- 本地服务负责 API 配置和音色资源持久化，MiMo API 请求仍由浏览器直接发起。
- 「历史记录」页面目前使用界面演示数据，生成结果尚未自动持久化到历史记录。
- 音频标签的增删交互已经提供，但当前尚未自动把标签拼接到最终请求文本中。
- 当前声音库不包含项目、权限、版本历史、云同步、导入导出和复杂标签体系。
- 分段草稿、段落音频和完整合成音频仅保留在当前浏览器会话，不会写入历史记录或服务端文件。
- 分段模式只引用声音库中的已保存音色；工作台中尚未保存的设计描述或复刻样本不能直接带入分段生成。

## 开发说明

音频处理代码会根据实际字节签名识别 WAV / MPEG；无法识别的响应会直接报错，避免把错误数据当作可播放音频继续处理。流式音频只在预置音色模式启用，并严格按照 MiMo 的 PCM16 音频约定拼接。
