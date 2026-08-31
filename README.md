# MiMo TTS Studio

一个基于 React + Vite 的 MiMo TTS WebUI，面向语音创作者和开发者，提供预置音色、设计音色和音色复刻三种工作流。

## 功能概览

- 预置音色：使用 `mimo-v2.5-tts`，支持冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean。
- 设计音色：使用 `mimo-v2.5-tts-voicedesign`，通过自然语言描述声音特征。
- 音色复刻：使用 `mimo-v2.5-tts-voiceclone`，上传 MP3 / WAV 音频样本。
- 文本编辑：支持文本计数、风格标签、停顿和音频标签入口。
- 音频输出：支持 WAV 和 MP3；预置音色默认启用流式输出。
- 音色试听：声音库中的试听按钮会调用真实的 MiMo TTS 请求。
- 音频操作：生成结果支持在线播放、进度控制、跳转、重命名和下载。
- 响应解析：支持 MiMo 返回的 Base64 音频和 Data URL 音频；流式 PCM16 会封装为可播放 WAV。

详细的模型能力、消息格式和参数限制请参考 [MiMo TTS 官方文档](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)。

## 环境要求

请使用能够运行 Vite 5 的 Node.js 环境，并确保浏览器支持现代 JavaScript、Fetch 和 HTML Audio API。

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

Base URL 可以填写到 `/chat/completions`，应用会识别完整地址；如果只填写 `/v1`，应用会自动拼接 `/chat/completions`。

当前 API Key 只保存在页面内存中，不会写入 `localStorage`。刷新页面后需要重新填写。由于这是浏览器直连 API 的前端应用，实际部署时需要确认 MiMo API 的 CORS 配置；生产环境更建议通过服务端代理调用，避免在浏览器中暴露 API Key。

## MiMo 请求约定

应用按 MiMo 文档组织请求：

- 目标合成文本放在 `messages` 的 `assistant` 消息中。
- 预置音色和音色复刻的风格指令放在 `user` 消息中。
- 设计音色的声音描述放在 `user` 消息中。
- 预置音色开启流式输出时，请求使用 `audio.format: "pcm16"`，并按 24kHz、单声道、16-bit PCM 封装为 WAV。
- 设计音色和音色复刻在当前 UI 中使用非流式请求。
- 音色复刻样本仅接受 MP3 / WAV，大小不能超过 10 MB。

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
│       └── audioPlayback.js        # 播放进度同步逻辑
├── tests/
│   └── mimoClient.test.mjs         # 音频响应和播放逻辑回归测试
├── index.html
├── package.json
└── package-lock.json
```

## 当前限制

- 当前项目没有后端服务，API 请求由浏览器直接发起。
- 「历史记录」页面目前使用界面演示数据，生成结果尚未自动持久化到历史记录。
- 音频标签的增删交互已经提供，但当前尚未自动把标签拼接到最终请求文本中。
- 音色库目前展示的是内置预置音色；设计音色和复刻音色需要从工作台创建，尚未建立本地音色资源管理。
- 当前仅支持单条文本生成，不包含批量合成、任务队列和服务端文件存储。

## 开发说明

音频处理代码会根据实际字节签名识别 WAV / MPEG；无法识别的响应会直接报错，避免把错误数据当作可播放音频继续处理。流式音频只在预置音色模式启用，并严格按照 MiMo 的 PCM16 音频约定拼接。
