import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  History,
  Info,
  KeyRound,
  Library,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { syncPlaybackPosition } from './services/audioPlayback';
import { fileExtensionForAudioBlob, fileToDataUrl, modelIdFor, synthesize } from './services/mimoClient';
import { loadApiSettings, saveApiSettings } from './services/settingsClient';
import './styles.css';

const VOICES = [
  { id: '冰糖', name: '冰糖', language: '中文', gender: '女性', tone: '温柔知性', color: 'lilac' },
  { id: '茉莉', name: '茉莉', language: '中文', gender: '女性', tone: '清亮自然', color: 'rose' },
  { id: '苏打', name: '苏打', language: '中文', gender: '男性', tone: '明快有力', color: 'sky' },
  { id: '白桦', name: '白桦', language: '中文', gender: '男性', tone: '沉稳磁性', color: 'green' },
  { id: 'Mia', name: 'Mia', language: '英文', gender: '女性', tone: 'Warm & clear', color: 'peach' },
  { id: 'Chloe', name: 'Chloe', language: '英文', gender: '女性', tone: 'Bright & lively', color: 'violet' },
  { id: 'Milo', name: 'Milo', language: '英文', gender: '男性', tone: 'Deep & warm', color: 'blue' },
  { id: 'Dean', name: 'Dean', language: '英文', gender: '男性', tone: 'Calm & precise', color: 'slate' },
];

const STYLE_TAGS = ['开心', '温柔', '磁性', '知识讲解', '粤语', '唱歌'];
const AUDIO_TAGS = ['吸气', '深呼吸', '轻笑', '叹气', '低语', '提高音量'];
const FORMAT_OPTIONS = [
  { value: 'wav', label: 'WAV（24kHz｜PCM16）' },
  { value: 'mp3', label: 'MP3（44.1kHz｜128kbps）' },
];

const MODE_CONFIG = {
  preset: {
    label: '预置音色',
    description: '使用 MiMo 精品音色，支持低延迟流式输出',
    model: 'mimo-v2.5-tts',
  },
  design: {
    label: '设计音色',
    description: '用自然语言描述声音特征，生成专属音色',
    model: 'mimo-v2.5-tts-voicedesign',
  },
  clone: {
    label: '音色复刻',
    description: '上传 MP3 / WAV 音频样本复刻目标声音',
    model: 'mimo-v2.5-tts-voiceclone',
  },
};

const INITIAL_TEXT =
  'MiMo TTS Studio 是一款专业的中文语音合成工具，\n面向创作者与开发者，提供自然、稳定、可控的语音合成体验。\n支持多种模型与音色选择，轻松生成高质量语音内容，\n助力您的创作与产品落地。';

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return '00:00';
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
}

function maskApiKey(apiKey) {
  if (apiKey.length <= 8) return '••••••••';
  return apiKey.slice(0, 4) + '••••••••' + apiKey.slice(-4);
}

function AppIcon({ name, size = 18, strokeWidth = 1.8 }) {
  const icons = {
    workbench: AudioLines,
    library: Library,
    history: History,
    api: Code2,
  };
  const Icon = icons[name] || Activity;
  return <Icon size={size} strokeWidth={strokeWidth} />;
}

function Sidebar({ page, onNavigate, mobileOpen, onClose, apiReady }) {
  const items = [
    { id: 'workbench', label: '工作台', icon: 'workbench' },
    { id: 'library', label: '声音库', icon: 'library' },
    { id: 'history', label: '历史记录', icon: 'history' },
    { id: 'api', label: 'API 设置', icon: 'api' },
  ];

  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={onClose} />}
      <aside className={'sidebar ' + (mobileOpen ? 'is-open' : '')}>
        <div className="brand">
          <span className="brand-mark"><AudioLines size={19} strokeWidth={2.4} /></span>
          <span>MiMo TTS Studio</span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <div className="nav-section-label">创作空间</div>
          {items.map((item) => (
            <button type="button" key={item.id} className={'nav-item ' + (page === item.id ? 'active' : '')} onClick={() => { onNavigate(item.id); onClose(); }}>
              <AppIcon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'workbench' && <span className="nav-live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={16} />
            <div><strong>MiMo V2.5</strong><span>让每句话都有自己的声音</span></div>
          </div>
          <div className="sidebar-footer">
            <span className={'status-dot ' + (apiReady ? '' : 'demo')} /> {apiReady ? 'API 已配置' : '演示模式'}
            <button type="button" className="collapse-button" aria-label="收起侧栏"><ChevronLeft size={16} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ title, onOpenMenu, onOpenApi }) {
  return (
    <header className="topbar">
      <button type="button" className="mobile-menu-button" aria-label="打开导航" onClick={onOpenMenu}><Menu size={20} /></button>
      <div className="topbar-title"><h1>{title}</h1><span className="topbar-breadcrumb">MiMo V2.5 TTS</span></div>
      <div className="topbar-actions">
        <a href="https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5" target="_blank" rel="noreferrer"><BookOpen size={17} /> 文档</a>
        <button type="button" onClick={onOpenApi}><Settings2 size={17} /> 设置</button>
        <span className="icon-only" aria-label="通知"><Activity size={18} /></span>
        <div className="profile"><span className="avatar">LY</span><span>开发者</span><ChevronDown size={15} /></div>
      </div>
    </header>
  );
}

function ModelTabs({ mode, onChange }) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="选择 TTS 模型">
      {Object.entries(MODE_CONFIG).map(([id, config]) => (
        <button type="button" role="tab" aria-selected={mode === id} className={'mode-tab ' + (mode === id ? 'active' : '')} key={id} onClick={() => onChange(id)}>
          <span>{config.label}</span>{mode === id && <Check size={15} />}
        </button>
      ))}
    </div>
  );
}

function VoicePicker({ voice, onChange }) {
  const [open, setOpen] = useState(false);
  const current = VOICES.find((item) => item.id === voice) || VOICES[0];
  return (
    <div className="field-group">
      <div className="field-label-row"><label>音色选择</label><Settings2 size={15} className="plain-icon" /></div>
      <div className="voice-picker">
        <button type="button" className="voice-picker-trigger" onClick={() => setOpen((value) => !value)}>
          <span className={'voice-avatar ' + current.color}><Volume2 size={16} /></span>
          <span className="voice-copy"><strong>{current.name} · {current.gender}</strong><small>{current.language} <i /> {current.tone}</small></span>
          {current.id === '冰糖' && <span className="new-label">NEW</span>}
          <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
        </button>
        {open && (
          <div className="voice-options">
            {VOICES.map((item) => (
              <button type="button" className={'voice-option ' + (item.id === voice ? 'selected' : '')} key={item.id} onClick={() => { onChange(item.id); setOpen(false); }}>
                <span className={'voice-avatar small ' + item.color}><Volume2 size={14} /></span>
                <span><strong>{item.name}</strong><small>{item.language} · {item.tone}</small></span>
                {item.id === voice && <Check size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TextEditor({ text, onChange, onInsert, onClear }) {
  const count = text.length;
  return (
    <section className="editor-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">创作内容</span><h2>文本内容</h2></div>
        <div className="heading-actions"><span className="counter">{count} / 5000</span><button type="button" className="clear-button" onClick={onClear}><Trash2 size={14} /> 清空</button></div>
      </div>
      <textarea value={text} maxLength={5000} onChange={(event) => onChange(event.target.value)} placeholder="输入想要合成的文本..." aria-label="文本内容" />
      <div className="editor-footer">
        <div className="editor-tools">
          <button type="button" onClick={() => onInsert('（停顿片刻）')}><Clock3 size={14} /> 插入停顿</button>
          <button type="button" onClick={() => onInsert('（轻笑）')}><Sparkles size={14} /> 发音词典</button>
          <button type="button" onClick={() => onInsert('“”')}><FilePlus2 size={14} /> 多音字</button>
          <button type="button" onClick={() => onInsert('1,234.56')}><Activity size={14} /> 数字读法</button>
        </div>
        <span className="editor-hint">assistant 消息将作为目标文本发送</span>
      </div>
    </section>
  );
}

function TagInput({ tags, onRemove, onAdd }) {
  const [value, setValue] = useState('');
  const addTag = () => {
    const next = value.trim();
    if (next && !tags.includes(next)) onAdd(next);
    setValue('');
  };
  return (
    <div className="tag-input">
      <div className="tag-list">
        {tags.map((tag) => <span className="tag" key={tag}>{tag}<button type="button" aria-label={'移除' + tag} onClick={() => onRemove(tag)}><X size={12} /></button></span>)}
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="添加标签" aria-label="添加音频标签" />
        <button type="button" className="add-tag-button" onClick={addTag}><Plus size={14} /> 添加标签</button>
      </div>
    </div>
  );
}

function StyleField({ value, onChange, mode }) {
  const placeholder = mode === 'design'
    ? '例如：一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。'
    : '例如：语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。';
  const example = mode === 'design'
    ? '一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。'
    : '语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。';
  return (
    <div className="field-group">
      <div className="field-label-row"><label>{mode === 'design' ? '音色描述' : '风格指令'}</label><button type="button" className="help-link" onClick={() => onChange(example)}><CircleHelp size={14} /> 示例</button></div>
      <textarea className="compact-textarea" value={value} maxLength={mode === 'design' ? 600 : 200} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="textarea-count">{value.length} / {mode === 'design' ? 600 : 200}</div>
    </div>
  );
}

function CloneUploader({ file, onFileChange }) {
  const inputRef = useRef(null);
  const handleChange = async (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].includes(nextFile.type)) {
      onFileChange({ error: '仅支持 MP3 和 WAV 音频样本' });
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      onFileChange({ error: '音频样本不能超过 10 MB' });
      return;
    }
    const dataUrl = await fileToDataUrl(nextFile);
    onFileChange({ file: nextFile, dataUrl });
  };
  return (
    <div className="field-group">
      <div className="field-label-row"><label>音色样本</label><span className="field-note">MP3 / WAV · ≤ 10 MB</span></div>
      <button type="button" className={'upload-box ' + (file?.file ? 'has-file' : '')} onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden onChange={handleChange} />
        {file?.file ? (
          <><span className="upload-icon success"><Check size={18} /></span><span className="upload-copy"><strong>{file.file.name}</strong><small>{(file.file.size / 1024 / 1024).toFixed(2)} MB · 已准备好</small></span><ChevronRight size={16} /></>
        ) : (
          <><span className="upload-icon"><UploadCloud size={18} /></span><span className="upload-copy"><strong>上传音色样本</strong><small>点击选择或拖拽音频文件</small></span><ChevronRight size={16} /></>
        )}
      </button>
      {file?.error && <p className="error-text">{file.error}</p>}
    </div>
  );
}

function OutputSettings({ format, onFormatChange, stream, onStreamChange, disabled }) {
  return (
    <>
      <div className="field-group">
        <div className="field-label-row"><label>输出格式</label></div>
        <div className="select-wrap"><select value={format} onChange={(event) => onFormatChange(event.target.value)}>{FORMAT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={16} /></div>
      </div>
      <div className={'stream-row ' + (disabled ? 'disabled' : '')}>
        <div><div className="stream-title"><label>流式输出</label><Info size={14} /></div><p>{disabled ? '设计音色与音色复刻暂不支持低延迟流式' : '实时返回音频流，降低首字延迟'}</p></div>
        <button type="button" className={'switch ' + (stream && !disabled ? 'on' : '')} disabled={disabled} aria-label="切换流式输出" onClick={() => onStreamChange(!stream)}><span /></button>
      </div>
    </>
  );
}

function Inspector(props) {
  const {
    mode, onModeChange, voice, onVoiceChange, styleInstruction, onStyleChange, voiceDescription,
    onVoiceDescriptionChange, cloneFile, onCloneFileChange, tags, onRemoveTag, onAddTag,
    format, onFormatChange, stream, onStreamChange, optimizePreview, onOptimizePreview, apiReady,
  } = props;
  const isDesign = mode === 'design';
  const isClone = mode === 'clone';
  return (
    <aside className="inspector-panel">
      <div className="inspector-heading"><div><span className="section-kicker">生成配置</span><h2>模型选择</h2></div><span className={'api-ready ' + (apiReady ? '' : 'demo')}><span /> {apiReady ? '已配置' : '演示模式'}</span></div>
      <ModelTabs mode={mode} onChange={onModeChange} />
      <p className="mode-description">{MODE_CONFIG[mode].description}</p>
      {mode === 'preset' && <VoicePicker voice={voice} onChange={onVoiceChange} />}
      {isClone && <CloneUploader file={cloneFile} onFileChange={onCloneFileChange} />}
      <StyleField mode={isDesign ? 'design' : 'style'} value={isDesign ? voiceDescription : styleInstruction} onChange={isDesign ? onVoiceDescriptionChange : onStyleChange} />
      {!isDesign && (
        <div className="field-group">
          <div className="field-label-row"><label>音频标签</label><Info size={14} /></div>
          <TagInput tags={tags} onRemove={onRemoveTag} onAdd={onAddTag} />
          <div className="suggested-tags">{AUDIO_TAGS.map((tag) => <button type="button" key={tag} onClick={() => onAddTag(tag)}>+ {tag}</button>)}</div>
        </div>
      )}
      {isDesign && <div className="optimize-row"><div><label>优化文本预览</label><p>让模型根据音色描述润色播报文本</p></div><button type="button" className={'switch ' + (optimizePreview ? 'on' : '')} aria-label="切换优化文本预览" onClick={() => onOptimizePreview(!optimizePreview)}><span /></button></div>}
      <OutputSettings format={format} onFormatChange={onFormatChange} stream={stream} onStreamChange={onStreamChange} disabled={isDesign || isClone} />
      <div className="inspector-footer"><span><Zap size={14} /> {modelIdFor(mode)}</span><span>24kHz mono</span></div>
    </aside>
  );
}

function Waveform({ progress = 0 }) {
  const bars = useMemo(() => Array.from({ length: 72 }, (_, index) => 24 + ((index * 19) % 44)), []);
  return <div className="waveform" aria-label="音频波形">{bars.map((height, index) => <span key={index} className={index / bars.length <= progress ? 'played' : ''} style={{ height: height + '%' }} />)}</div>;
}

function OutputPanel({ result, audioRef, isPlaying, progress, duration, onToggle, onSeek, onJump, onRename, onDownload }) {
  const hasAudio = Boolean(result.audioUrl);
  const displayDuration = duration || result.duration;
  return (
    <section className="output-panel">
      <audio key={result.audioUrl || 'empty-audio'} ref={audioRef} preload="auto" src={result.audioUrl || undefined} onTimeUpdate={(event) => onSeek(event.currentTarget.currentTime / (event.currentTarget.duration || 1), false)} onLoadedMetadata={(event) => onSeek(0, true, event.currentTarget.duration)} onEnded={() => onToggle(false)} />
      <div className="output-heading"><div><span className="section-kicker">最近生成</span><h2>输出结果</h2></div><div className={'generation-status ' + (hasAudio ? 'success' : 'empty')}><span>{hasAudio ? <Check size={13} /> : <Activity size={13} />}</span>{hasAudio ? '生成完成' : '等待生成'}</div></div>
      <div className="output-content">
        <div className="track-badge"><Music2 size={22} /></div>
        <div className="track-meta"><div className="track-title"><strong>{result.name}</strong><button type="button" aria-label="重命名" disabled={!hasAudio} onClick={onRename}><Settings2 size={13} /></button></div><span>{result.modeLabel}{hasAudio ? ' · ' + result.format.toUpperCase() + ' · ' + formatTime(displayDuration) : ''}</span></div>
        <div className="waveform-wrap"><Waveform progress={hasAudio ? progress : 0} /><div className="track-time">{hasAudio ? formatTime(displayDuration * progress) + ' / ' + formatTime(displayDuration) : '生成后显示音频波形'}</div></div>
        <div className="player-controls"><button type="button" aria-label="后退 10 秒" disabled={!hasAudio} onClick={() => onJump(-10)}><RotateCcw size={17} /></button><button type="button" aria-label="上一段" disabled={!hasAudio} onClick={() => onJump(-5)}><ChevronLeft size={20} /></button><button type="button" className="play-button" disabled={!hasAudio} onClick={() => onToggle()} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button type="button" aria-label="下一段" disabled={!hasAudio} onClick={() => onJump(5)}><ChevronRight size={20} /></button><button type="button" aria-label="前进 10 秒" disabled={!hasAudio} onClick={() => onJump(10)}><RotateCcw size={17} className="flip-x" /></button></div>
        <input className="seek-slider" type="range" min="0" max="1" step="0.001" value={progress} disabled={!hasAudio} aria-label="音频进度" onChange={(event) => onSeek(Number(event.target.value), true)} />
        <div className="output-actions"><span className="file-size">{result.sizeLabel || '生成后显示文件大小'}</span><button type="button" className="download-button" disabled={!hasAudio} onClick={onDownload}><Download size={16} /> 下载音频 <ChevronDown size={15} /></button></div>
      </div>
    </section>
  );
}

function GenerateButton({ isGenerating, onGenerate, stream }) {
  return <button type="button" className="generate-button" disabled={isGenerating} onClick={onGenerate}>{isGenerating ? <LoaderCircle size={18} className="spin" /> : <AudioLines size={19} />}<span>{isGenerating ? '正在生成…' : '生成语音'}</span>{!isGenerating && <span className="generate-meta">{stream ? '流式' : '标准'} <ChevronDown size={15} /></span>}</button>;
}

function Workbench(props) {
  return (
    <div className="workbench-page">
      <div className="workspace-grid">
        <div className="editor-column">
          <TextEditor text={props.text} onChange={props.onTextChange} onInsert={props.onInsert} onClear={props.onClear} />
          <div className="editor-actions"><div className="text-suggestions">{STYLE_TAGS.map((tag) => <button type="button" key={tag} onClick={() => props.onInsert('（' + tag + '）')}>{tag}</button>)}</div><GenerateButton isGenerating={props.isGenerating} onGenerate={props.onGenerate} stream={props.stream && props.mode === 'preset'} /></div>
        </div>
        <Inspector {...props} />
      </div>
      <OutputPanel result={props.result} audioRef={props.audioRef} isPlaying={props.isPlaying} progress={props.progress} duration={props.duration} onToggle={props.onToggle} onSeek={props.onSeek} onJump={props.onJump} onRename={props.onRename} onDownload={props.onDownload} />
    </div>
  );
}

function VoiceLibrary({ selectedVoice, onSelect, onCreate, onPreview, previewingVoice }) {
  return (
    <div className="page-content">
      <div className="page-intro"><div><span className="section-kicker">探索声音</span><h2>声音库</h2><p>预置音色可以直接用于 MiMo 预置音色模型，设计与复刻音色从工作台创建。</p></div><button type="button" className="secondary-button" onClick={onCreate}><Plus size={16} /> 创建声音</button></div>
      <div className="library-toolbar"><div className="library-tabs"><button className="active" type="button">预置音色 <span>8</span></button><button type="button">我的声音 <span>0</span></button></div><span className="library-note"><LockKeyhole size={14} /> 音色仅在当前浏览器中配置</span></div>
      <div className="voice-grid">
        {VOICES.map((voice) => <article className={'voice-card ' + (selectedVoice === voice.id ? 'selected' : '')} key={voice.id}><button type="button" className="voice-card-body" onClick={() => onSelect(voice.id)}><div className={'voice-card-icon ' + voice.color}><Volume2 size={19} /></div><div className="voice-card-copy"><strong>{voice.name}</strong><span>{voice.gender} · {voice.language}</span><small>{voice.tone}</small></div></button><button type="button" className="voice-card-play" aria-label={'试听 ' + voice.name} onClick={() => onPreview(voice)}>{previewingVoice === voice.id ? <LoaderCircle size={14} className="spin" /> : <Play size={14} fill="currentColor" />}</button>{selectedVoice === voice.id && <span className="selected-mark"><Check size={13} /></span>}</article>)}
      </div>
    </div>
  );
}

function HistoryPage({ onReuse }) {
  const [rows, setRows] = useState([
    { name: '工作台·知识讲解_001', model: 'mimo-v2.5-tts', voice: '冰糖', time: '今天 14:32', duration: '00:28' },
    { name: '深夜电台片段', model: 'mimo-v2.5-tts-voicedesign', voice: '设计音色', time: '昨天 21:08', duration: '00:42' },
    { name: '产品发布会开场', model: 'mimo-v2.5-tts-voiceclone', voice: '音色复刻', time: '8 月 22 日', duration: '01:16' },
  ]);
  return (
    <div className="page-content">
      <div className="page-intro"><div><span className="section-kicker">创作轨迹</span><h2>历史记录</h2><p>每次生成都会保留在本地，方便回听与复用配置。</p></div><button type="button" className="secondary-button" onClick={() => setRows([])}><Trash2 size={16} /> 清空记录</button></div>
      <div className="history-table"><div className="history-head"><span>名称</span><span>模型</span><span>音色</span><span>生成时间</span><span>时长</span><span /></div>{rows.length ? rows.map((row) => <div className="history-row" key={row.name}><div className="history-name"><span className="track-mini"><Music2 size={15} /></span><strong>{row.name}</strong></div><span className="mono">{row.model}</span><span>{row.voice}</span><span>{row.time}</span><span>{row.duration}</span><button type="button" className="text-button" onClick={onReuse}>复用</button></div>) : <div className="history-empty"><History size={18} /><span>还没有历史记录</span></div>}</div>
    </div>
  );
}

function ApiSettings({ api, savedApiKey, onApiChange, onSave, persistenceStatus }) {
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const statusLabels = {
    loading: '正在读取',
    ready: '已连接',
    saving: '保存中',
    error: '连接失败',
  };
  const statusLabel = statusLabels[persistenceStatus];
  const isBusy = persistenceStatus === 'loading' || persistenceStatus === 'saving';
  const hasSavedApiKey = Boolean(savedApiKey);
  const hasUnsavedKey = api.apiKey !== savedApiKey;

  useEffect(() => {
    if (persistenceStatus === 'ready' && api.apiKey === savedApiKey) {
      setEditingKey(false);
      setShowKey(false);
    }
  }, [api.apiKey, persistenceStatus, savedApiKey]);

  const cancelKeyEdit = () => {
    onApiChange({ apiKey: savedApiKey });
    setEditingKey(false);
    setShowKey(false);
  };

  return (
    <div className="page-content settings-page">
      <div className="page-intro"><div><span className="section-kicker">连接服务</span><h2>API 设置</h2><p>配置 MiMo OpenAI 兼容接口后，即可在工作台生成真实音频。</p></div><span className="secure-badge"><LockKeyhole size={14} /> 本地 SQLite</span></div>
      <div className="settings-layout">
        <section className="settings-card">
          <div className="settings-card-title"><div className="settings-title-icon"><KeyRound size={18} /></div><div><h3>MiMo API</h3><p>默认使用官方 API Base URL</p></div><span className={'settings-status ' + persistenceStatus}><span /> {statusLabel}</span></div>
          <label className="form-label">API Base URL</label>
          <div className="input-with-prefix"><input value={api.endpoint} disabled={isBusy} onChange={(event) => onApiChange({ endpoint: event.target.value })} aria-label="API Base URL" /></div>
          <p className="form-help">默认请求路径为 /v1/chat/completions，也支持填入完整的 chat/completions 地址。</p>
          <label className="form-label">API Key</label>
          {hasSavedApiKey && !editingKey && !hasUnsavedKey ? (
            <div className="saved-key-panel">
              <div className="saved-key-info"><span className="saved-key-icon"><LockKeyhole size={16} /></span><div className="saved-key-copy"><strong>API Key 已保存</strong><span className="saved-key-value">{showKey ? savedApiKey : maskApiKey(savedApiKey)}</span></div></div>
              <div className="saved-key-actions"><button type="button" disabled={isBusy} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '查看'}</button><button type="button" disabled={isBusy} onClick={() => { setEditingKey(true); setShowKey(false); }}><Settings2 size={14} /> 修改</button></div>
            </div>
          ) : (
            <>
              <div className="input-with-action"><input type={showKey ? 'text' : 'password'} value={api.apiKey} disabled={isBusy} onChange={(event) => onApiChange({ apiKey: event.target.value })} placeholder="sk-..." aria-label="API Key" /><button type="button" disabled={isBusy} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '查看'}</button></div>
              <div className="key-edit-actions"><span>{hasSavedApiKey ? '修改后点击“保存设置”' : '保存后将写入本地 SQLite'}</span>{hasSavedApiKey && <button type="button" disabled={isBusy} onClick={cancelKeyEdit}>取消修改</button>}</div>
            </>
          )}
          <div className="security-note"><LockKeyhole size={15} /><span>配置会保存到本项目本地 SQLite 文件；数据库仅由本机服务监听，API 请求仍由浏览器直接发送。</span></div>
          <div className="settings-actions"><button type="button" className="primary-button" disabled={persistenceStatus === 'loading' || persistenceStatus === 'saving'} onClick={onSave}><Save size={16} /> {persistenceStatus === 'saving' ? '保存中…' : '保存设置'}</button></div>
        </section>
        <section className="settings-card capabilities-card">
          <div className="settings-card-title"><div className="settings-title-icon violet"><WandSparkles size={18} /></div><div><h3>模型能力</h3><p>来自 MiMo TTS v2.5 官方文档</p></div></div>
          {Object.entries(MODE_CONFIG).map(([id, config]) => <div className="capability-row" key={id}><span className="capability-dot" /><div><strong>{config.label}</strong><span>{config.model}</span></div><Check size={16} /></div>)}
          <a className="docs-link" href="https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5" target="_blank" rel="noreferrer">查看接入文档 <ChevronRight size={15} /></a>
        </section>
      </div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <div className={'toast ' + toast.type}><span>{toast.type === 'error' ? <CircleHelp size={16} /> : <Check size={16} />}</span><p>{toast.message}</p><button type="button" onClick={onClose}><X size={15} /></button></div>;
}

function App() {
  const [page, setPage] = useState('workbench');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState('preset');
  const [text, setText] = useState(INITIAL_TEXT);
  const [voice, setVoice] = useState('冰糖');
  const [styleInstruction, setStyleInstruction] = useState('语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。');
  const [voiceDescription, setVoiceDescription] = useState('一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。');
  const [cloneFile, setCloneFile] = useState(null);
  const [tags, setTags] = useState(['知识讲解', '自然', '亲和']);
  const [format, setFormat] = useState('wav');
  const [stream, setStream] = useState(true);
  const [optimizePreview, setOptimizePreview] = useState(true);
  const [api, setApi] = useState({ endpoint: 'https://api.xiaomimimo.com/v1', apiKey: '' });
  const [savedApiKey, setSavedApiKey] = useState('');
  const [apiPersistenceStatus, setApiPersistenceStatus] = useState('loading');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState(null);
  const audioRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewUrlRef = useRef('');
  const previewRequestRef = useRef(0);
  const resultUrlRef = useRef('');
  const [previewingVoice, setPreviewingVoice] = useState('');
  const [result, setResult] = useState(() => ({ name: '尚未生成音频', modeLabel: '输入文本后开始生成', format: 'wav', duration: 0, sizeLabel: '', audioUrl: '' }));
  const apiReady = Boolean(api.apiKey.trim());

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.removeAttribute('src');
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    // Blob URL 更新后显式重新加载，避免浏览器继续使用上一个媒体资源的解码状态。
    audioRef.current.load();
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
  }, [result.audioUrl]);

  const title = page === 'workbench' ? '工作台' : page === 'library' ? '声音库' : page === 'history' ? '历史记录' : 'API 设置';
  const changeMode = (nextMode) => { setMode(nextMode); setStream(nextMode === 'preset'); if (nextMode !== 'preset') setFormat('wav'); };
  const updateApi = (patch) => setApi((current) => ({ ...current, ...patch }));
  const insertText = (value) => setText((current) => current + (current && !current.endsWith('\n') ? ' ' : '') + value);
  const addTag = (tag) => setTags((current) => current.includes(tag) ? current : [...current, tag]);
  const removeTag = (tag) => setTags((current) => current.filter((item) => item !== tag));
  const showToast = (type, message) => setToast({ type, message });

  useEffect(() => {
    let active = true;
    loadApiSettings()
      .then((savedApi) => {
        if (!active) return;
        setApi(savedApi);
        setSavedApiKey(savedApi.apiKey);
        setApiPersistenceStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setApiPersistenceStatus('error');
        showToast('error', error instanceof Error ? error.message : '读取本地 API 配置失败');
      });
    return () => {
      active = false;
    };
  }, []);

  const persistApiSettings = async () => {
    setApiPersistenceStatus('saving');
    try {
      const savedApi = await saveApiSettings(api);
      setApi(savedApi);
      setSavedApiKey(savedApi.apiKey);
      setApiPersistenceStatus('ready');
      showToast('success', 'API 设置已保存到本地 SQLite');
    } catch (error) {
      setApiPersistenceStatus('error');
      showToast('error', error instanceof Error ? error.message : '保存本地 API 配置失败');
    }
  };

  const stopVoicePreview = () => {
    previewRequestRef.current += 1;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.removeAttribute('src');
      previewAudioRef.current.load();
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }
    setPreviewingVoice('');
  };

  const previewVoice = async (voiceToPreview) => {
    if (previewingVoice === voiceToPreview.id) {
      stopVoicePreview();
      return;
    }
    if (!api.apiKey.trim()) {
      showToast('error', '请先在 API 设置中配置 API Key');
      setPage('api');
      return;
    }

    stopVoicePreview();
    const requestId = previewRequestRef.current;
    setPreviewingVoice(voiceToPreview.id);
    try {
      const audioBlob = await synthesize({
        endpoint: api.endpoint,
        apiKey: api.apiKey,
        mode: 'preset',
        text: '你好，这是 MiMo TTS Studio 的音色试听。',
        styleInstruction: '语气自然、清晰、亲切，适合试听音色。',
        voiceDescription: '',
        voice: voiceToPreview.id,
        format: 'wav',
        stream: false,
        optimizeTextPreview: false,
        cloneVoice: undefined,
      });
      if (requestId !== previewRequestRef.current) return;
      const audioUrl = URL.createObjectURL(audioBlob);
      previewUrlRef.current = audioUrl;
      const previewAudio = previewAudioRef.current;
      previewAudio.src = audioUrl;
      previewAudio.load();
      await previewAudio.play();
      if (requestId === previewRequestRef.current) showToast('success', voiceToPreview.name + '试听已开始');
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      stopVoicePreview();
      showToast('error', error instanceof Error ? error.message : '音色试听失败，请检查 API 设置');
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) { showToast('error', '请先输入要合成的文本'); return; }
    if (mode === 'design' && !voiceDescription.trim()) { showToast('error', '设计音色模式需要填写音色描述'); return; }
    if (mode === 'clone' && !cloneFile?.dataUrl) { showToast('error', '音色复刻模式需要先上传 MP3 或 WAV 样本'); return; }
    if (!api.apiKey.trim()) { showToast('error', '请先在 API 设置中配置 API Key'); setPage('api'); return; }
    setIsGenerating(true);
    try {
      const audioBlob = await synthesize({ endpoint: api.endpoint, apiKey: api.apiKey, mode, text, styleInstruction, voiceDescription, voice, format, stream, optimizeTextPreview: optimizePreview, cloneVoice: cloneFile?.dataUrl });
      const outputFormat = fileExtensionForAudioBlob(audioBlob);
      const audioUrl = URL.createObjectURL(audioBlob);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = audioUrl;
      setResult({ name: '工作台·语音合成_' + new Date().toISOString().slice(0, 10).replaceAll('-', ''), modeLabel: MODE_CONFIG[mode].label + (mode === 'preset' ? ' · ' + voice : ''), format: outputFormat, duration: 0, sizeLabel: (audioBlob.size / 1024).toFixed(0) + ' KB', audioUrl });
      setProgress(0);
      setDuration(0);
      setIsPlaying(false);
      showToast('success', '语音已生成，可以试听或下载');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '生成失败，请检查 API 设置与请求参数');
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlayback = async (forcedValue) => {
    if (!audioRef.current || !result.audioUrl) return;
    const nextPlaying = typeof forcedValue === 'boolean' ? forcedValue : !isPlaying;
    if (nextPlaying) await audioRef.current.play();
    else audioRef.current.pause();
    setIsPlaying(nextPlaying);
  };
  const seekAudio = (nextProgress, shouldSeek, nextDuration) => {
    if (nextDuration) setDuration(nextDuration);
    setProgress(nextProgress);
    // 播放进度回调只更新界面；只有拖动进度条或初始化时才真正修改播放位置。
    syncPlaybackPosition(audioRef.current, nextProgress, shouldSeek);
  };
  const downloadAudio = () => { if (!result.audioUrl) return; const link = document.createElement('a'); link.href = result.audioUrl; link.download = result.name + '.' + result.format; link.click(); };
  const jumpAudio = (seconds) => {
    if (!audioRef.current || !Number.isFinite(audioRef.current.duration)) return;
    const nextTime = Math.min(audioRef.current.duration, Math.max(0, audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = nextTime;
    setProgress(nextTime / audioRef.current.duration);
  };
  const renameAudio = () => {
    const nextName = window.prompt('重命名音频', result.name);
    if (nextName?.trim()) setResult((current) => ({ ...current, name: nextName.trim() }));
  };

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={setPage} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} apiReady={apiReady} />
      <main className="main-area">
        <Topbar title={title} onOpenMenu={() => setMobileOpen(true)} onOpenApi={() => setPage('api')} />
        <div className="page-scroller">
          {page === 'workbench' && <Workbench mode={mode} onModeChange={changeMode} text={text} onTextChange={setText} onInsert={insertText} onClear={() => setText('')} voice={voice} onVoiceChange={setVoice} styleInstruction={styleInstruction} onStyleChange={setStyleInstruction} voiceDescription={voiceDescription} onVoiceDescriptionChange={setVoiceDescription} cloneFile={cloneFile} onCloneFileChange={setCloneFile} tags={tags} onRemoveTag={removeTag} onAddTag={addTag} format={format} onFormatChange={setFormat} stream={stream} onStreamChange={setStream} optimizePreview={optimizePreview} onOptimizePreview={setOptimizePreview} isGenerating={isGenerating} onGenerate={handleGenerate} result={result} audioRef={audioRef} isPlaying={isPlaying} progress={progress} duration={duration} onToggle={togglePlayback} onSeek={seekAudio} onJump={jumpAudio} onRename={renameAudio} onDownload={downloadAudio} apiReady={apiReady} />}
          {page === 'library' && <VoiceLibrary selectedVoice={voice} onSelect={(nextVoice) => { setVoice(nextVoice); setPage('workbench'); }} onPreview={previewVoice} previewingVoice={previewingVoice} onCreate={() => { setMode('design'); setPage('workbench'); showToast('success', '已切换到设计音色模式'); }} />}
          {page === 'history' && <HistoryPage onReuse={() => { setPage('workbench'); showToast('success', '已将历史配置载入工作台'); }} />}
          {page === 'api' && <ApiSettings api={api} savedApiKey={savedApiKey} onApiChange={updateApi} onSave={persistApiSettings} persistenceStatus={apiPersistenceStatus} />}
        </div>
      </main>
      <audio ref={previewAudioRef} preload="auto" hidden onEnded={stopVoicePreview} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
