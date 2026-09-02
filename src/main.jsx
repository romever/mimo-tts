import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
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
  Mic2,
  Menu,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { syncPlaybackPosition } from './services/audioPlayback';
import { composeAudioSegments } from './services/audioComposer';
import { fileExtensionForAudioBlob, fileToDataUrl, modelIdFor, synthesize } from './services/mimoClient';
import { loadApiSettings, saveApiSettings } from './services/settingsClient';
import {
  createVoiceProfile,
  deleteVoiceProfile,
  loadVoiceProfiles,
  loadVoiceSample,
  setVoiceFavorite,
  updateVoiceProfile,
} from './services/voiceClient';
import { buildCloneDraftFromPreview } from './services/voiceSolidification';
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

const PRESET_VOICE_PREFIX = 'preset:';
const VOICE_DRAFT_ID = 'voice-draft';
const MAX_CLONE_BASE64_BYTES = 10 * 1024 * 1024;
const CLONE_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']);
const DEFAULT_VOICE_DESCRIPTION = '一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。';
const DEFAULT_PREVIEW_TEXT = '你好，这是 MiMo TTS Studio 的音色试听。';
const SEGMENT_BATCH_CONCURRENCY = 3;

let nextSegmentId = 1;

function createSegment(text = '', voiceId = '') {
  return {
    id: 'segment-' + nextSegmentId++,
    text,
    voiceId,
    status: 'idle',
    audioBlob: null,
    audioUrl: '',
    duration: 0,
    error: '',
    generationRevision: 0,
  };
}

function emptyMergedResult() {
  return {
    name: '尚未合成完整音频',
    modeLabel: '全部段落生成满意后开始合成',
    format: 'wav',
    duration: 0,
    sizeLabel: '',
    audioUrl: '',
  };
}

function presetProfile(voice, favoriteIds) {
  const id = PRESET_VOICE_PREFIX + voice.id;
  return {
    id,
    kind: 'preset',
    name: voice.name,
    language: voice.language,
    gender: voice.gender,
    tone: voice.tone,
    color: voice.color,
    providerVoiceId: voice.id,
    voiceDescription: '',
    previewText: null,
    sample: null,
    readOnly: true,
    favorite: favoriteIds.has(id),
  };
}

function customProfile(profile, favoriteIds) {
  return {
    ...profile,
    readOnly: false,
    language: profile.kind === 'design' ? '自定义' : '样本复刻',
    gender: '',
    tone: profile.kind === 'design' ? '文本设计' : '音频样本',
    color: profile.kind === 'design' ? 'violet' : 'peach',
    favorite: favoriteIds.has(profile.id),
  };
}

function profileTypeLabel(profile) {
  return profile.kind === 'preset' ? '内置音色' : profile.kind === 'design' ? '设计音色' : '音色复刻';
}

function profileIcon(profile) {
  if (profile.kind === 'design') return WandSparkles;
  if (profile.kind === 'clone') return Mic2;
  return Volume2;
}

function base64LengthFromDataUrl(dataUrl) {
  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex < 0) return 0;
  return dataUrl.slice(separatorIndex + 1).length;
}

async function readCloneFile(file) {
  if (!CLONE_MIME_TYPES.has(file.type)) {
    throw new Error('仅支持 MP3 和 WAV 音频样本');
  }
  const dataUrl = await fileToDataUrl(file);
  if (base64LengthFromDataUrl(dataUrl) > MAX_CLONE_BASE64_BYTES) {
    throw new Error('复刻样本的 Base64 编码不能超过 10 MB');
  }
  return {
    file,
    dataUrl,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    isNew: true,
  };
}

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

function VoiceSelector({ selectedVoice, voices, onChange, onOpenLibrary, onCreateVoice, voiceLoadError, label = '音色', showLibrary = true, allowCreate = true, compact = false, disabled = false, showLabel = true, showIcon = true, showDetails = true }) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = selectedVoice ? profileIcon(selectedVoice) : Volume2;

  if (!selectedVoice) {
    return (
      <div className={'field-group ' + (compact ? 'compact-voice-field' : '')}>
        {(showLabel || showLibrary) && <div className="field-label-row">{showLabel && <span className="field-label">{label}</span>}{showLibrary && <button type="button" className="plain-icon-button" disabled={disabled} onClick={onOpenLibrary}><Library size={14} /> 声音库</button>}</div>}
        <p className="error-text">当前音色不可用，请从声音库重新选择。</p>
      </div>
    );
  }

  const groupedVoices = [
    { label: '内置音色', items: voices.filter((voice) => voice.kind === 'preset') },
    { label: '我的音色', items: voices.filter((voice) => voice.kind !== 'preset') },
  ];

  return (
    <div className={'field-group ' + (compact ? 'compact-voice-field' : '')}>
      {(showLabel || showLibrary) && <div className="field-label-row">{showLabel && <span className="field-label">{label}</span>}{showLibrary && <button type="button" className="plain-icon-button" disabled={disabled} onClick={onOpenLibrary}><Library size={14} /> 管理声音库</button>}</div>}
      <div className="voice-picker">
        <button type="button" className="voice-picker-trigger" aria-label={!showLabel ? label + '：' + selectedVoice.name : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)}>
          {showIcon && <span className={'voice-avatar ' + selectedVoice.color}><CurrentIcon size={16} /></span>}
          <span className="voice-copy"><strong>{selectedVoice.name}</strong>{showDetails && <small>{profileTypeLabel(selectedVoice)}{selectedVoice.language ? ' · ' + selectedVoice.language : ''}{selectedVoice.gender ? ' · ' + selectedVoice.gender : ''}</small>}</span>
          {showIcon && selectedVoice.favorite && <Star size={14} className="favorite-icon" fill="currentColor" />}
          <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
        </button>
        {open && (
          <div className="voice-options">
            {groupedVoices.map((group) => (
              <div key={group.label} className="voice-option-group">
                <div className="voice-option-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const ItemIcon = profileIcon(item);
                  return (
                    <button type="button" className={'voice-option ' + (item.id === selectedVoice.id ? 'selected' : '')} key={item.id} disabled={disabled} onClick={() => { onChange(item); setOpen(false); }}>
                      <span className={'voice-avatar small ' + item.color}><ItemIcon size={14} /></span>
                      <span><strong>{item.name}</strong><small>{profileTypeLabel(item)}{item.language ? ' · ' + item.language : ''}</small></span>
                      {item.favorite && <Star size={13} className="favorite-icon" fill="currentColor" />}
                      {item.id === selectedVoice.id && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            ))}
            {allowCreate && <button type="button" className="voice-option-create" disabled={disabled} onClick={() => { onCreateVoice('design'); setOpen(false); }}><Plus size={14} /> 新建音色</button>}
          </div>
        )}
      </div>
      {voiceLoadError && <p className="error-text">我的音色暂时无法读取：{voiceLoadError}</p>}
    </div>
  );
}

function WorkbenchModeToggle({ creationMode, onChange, disabled = false }) {
  return (
    <div className="workbench-mode-toggle" role="tablist" aria-label="创作模式">
      <button type="button" role="tab" aria-selected={creationMode === 'single'} className={creationMode === 'single' ? 'active' : ''} disabled={disabled} onClick={() => onChange('single')}>单段生成</button>
      <button type="button" role="tab" aria-selected={creationMode === 'segments'} className={creationMode === 'segments' ? 'active' : ''} disabled={disabled} onClick={() => onChange('segments')}>分段创作</button>
    </div>
  );
}

function TextEditor({ text, onChange, onInsert, onClear, creationMode, onCreationModeChange, disabled = false }) {
  const count = text.length;
  return (
    <section className="editor-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">创作内容</span><h2>文本内容</h2></div>
        <div className="heading-actions"><WorkbenchModeToggle creationMode={creationMode} onChange={onCreationModeChange} disabled={disabled} /><span className="counter">{count} / 5000</span><button type="button" className="clear-button" disabled={disabled} onClick={onClear}><Trash2 size={14} /> 清空</button></div>
      </div>
        <textarea id="text-content" name="text" value={text} maxLength={5000} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="输入想要合成的文本..." aria-label="文本内容" />
      <div className="editor-footer">
        <div className="editor-tools">
          <button type="button" disabled={disabled} onClick={() => onInsert('（停顿片刻）')}><Clock3 size={14} /> 插入停顿</button>
          <button type="button" disabled={disabled} onClick={() => onInsert('（轻笑）')}><Sparkles size={14} /> 发音词典</button>
          <button type="button" disabled={disabled} onClick={() => onInsert('“”')}><FilePlus2 size={14} /> 多音字</button>
          <button type="button" disabled={disabled} onClick={() => onInsert('1,234.56')}><Activity size={14} /> 数字读法</button>
        </div>
      </div>
    </section>
  );
}

function TagInput({ tags, onRemove, onAdd, disabled = false }) {
  const [value, setValue] = useState('');
  const addTag = () => {
    if (disabled) return;
    const next = value.trim();
    if (next && !tags.includes(next)) onAdd(next);
    setValue('');
  };
  return (
    <div className="tag-input">
      <div className="tag-list">
        {tags.map((tag) => <span className="tag" key={tag}>{tag}<button type="button" disabled={disabled} aria-label={'移除' + tag} onClick={() => onRemove(tag)}><X size={12} /></button></span>)}
        <input id="audio-tag-input" name="audioTag" value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="添加标签" aria-label="添加音频标签" />
        <button type="button" className="add-tag-button" disabled={disabled} onClick={addTag}><Plus size={14} /> 添加标签</button>
      </div>
    </div>
  );
}

function StyleField({ value, onChange, mode, disabled = false }) {
  const placeholder = mode === 'design'
    ? '例如：一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。'
    : '例如：语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。';
  const example = mode === 'design'
    ? '一位年轻女性，音色清亮柔和，语速稍慢，像深夜电台主持人一样亲切。'
    : '语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。';
  return (
    <div className="field-group">
      <div className="field-label-row"><label htmlFor="workbench-style">{mode === 'design' ? '音色描述' : '风格指令'}</label><button type="button" className="help-link" disabled={disabled} onClick={() => onChange(example)}><CircleHelp size={14} /> 示例</button></div>
      <textarea id="workbench-style" name={mode === 'design' ? 'voiceDescription' : 'styleInstruction'} className="compact-textarea" disabled={disabled} aria-label={mode === 'design' ? '音色描述' : '风格指令'} value={value} maxLength={mode === 'design' ? 600 : 200} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="textarea-count">{value.length} / {mode === 'design' ? 600 : 200}</div>
    </div>
  );
}

function CloneUploader({ file, onFileChange, disabled = false }) {
  const inputRef = useRef(null);
  const handleChange = async (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    try {
      onFileChange(await readCloneFile(nextFile));
    } catch (error) {
      onFileChange({ error: error instanceof Error ? error.message : '读取音色样本失败' });
    }
  };
  return (
    <div className="field-group">
      <div className="field-label-row"><label htmlFor="workbench-sample-file">音色样本</label><span className="field-note">MP3 / WAV · Base64 ≤ 10 MB</span></div>
      <button type="button" disabled={disabled} className={'upload-box ' + (file?.fileName && !file?.error ? 'has-file' : '')} onClick={() => inputRef.current?.click()}>
        <input id="workbench-sample-file" name="sample" ref={inputRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden disabled={disabled} aria-label="上传音色样本" onChange={handleChange} />
        {file?.fileName ? (
          <><span className={'upload-icon ' + (file.error ? '' : 'success')}><Check size={18} /></span><span className="upload-copy"><strong>{file.fileName}</strong><small>{file.size ? (file.size / 1024 / 1024).toFixed(2) + ' MB · ' : ''}{file.error ? '样本不可用' : file.isNew ? '已准备好' : '已保存'}</small></span><ChevronRight size={16} /></>
        ) : (
          <><span className="upload-icon"><UploadCloud size={18} /></span><span className="upload-copy"><strong>上传音色样本</strong><small>点击选择或拖拽音频文件</small></span><ChevronRight size={16} /></>
        )}
      </button>
      {file?.error && <p className="error-text">{file.error}</p>}
    </div>
  );
}

function OutputSettings({ format, onFormatChange, stream, onStreamChange, disabled, locked = false, mixed = false }) {
  return (
    <>
      <div className="field-group">
        <div className="field-label-row"><label htmlFor="output-format">输出格式</label></div>
        <div className="select-wrap"><select id="output-format" name="format" aria-label="输出格式" value={format} disabled={locked} onChange={(event) => onFormatChange(event.target.value)}>{FORMAT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={16} /></div>
      </div>
      <div className={'stream-row ' + (disabled ? 'disabled' : '')}>
        <div><div className="stream-title"><span className="stream-label">流式输出</span><Info size={14} /></div><p>{disabled ? '设计音色与音色复刻暂不支持低延迟流式' : mixed ? '预置音色段落使用流式，设计与复刻段落按标准请求' : '实时返回音频流，降低首字延迟'}</p></div>
        <button type="button" className={'switch ' + (stream && !disabled ? 'on' : '')} disabled={disabled || locked} aria-label="切换流式输出" onClick={() => onStreamChange(!stream)}><span /></button>
      </div>
    </>
  );
}

function SegmentedInspector(props) {
  const {
    selectedVoice, voices, onVoiceChange, onOpenLibrary, onCreateVoice, voiceLoadError,
    styleInstruction, onStyleChange, tags, onRemoveTag, onAddTag,
    format, onFormatChange, stream, onStreamChange, optimizePreview, onOptimizePreview,
    apiReady, generationLocked,
  } = props;

  return (
    <aside className="inspector-panel">
      <div className="inspector-heading"><div><span className="section-kicker">生成配置</span><h2>全局配置</h2></div><span className={'api-ready ' + (apiReady ? '' : 'demo')}><span /> {apiReady ? '已配置' : '演示模式'}</span></div>
      <VoiceSelector selectedVoice={selectedVoice} voices={voices} onChange={onVoiceChange} onOpenLibrary={onOpenLibrary} onCreateVoice={onCreateVoice} voiceLoadError={voiceLoadError} label="默认音色" disabled={generationLocked} />
      <p className="mode-description">每段音色在内容卡片中单独设置；这里的默认音色只会应用到新建段落。分段模式使用声音库中已保存的音色资产。</p>
      <StyleField mode="style" value={styleInstruction} onChange={onStyleChange} disabled={generationLocked} />
      <div className="field-group">
        <div className="field-label-row"><span className="field-label">音频标签</span><Info size={14} /></div>
        <TagInput tags={tags} onRemove={onRemoveTag} onAdd={onAddTag} disabled={generationLocked} />
        <div className="suggested-tags">{AUDIO_TAGS.map((tag) => <button type="button" key={tag} disabled={generationLocked} onClick={() => onAddTag(tag)}>+ {tag}</button>)}</div>
      </div>
      <div className="optimize-row"><div><span className="optimize-label">优化文本预览</span><p>对设计音色段落使用模型文本优化</p></div><button type="button" className={'switch ' + (optimizePreview ? 'on' : '')} disabled={generationLocked} aria-label="切换优化文本预览" onClick={() => onOptimizePreview(!optimizePreview)}><span /></button></div>
      <OutputSettings format={format} onFormatChange={onFormatChange} stream={stream} onStreamChange={onStreamChange} mixed locked={generationLocked} />
      <div className="segmented-inspector-note"><Info size={14} /><span>各段会分别调用对应模型，生成完成后才能合成完整 WAV。</span></div>
      <div className="inspector-footer"><span><Zap size={14} /> 混合音色批量生成</span><span>浏览器端合成 WAV</span></div>
    </aside>
  );
}

function Inspector(props) {
  const {
    mode, selectedVoice, voices, onVoiceChange, onOpenLibrary, onCreateVoice, voiceLoadError,
    styleInstruction, onStyleChange, voiceDescription, onVoiceDescriptionChange,
    cloneFile, onCloneFileChange, tags, onRemoveTag, onAddTag,
    format, onFormatChange, stream, onStreamChange, optimizePreview, onOptimizePreview, apiReady,
    onSaveCurrentVoice, voiceSampleLoading, creationMode, generationLocked,
  } = props;
  if (creationMode === 'segments') {
    return <SegmentedInspector {...props} />;
  }
  const isDesign = mode === 'design';
  const isClone = mode === 'clone';
  return (
    <aside className="inspector-panel">
      <div className="inspector-heading"><div><span className="section-kicker">生成配置</span><h2>音色配置</h2></div><span className={'api-ready ' + (apiReady ? '' : 'demo')}><span /> {apiReady ? '已配置' : '演示模式'}</span></div>
      <VoiceSelector selectedVoice={selectedVoice} voices={voices} onChange={onVoiceChange} onOpenLibrary={onOpenLibrary} onCreateVoice={onCreateVoice} voiceLoadError={voiceLoadError} disabled={generationLocked} />
      {selectedVoice && <p className="mode-description">{MODE_CONFIG[mode].description}</p>}
      {isClone && <CloneUploader file={cloneFile} onFileChange={onCloneFileChange} disabled={generationLocked} />}
      {selectedVoice && <StyleField mode={isDesign ? 'design' : 'style'} value={isDesign ? voiceDescription : styleInstruction} onChange={isDesign ? onVoiceDescriptionChange : onStyleChange} disabled={generationLocked} />}
      {!isDesign && selectedVoice && (
        <div className="field-group">
          <div className="field-label-row"><span className="field-label">音频标签</span><Info size={14} /></div>
          <TagInput tags={tags} onRemove={onRemoveTag} onAdd={onAddTag} disabled={generationLocked} />
          <div className="suggested-tags">{AUDIO_TAGS.map((tag) => <button type="button" key={tag} disabled={generationLocked} onClick={() => onAddTag(tag)}>+ {tag}</button>)}</div>
        </div>
      )}
      {isDesign && selectedVoice && <div className="optimize-row"><div><span className="optimize-label">优化文本预览</span><p>让模型根据音色描述润色播报文本</p></div><button type="button" className={'switch ' + (optimizePreview ? 'on' : '')} disabled={generationLocked} aria-label="切换优化文本预览" onClick={() => onOptimizePreview(!optimizePreview)}><span /></button></div>}
      {(isDesign || isClone) && selectedVoice && (
        <button type="button" className="save-voice-link" onClick={onSaveCurrentVoice} disabled={voiceSampleLoading || generationLocked}><Save size={14} /> 保存当前配置为新音色</button>
      )}
      {selectedVoice && <OutputSettings format={format} onFormatChange={onFormatChange} stream={stream} onStreamChange={onStreamChange} disabled={isDesign || isClone} locked={generationLocked} />}
      {selectedVoice && <div className="inspector-footer"><span><Zap size={14} /> {modelIdFor(mode)}</span><span>24kHz mono</span></div>}
    </aside>
  );
}

function Waveform({ progress = 0 }) {
  const bars = useMemo(() => Array.from({ length: 72 }, (_, index) => 24 + ((index * 19) % 44)), []);
  return <div className="waveform" aria-label="音频波形">{bars.map((height, index) => <span key={index} className={index / bars.length <= progress ? 'played' : ''} style={{ height: height + '%' }} />)}</div>;
}

function OutputPanel({ result, audioRef, isPlaying, progress, duration, onToggle, onSeek, onJump, onRename, onDownload, kicker = '最近生成', title = '输出结果', downloadLabel = '下载音频', emptyMessage = '生成后显示音频波形', className = '' }) {
  const hasAudio = Boolean(result.audioUrl);
  const displayDuration = duration || result.duration;
  const trackDetails = [result.modeLabel, hasAudio && result.format.toUpperCase(), hasAudio && formatTime(displayDuration), hasAudio && result.sizeLabel].filter(Boolean).join(' · ');
  return (
    <section className={'output-panel ' + className}>
      <audio key={result.audioUrl || 'empty-audio'} ref={audioRef} preload="auto" src={result.audioUrl || undefined} onTimeUpdate={(event) => onSeek(event.currentTarget.currentTime / (event.currentTarget.duration || 1), false)} onLoadedMetadata={(event) => onSeek(0, true, event.currentTarget.duration)} onEnded={() => onToggle(false)} />
      <div className="output-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div><div className={'generation-status ' + (hasAudio ? 'success' : 'empty')}><span>{hasAudio ? <Check size={13} /> : <Activity size={13} />}</span>{hasAudio ? '生成完成' : '等待生成'}</div></div>
      <div className="output-content">
        <div className="track-badge"><Music2 size={22} /></div>
        <div className="track-meta"><div className="track-title"><strong>{result.name}</strong><button type="button" aria-label="重命名" disabled={!hasAudio} onClick={onRename}><Settings2 size={13} /></button></div><span>{trackDetails}</span></div>
        <div className="waveform-wrap"><Waveform progress={hasAudio ? progress : 0} /><div className="track-time">{hasAudio ? formatTime(displayDuration * progress) + ' / ' + formatTime(displayDuration) : emptyMessage}</div></div>
        <div className="player-controls"><button type="button" aria-label="后退 10 秒" disabled={!hasAudio} onClick={() => onJump(-10)}><RotateCcw size={17} /></button><button type="button" aria-label="上一段" disabled={!hasAudio} onClick={() => onJump(-5)}><ChevronLeft size={20} /></button><button type="button" className="play-button" disabled={!hasAudio} onClick={() => onToggle()} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button type="button" aria-label="下一段" disabled={!hasAudio} onClick={() => onJump(5)}><ChevronRight size={20} /></button><button type="button" aria-label="前进 10 秒" disabled={!hasAudio} onClick={() => onJump(10)}><RotateCcw size={17} className="flip-x" /></button></div>
        <input id="audio-progress" name="progress" className="seek-slider" type="range" min="0" max="1" step="0.001" value={progress} disabled={!hasAudio} aria-label="音频进度" onChange={(event) => onSeek(Number(event.target.value), true)} />
        <div className="output-actions"><button type="button" className="download-button" disabled={!hasAudio} onClick={onDownload}><Download size={16} /> {downloadLabel} <ChevronDown size={15} /></button></div>
      </div>
    </section>
  );
}

function SegmentStatus({ segment }) {
  const statusConfig = {
    idle: { label: '待生成', icon: <Activity size={13} /> },
    queued: { label: '排队中', icon: <Clock3 size={13} /> },
    generating: { label: '生成中', icon: <LoaderCircle size={13} className="spin" /> },
    ready: { label: '已生成', icon: <Check size={13} /> },
    error: { label: '生成失败', icon: <CircleAlert size={13} /> },
  };
  const config = statusConfig[segment.status];
  return <span className={'segment-status ' + segment.status}>{config.icon} {config.label}{segment.status === 'ready' && segment.duration ? ' · ' + formatTime(segment.duration) : ''}</span>;
}

function SegmentCard({ segment, index, total, voice, voices, disabled, previewingSegmentId, isSegmentPreviewPlaying, onTextChange, onVoiceChange, onMove, onDuplicate, onDelete, onGenerate, onDownload, onTogglePreview }) {
  const hasAudio = segment.status === 'ready' && Boolean(segment.audioUrl);
  const isGenerating = segment.status === 'generating' || segment.status === 'queued';
  const generateLabel = segment.status === 'generating'
    ? '生成中…'
    : segment.status === 'queued'
      ? '排队中'
      : segment.status === 'error'
        ? '重试'
        : segment.status === 'ready'
          ? '重新生成'
          : '生成本段';

  return (
    <article className={'segment-card ' + segment.status}>
      <div className="segment-card-main">
        <div className="segment-card-header">
          <div className="segment-card-title"><strong>段落 {index + 1}</strong><span>{segment.text.length} 字</span></div>
          <SegmentStatus segment={segment} />
          <div className="segment-card-voice">
            <VoiceSelector selectedVoice={voice} voices={voices} onChange={(nextVoice) => onVoiceChange(segment.id, nextVoice.id)} label="段落音色" showLibrary={false} allowCreate={false} compact disabled={disabled || isGenerating} showLabel={false} showIcon={false} showDetails={false} />
          </div>
          <div className="segment-card-tools">
            <button type="button" disabled={disabled || index === 0} aria-label={'段落 ' + (index + 1) + ' 上移'} title="上移" onClick={() => onMove(index, -1)}><ArrowUp size={14} /></button>
            <button type="button" disabled={disabled || index === total - 1} aria-label={'段落 ' + (index + 1) + ' 下移'} title="下移" onClick={() => onMove(index, 1)}><ArrowDown size={14} /></button>
            <button type="button" disabled={disabled} aria-label={'复制段落 ' + (index + 1)} title="复制" onClick={() => onDuplicate(index)}><Copy size={14} /></button>
            <button type="button" disabled={disabled || total <= 1} aria-label={'删除段落 ' + (index + 1)} title="删除" onClick={() => onDelete(index)}><Trash2 size={14} /></button>
          </div>
          <div className="segment-card-actions">
            <button type="button" className="segment-preview-button" disabled={disabled || !hasAudio} aria-label={previewingSegmentId === segment.id && isSegmentPreviewPlaying ? '暂停本段试听' : '试听本段'} title={previewingSegmentId === segment.id && isSegmentPreviewPlaying ? '暂停试听' : '试听'} onClick={() => onTogglePreview(segment)}>{previewingSegmentId === segment.id && isSegmentPreviewPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
            <button type="button" className="segment-generate-button" disabled={disabled || isGenerating} aria-label={generateLabel} title={generateLabel} onClick={() => onGenerate(segment.id)}>{isGenerating ? <LoaderCircle size={14} className="spin" /> : segment.status === 'error' ? <RotateCcw size={14} /> : <AudioLines size={14} />}</button>
            <button type="button" className="segment-download-button" disabled={disabled || !hasAudio} aria-label="下载本段" title="下载本段" onClick={() => onDownload(segment)}><Download size={14} /></button>
          </div>
        </div>
        <textarea value={segment.text} maxLength={5000} disabled={disabled || isGenerating} aria-label={'段落 ' + (index + 1) + ' 文本'} placeholder="输入这一段要合成的文本..." onChange={(event) => onTextChange(segment.id, event.target.value)} />
        {segment.status === 'error' && <p className="segment-error segment-card-error"><CircleAlert size={13} /> {segment.error}</p>}
      </div>
    </article>
  );
}

function SegmentEditor({ segments, voices, creationMode, onCreationModeChange, disabled, onSplit, onAdd, onTextChange, onVoiceChange, onMove, onDuplicate, onDelete, previewingSegmentId, isSegmentPreviewPlaying, onGenerate, onDownload, onTogglePreview }) {
  const totalChars = segments.reduce((total, segment) => total + segment.text.length, 0);
  return (
    <section className="editor-panel segment-editor-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">创作内容</span><h2>分段内容</h2></div>
        <div className="heading-actions"><WorkbenchModeToggle creationMode={creationMode} onChange={onCreationModeChange} disabled={disabled} /><span className="counter">{segments.length} 段 · {totalChars} 字</span></div>
      </div>
      <div className="segment-toolbar"><span>每段可使用不同音色，按原顺序合成</span><div><button type="button" className="segment-tool-button" disabled={disabled || !segments.length} onClick={onSplit}><ListPlusIcon /> 按换行拆分</button><button type="button" className="segment-tool-button primary" disabled={disabled} onClick={onAdd}><Plus size={14} /> 新增段落</button></div></div>
      <div className="segment-list">
        {segments.map((segment, index) => <SegmentCard key={segment.id} segment={segment} index={index} total={segments.length} voice={voices.find((voice) => voice.id === segment.voiceId)} voices={voices} disabled={disabled} previewingSegmentId={previewingSegmentId} isSegmentPreviewPlaying={isSegmentPreviewPlaying} onTextChange={onTextChange} onVoiceChange={onVoiceChange} onMove={onMove} onDuplicate={onDuplicate} onDelete={onDelete} onGenerate={onGenerate} onDownload={onDownload} onTogglePreview={onTogglePreview} />)}
      </div>
      <div className="segment-editor-note"><Info size={14} /><span>段落音色来自声音库中已保存的资产；右侧默认音色只影响新建段落。</span></div>
    </section>
  );
}

function ListPlusIcon() {
  return <span className="list-plus-icon"><FilePlus2 size={14} /></span>;
}

function SegmentBatchActions({ segments, batchProgress, isBatchGenerating, isComposing, busy, onGenerateAll, onCompose, canCompose }) {
  const pendingCount = segments.filter((segment) => segment.status !== 'ready' || !segment.audioBlob).length;
  const readyCount = segments.filter((segment) => segment.status === 'ready' && segment.audioBlob).length;
  const hasFailures = segments.some((segment) => segment.status === 'error');
  const batchLabel = isBatchGenerating
    ? '正在生成 ' + batchProgress.completed + ' / ' + batchProgress.total
    : pendingCount
      ? '批量生成 ' + pendingCount + ' 段'
      : '全部段落已生成';
  return (
    <div className="segment-batch-actions">
      <div className="segment-batch-summary"><strong>{readyCount} / {segments.length} 段已生成</strong><span>{hasFailures ? '有段落失败，可单独重试' : isComposing ? '正在准备完整音频…' : '生成满意后即可合成完整音频'}</span></div>
      <div className="segment-batch-buttons"><button type="button" className="generate-button segment-batch-button" disabled={busy || !pendingCount} onClick={onGenerateAll}>{isBatchGenerating ? <LoaderCircle size={18} className="spin" /> : <AudioLines size={19} />}<span>{batchLabel}</span>{!isBatchGenerating && <span className="generate-meta">并发 3</span>}</button><button type="button" className="primary-button compose-button" disabled={busy || !canCompose} onClick={onCompose}>{isComposing ? <LoaderCircle size={15} className="spin" /> : <AudioLines size={15} />} {isComposing ? '合成中…' : '合成完整音频'}</button></div>
    </div>
  );
}

function SegmentOutputPanel({ result, audioRef, isPlaying, progress, duration, onToggle, onSeek, onJump, onRename, onDownload, segmentAudioRef, onSegmentEnded, onSegmentMetadata }) {
  return (
    <>
      <audio ref={segmentAudioRef} preload="auto" hidden onEnded={onSegmentEnded} onLoadedMetadata={onSegmentMetadata} />
      <OutputPanel result={result} audioRef={audioRef} isPlaying={isPlaying} progress={progress} duration={duration} onToggle={onToggle} onSeek={onSeek} onJump={onJump} onRename={onRename} onDownload={onDownload} kicker="最终结果" title="完整音频" downloadLabel="下载完整音频" emptyMessage="全部段落生成满意后合成完整 WAV" className="segment-output-panel" />
    </>
  );
}

function GenerateButton({ isGenerating, canGenerate, onGenerate, stream }) {
  return <button type="button" className="generate-button" disabled={isGenerating || !canGenerate} onClick={onGenerate}>{isGenerating ? <LoaderCircle size={18} className="spin" /> : <AudioLines size={19} />}<span>{isGenerating ? '正在生成…' : '生成语音'}</span>{!isGenerating && <span className="generate-meta">{stream ? '流式' : '标准'} <ChevronDown size={15} /></span>}</button>;
}

function Workbench(props) {
  const isSegmented = props.creationMode === 'segments';
  const busy = props.isGenerating || props.isBatchGenerating || props.isComposing || Boolean(props.generatingSegmentId);
  return (
    <div className="workbench-page">
      <div className="workbench-main-column">
        <div className="editor-column">
          {isSegmented ? <SegmentEditor segments={props.segments} voices={props.voices} creationMode={props.creationMode} onCreationModeChange={props.onCreationModeChange} disabled={busy} onSplit={props.onSplitSegments} onAdd={props.onAddSegment} onTextChange={props.onSegmentTextChange} onVoiceChange={props.onSegmentVoiceChange} onMove={props.onMoveSegment} onDuplicate={props.onDuplicateSegment} onDelete={props.onDeleteSegment} previewingSegmentId={props.previewingSegmentId} isSegmentPreviewPlaying={props.isSegmentPreviewPlaying} onGenerate={props.onGenerateSegment} onDownload={props.onDownloadSegment} onTogglePreview={props.onToggleSegmentPreview} /> : <TextEditor text={props.text} onChange={props.onTextChange} onInsert={props.onInsert} onClear={props.onClear} creationMode={props.creationMode} onCreationModeChange={props.onCreationModeChange} disabled={busy} />}
          {isSegmented ? <SegmentBatchActions segments={props.segments} batchProgress={props.batchProgress} isBatchGenerating={props.isBatchGenerating} isComposing={props.isComposing} busy={busy} onGenerateAll={props.onGenerateAllSegments} onCompose={props.onComposeSegments} canCompose={props.canComposeSegments} /> : <div className="editor-actions"><div className="text-suggestions">{STYLE_TAGS.map((tag) => <button type="button" disabled={busy} key={tag} onClick={() => props.onInsert('（' + tag + '）')}>{tag}</button>)}</div><GenerateButton isGenerating={props.isGenerating} canGenerate={props.canGenerate} onGenerate={props.onGenerate} stream={props.stream && props.mode === 'preset'} /></div>}
        </div>
        {isSegmented ? <SegmentOutputPanel result={props.mergedResult} audioRef={props.mergedAudioRef} isPlaying={props.isMergedPlaying} progress={props.mergedProgress} duration={props.mergedDuration} onToggle={props.onToggleMerged} onSeek={props.onSeekMerged} onJump={props.onJumpMerged} onRename={props.onRenameMerged} onDownload={props.onDownloadMerged} segmentAudioRef={props.segmentAudioRef} onSegmentEnded={props.onSegmentPreviewEnded} onSegmentMetadata={props.onSegmentPreviewMetadata} /> : <OutputPanel result={props.result} audioRef={props.audioRef} isPlaying={props.isPlaying} progress={props.progress} duration={props.duration} onToggle={props.onToggle} onSeek={props.onSeek} onJump={props.onJump} onRename={props.onRename} onDownload={props.onDownload} />}
      </div>
      <Inspector {...props} generationLocked={busy} />
    </div>
  );
}

function VoiceCard({ voice, selected, onOpen, onPreview, previewingVoice, onToggleFavorite }) {
  const Icon = profileIcon(voice);
  const cardSummary = voice.kind === 'design'
    ? voice.voiceDescription
    : voice.kind === 'clone'
      ? (voice.sample?.available ? voice.sample.fileName : '样本不可用，请重新上传')
      : voice.tone;
  return (
    <article className={'voice-card ' + (selected ? 'selected' : '') + (voice.kind === 'clone' && voice.sample?.available === false ? ' unavailable' : '')}>
      <button type="button" className="voice-card-body" onClick={() => onOpen(voice)}>
        <div className={'voice-card-icon ' + voice.color}><Icon size={19} /></div>
        <div className="voice-card-copy"><span className="voice-card-kind">{profileTypeLabel(voice)}</span><strong>{voice.name}</strong><span>{voice.kind === 'preset' ? voice.gender + ' · ' + voice.language : voice.kind === 'design' ? '本地配置' : '本地样本'}</span><small>{cardSummary}</small></div>
      </button>
      <div className="voice-card-actions">
        <button type="button" className={'voice-card-favorite ' + (voice.favorite ? 'active' : '')} aria-label={(voice.favorite ? '取消收藏 ' : '收藏 ') + voice.name} aria-pressed={voice.favorite} onClick={(event) => { event.stopPropagation(); onToggleFavorite(voice); }}><Star size={14} fill={voice.favorite ? 'currentColor' : 'none'} /></button>
        <button type="button" className="voice-card-play" aria-label={(voice.kind === 'clone' ? '试听样本 ' : '试听 ') + voice.name} onClick={(event) => { event.stopPropagation(); onPreview(voice); }}>{previewingVoice === voice.id ? <LoaderCircle size={14} className="spin" /> : <Play size={14} fill="currentColor" />}</button>
      </div>
      {selected && <span className="selected-mark"><Check size={13} /></span>}
    </article>
  );
}

function VoiceLibrary({ voices, selectedVoiceId, voiceLoadStatus, voiceError, onRetry, onOpenVoice, onCreateVoice, onPreview, previewingVoice, onToggleFavorite }) {
  const [tab, setTab] = useState('all');
  const presetVoices = voices.filter((voice) => voice.kind === 'preset');
  const customVoices = voices.filter((voice) => voice.kind !== 'preset');
  const visibleVoices = tab === 'preset' ? presetVoices : tab === 'custom' ? customVoices : voices;
  const customCount = voiceLoadStatus === 'ready' ? String(customVoices.length) : '—';

  return (
    <div className="page-content library-page">
      <div className="page-intro"><div><span className="section-kicker">长期资产</span><h2>声音库</h2><p>保存、试听和复用你的音色配置；点击卡片查看详情，使用动作才会进入工作台。</p></div><button type="button" className="secondary-button" onClick={() => onCreateVoice('design')}><Plus size={16} /> 创建声音</button></div>
      <div className="library-toolbar"><div className="library-tabs" role="tablist" aria-label="音色分类"><button className={tab === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>全部 <span>{presetVoices.length + customVoices.length}</span></button><button className={tab === 'preset' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'preset'} onClick={() => setTab('preset')}>内置音色 <span>{presetVoices.length}</span></button><button className={tab === 'custom' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'custom'} onClick={() => setTab('custom')}>我的音色 <span>{customCount}</span></button></div><span className="library-note"><LockKeyhole size={14} /> 数据保存在本机</span></div>
      {voiceError && <div className="inline-error"><CircleHelp size={15} /><span>我的音色读取失败：{voiceError}</span><button type="button" onClick={onRetry}>重试</button></div>}
      {tab === 'custom' && voiceLoadStatus === 'loading' ? <div className="library-loading"><LoaderCircle size={16} className="spin" /> 正在读取我的音色…</div> : tab === 'custom' && voiceLoadStatus === 'ready' && !customVoices.length ? (
        <div className="voice-empty-state"><div className="voice-empty-icon"><WandSparkles size={20} /></div><h3>还没有自建音色</h3><p>把设计描述或音频样本保存下来，之后可以在工作台反复使用。</p><div className="voice-empty-actions"><button type="button" className="secondary-button" onClick={() => onCreateVoice('design')}><WandSparkles size={15} /> 设计音色</button><button type="button" className="primary-button" onClick={() => onCreateVoice('clone')}><Mic2 size={15} /> 复刻音色</button></div></div>
      ) : tab === 'custom' && voiceLoadStatus === 'error' ? (
        <div className="library-unavailable"><CircleHelp size={19} /><strong>我的音色暂时不可用</strong><span>本地服务恢复后点击“重试”重新读取。</span></div>
      ) : (
        <div className="voice-grid">{visibleVoices.map((voice) => <VoiceCard key={voice.id} voice={voice} selected={selectedVoiceId === voice.id} onOpen={onOpenVoice} onPreview={onPreview} previewingVoice={previewingVoice} onToggleFavorite={onToggleFavorite} />)}</div>
      )}
    </div>
  );
}

function VoiceDetailDrawer({ voice, sourceVoiceName, onClose, onUse, onPreview, previewingVoice, previewSampleReady, onToggleFavorite, onEdit, onDelete, onSolidify }) {
  const Icon = profileIcon(voice);
  const isCloneUnavailable = voice.kind === 'clone' && voice.sample?.available === false;
  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-scrim" aria-label="关闭音色详情" onClick={onClose} />
      <aside className="voice-drawer" role="dialog" aria-modal="true" aria-labelledby="voice-detail-title">
        <div className="drawer-header"><div><span className="section-kicker">音色详情</span><h2 id="voice-detail-title">{voice.name}</h2></div><button type="button" className="drawer-close" aria-label="关闭" onClick={onClose}><X size={17} /></button></div>
        <div className="voice-detail-hero"><span className={'voice-detail-icon ' + voice.color}><Icon size={24} /></span><div><strong>{profileTypeLabel(voice)}</strong><span>{voice.kind === 'preset' ? voice.gender + ' · ' + voice.language : voice.kind === 'design' ? '本地保存的描述配置' : '本地保存的音频样本'}</span></div><button type="button" className={'detail-favorite ' + (voice.favorite ? 'active' : '')} aria-label={(voice.favorite ? '取消收藏 ' : '收藏 ') + voice.name} onClick={() => onToggleFavorite(voice)}><Star size={17} fill={voice.favorite ? 'currentColor' : 'none'} /></button></div>
        <div className="voice-detail-content">
          <div className="voice-detail-block"><span className="detail-label">音色信息</span><p>{voice.kind === 'preset' ? voice.tone : voice.kind === 'design' ? voice.voiceDescription : isCloneUnavailable ? '样本文件不存在，暂时无法生成。' : '样本文件：' + voice.sample.fileName}</p></div>
          {voice.kind === 'design' && <div className="voice-detail-block preview-text-block"><span className="detail-label">试听文本</span><p>{voice.previewText?.trim() || DEFAULT_PREVIEW_TEXT}</p><small>{voice.previewText?.trim() ? '已使用自定义试听文本' : '未配置，使用默认试听文本'}</small></div>}
          {voice.kind === 'clone' && <div className={'sample-status ' + (isCloneUnavailable ? 'error' : '')}><Mic2 size={15} /><span>{isCloneUnavailable ? '样本不可用，请编辑音色并重新上传' : '复刻样本已保存在本机'}</span></div>}
          {voice.kind === 'clone' && voice.sourceVoiceId && <div className="voice-detail-origin"><WandSparkles size={14} /><span>复刻自：{sourceVoiceName || '已删除的设计音色'}</span></div>}
          <div className="voice-detail-note"><LockKeyhole size={14} /><span>{voice.kind === 'clone' ? '试听样本会直接播放已保存的参考音频；在工作台生成新文本时才会调用复刻模型。' : voice.kind === 'design' ? '自定义试听文本只影响声音库试听；工作台生成仍使用当前输入文本。' : '声音库只保存音色配置；当前文本、风格指令和音频标签仍属于单次生成。'}</span></div>
        </div>
        {voice.kind === 'design' && !voice.readOnly && <div className={'voice-detail-solidify ' + (previewSampleReady ? 'ready' : 'needs-preview')}><div><strong>{previewSampleReady ? '试听样本已准备好' : '先试听，再保存复刻音色'}</strong><p>{previewSampleReady ? '将刚刚试听的同一段声音保存为独立的复刻音色。' : '请先点击下方“试听”，满意后即可保存这段实际声音。'}</p></div><button type="button" className="solidify-button" disabled={!previewSampleReady} onClick={() => onSolidify(voice)}><Mic2 size={14} /> {previewSampleReady ? '保存试听为复刻' : '请先试听'}</button></div>}
        <div className="drawer-actions"><button type="button" className="secondary-button" disabled={isCloneUnavailable} onClick={() => onPreview(voice)}>{previewingVoice === voice.id ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill="currentColor" />} {previewingVoice === voice.id ? '停止试听' : voice.kind === 'clone' ? '试听样本' : '试听'}</button><button type="button" className="primary-button" disabled={isCloneUnavailable} onClick={() => onUse(voice)}><AudioLines size={15} /> 在工作台使用</button></div>
        {!voice.readOnly && <div className="drawer-secondary-actions"><button type="button" className="text-button with-icon" onClick={() => onEdit(voice)}><Pencil size={14} /> 编辑音色</button><button type="button" className="danger-text-button with-icon" onClick={() => onDelete(voice)}><Trash2 size={14} /> 删除音色</button></div>}
      </aside>
    </div>
  );
}

function VoiceEditorDrawer({ voice, initialKind, initialValues, saving, onClose, onSave, onPreview }) {
  const [kind, setKind] = useState(voice?.kind || initialKind || 'design');
  const [name, setName] = useState(voice?.name || initialValues?.name || '');
  const [description, setDescription] = useState(voice?.voiceDescription || initialValues?.voiceDescription || DEFAULT_VOICE_DESCRIPTION);
  const [previewText, setPreviewText] = useState(voice?.previewText || initialValues?.previewText || '');
  const [sample, setSample] = useState(() => voice?.kind === 'clone' && voice.sample ? { fileName: voice.sample.fileName, mimeType: voice.sample.mimeType, size: voice.sample.size, existing: true } : initialValues?.sample || null);
  const [previewSample, setPreviewSample] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setKind(voice?.kind || initialKind || 'design');
    setName(voice?.name || initialValues?.name || '');
    setDescription(voice?.voiceDescription || initialValues?.voiceDescription || DEFAULT_VOICE_DESCRIPTION);
    setPreviewText(voice?.previewText || initialValues?.previewText || '');
    setSample(voice?.kind === 'clone' && voice.sample ? { fileName: voice.sample.fileName, mimeType: voice.sample.mimeType, size: voice.sample.size, existing: true } : initialValues?.sample || null);
    setPreviewSample(null);
    setError('');
  }, [voice, initialKind, initialValues]);

  const handleFileChange = async (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    try {
      setSample(await readCloneFile(nextFile));
      setError('');
    } catch (nextError) {
      setSample({ error: nextError instanceof Error ? nextError.message : '读取音色样本失败' });
      setError(nextError instanceof Error ? nextError.message : '读取音色样本失败');
    }
  };

  const buildDraft = () => ({
    voiceId: voice?.id,
    kind,
    name: name.trim(),
    voiceDescription: kind === 'design' ? description.trim() : undefined,
    previewText: kind === 'design' ? previewText.trim() : undefined,
    sampleDataUrl: kind === 'clone' ? sample?.dataUrl : undefined,
    sampleFileName: kind === 'clone' ? sample?.fileName : undefined,
    sourceVoiceId: kind === 'clone' ? initialValues?.sourceVoiceId : undefined,
  });

  const validateDraft = () => {
    if (!name.trim()) return '请填写音色名称';
    if (kind === 'design' && !description.trim()) return '请填写音色描述';
    if (kind === 'clone' && !sample?.dataUrl && !(voice?.sample?.available && !sample?.error)) return '请上传 MP3 或 WAV 音频样本';
    if (sample?.error) return sample.error;
    return '';
  };

  const editorDirty = Boolean(
    name.trim() !== (voice?.name || initialValues?.name || '').trim()
    || description.trim() !== (voice?.voiceDescription || initialValues?.voiceDescription || DEFAULT_VOICE_DESCRIPTION).trim()
    || previewText.trim() !== (voice?.previewText || initialValues?.previewText || '').trim()
    || kind !== (voice?.kind || initialKind || 'design')
    || Boolean(sample?.dataUrl),
  );
  const closeEditor = () => {
    if (editorDirty && !window.confirm('当前音色草稿尚未保存，确定丢弃吗？')) return;
    onClose();
  };

  const handlePreview = async () => {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    const draft = buildDraft();
    const previewResult = await onPreview(draft);
    if (draft.kind === 'design' && previewResult?.sample) {
      setPreviewSample(previewResult.sample);
      setError('');
    }
  };

  const handleSavePreviewAsClone = () => {
    if (!name.trim()) {
      setError('请先填写音色名称');
      return;
    }
    try {
      const cloneDraft = buildCloneDraftFromPreview({ kind: 'design', name: name.trim() }, previewSample);
      setKind('clone');
      setDescription('');
      setPreviewText('');
      setSample({ ...cloneDraft.sample, fromPreview: true });
      setPreviewSample(null);
      setError('');
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : '请先试听设计音色');
    }
  };

  const handleSubmit = async (useAfterSave) => {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    try {
      await onSave({ ...buildDraft(), useAfterSave });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存音色失败');
    }
  };

  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-scrim" aria-label="关闭音色编辑" onClick={closeEditor} />
      <aside className="voice-drawer editor-drawer" role="dialog" aria-modal="true" aria-labelledby="voice-editor-title">
        <div className="drawer-header"><div><span className="section-kicker">{voice ? '编辑资产' : '新建资产'}</span><h2 id="voice-editor-title">{voice ? '编辑音色' : '创建音色'}</h2></div><button type="button" className="drawer-close" aria-label="关闭" onClick={closeEditor}><X size={17} /></button></div>
        {!voice && <div className="editor-kind-picker"><span className="detail-label">音色类型</span><div><button type="button" className={kind === 'design' ? 'active' : ''} onClick={() => { setKind('design'); setSample(null); setPreviewSample(null); }}><WandSparkles size={15} /> 设计音色</button><button type="button" className={kind === 'clone' ? 'active' : ''} onClick={() => { setKind('clone'); setDescription(''); setPreviewText(''); setPreviewSample(null); }}><Mic2 size={15} /> 音色复刻</button></div></div>}
        <form className="voice-form" onSubmit={(event) => { event.preventDefault(); handleSubmit(false); }}>
          <label className="form-label" htmlFor="voice-name">音色名称</label>
          <input id="voice-name" name="name" className="drawer-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：深夜电台女声" autoFocus />
          {kind === 'design' ? (
            <><div className="field-label-row"><label htmlFor="voice-description">音色描述</label><button type="button" className="help-link" onClick={() => { setDescription(DEFAULT_VOICE_DESCRIPTION); setPreviewSample(null); }}><CircleHelp size={14} /> 示例</button></div><textarea id="voice-description" name="voiceDescription" className="compact-textarea editor-description" value={description} maxLength={600} onChange={(event) => { setDescription(event.target.value); setPreviewSample(null); }} placeholder="描述性别、年龄、音色质感、语速和说话方式。" /><div className="textarea-count">{description.length} / 600</div><div className="field-label-row preview-text-label"><label htmlFor="voice-preview-text">试听文本</label><span className="field-note">可选 · 最多 500 字</span></div><textarea id="voice-preview-text" name="previewText" className="compact-textarea preview-textarea" value={previewText} maxLength={500} onChange={(event) => { setPreviewText(event.target.value); setPreviewSample(null); }} placeholder={DEFAULT_PREVIEW_TEXT} /><div className="textarea-count">{previewText.length} / 500</div></>
          ) : (
            <><div className="field-label-row"><label htmlFor="voice-editor-sample-file">音色样本</label><span className="field-note">MP3 / WAV · Base64 ≤ 10 MB</span></div><button type="button" className={'upload-box editor-upload ' + (sample?.dataUrl || sample?.existing ? 'has-file' : '')} onClick={() => inputRef.current?.click()}><input id="voice-editor-sample-file" name="sample" ref={inputRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden aria-label="上传音色样本" onChange={handleFileChange} />{sample?.fileName ? <><span className="upload-icon success"><Check size={18} /></span><span className="upload-copy"><strong>{sample.fileName}</strong><small>{sample.size ? (sample.size / 1024 / 1024).toFixed(2) + ' MB · ' : ''}{sample.existing ? '已保存，选择新文件可替换' : '已准备好'}</small></span><ChevronRight size={16} /></> : <><span className="upload-icon"><UploadCloud size={18} /></span><span className="upload-copy"><strong>上传音色样本</strong><small>点击选择 MP3 或 WAV 文件</small></span><ChevronRight size={16} /></>}</button></>
          )}
          {kind === 'design' && !voice && <div className={'editor-preview-clone ' + (previewSample ? 'ready' : 'locked')}><div><strong>试听满意后，保存为复刻</strong><p>{previewSample ? '下面的操作会复用刚刚试听的同一份声音样本。' : '先点击“试听草稿”，试听成功后这里会解锁。'}</p></div><button type="button" className="solidify-button" disabled={!previewSample || saving} onClick={handleSavePreviewAsClone}><Mic2 size={14} /> {previewSample ? '将试听保存为复刻' : '试听后可复刻'}</button></div>}
          <div className="voice-form-note"><LockKeyhole size={14} /><span>{sample?.fromPreview ? '这是刚刚试听的同一份声音样本；保存后会成为独立的复刻音色。' : initialValues?.sourceVoiceId ? '该参考样本由设计音色生成，保存后会成为独立的复刻音色；修改原设计不会影响它。' : kind === 'design' ? '自定义试听文本只影响声音库试听；工作台生成仍使用当前输入文本。' : '保存后可在声音库和工作台中反复使用；当前文本与风格标签不会写入音色。'}</span></div>
          {error && <p className="error-text drawer-error">{error}</p>}
          <div className="drawer-actions editor-actions-row"><button type="button" className="secondary-button" onClick={handlePreview} disabled={saving}><Play size={15} fill="currentColor" /> 试听草稿</button><button type="submit" className="secondary-button" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {voice ? '保存修改' : '保存音色'}</button><button type="button" className="primary-button" onClick={() => handleSubmit(true)} disabled={saving}><AudioLines size={15} /> 保存并使用</button></div>
        </form>
      </aside>
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
          <label className="form-label" htmlFor="api-endpoint">API Base URL</label>
          <div className="input-with-prefix"><input id="api-endpoint" value={api.endpoint} disabled={isBusy} onChange={(event) => onApiChange({ endpoint: event.target.value })} aria-label="API Base URL" /></div>
          <p className="form-help">默认请求路径为 /v1/chat/completions，也支持填入完整的 chat/completions 地址。</p>
          <span className="form-label">API Key</span>
          {hasSavedApiKey && !editingKey && !hasUnsavedKey ? (
            <div className="saved-key-panel">
              <div className="saved-key-info"><span className="saved-key-icon"><LockKeyhole size={16} /></span><div className="saved-key-copy"><strong>API Key 已保存</strong><span className="saved-key-value">{showKey ? savedApiKey : maskApiKey(savedApiKey)}</span></div></div>
              <div className="saved-key-actions"><button type="button" disabled={isBusy} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '查看'}</button><button type="button" disabled={isBusy} onClick={() => { setEditingKey(true); setShowKey(false); }}><Settings2 size={14} /> 修改</button></div>
            </div>
          ) : (
            <>
              <div className="input-with-action"><input id="api-key" type={showKey ? 'text' : 'password'} value={api.apiKey} disabled={isBusy} onChange={(event) => onApiChange({ apiKey: event.target.value })} placeholder="sk-..." aria-label="API Key" /><button type="button" disabled={isBusy} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '查看'}</button></div>
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
  const [creationMode, setCreationMode] = useState('single');
  const [text, setText] = useState(INITIAL_TEXT);
  const [segments, setSegments] = useState([]);
  const [styleInstruction, setStyleInstruction] = useState('语气自然、亲切，语速适中，情感稳定，适合知识类内容讲解。');
  const [selectedVoiceId, setSelectedVoiceId] = useState(PRESET_VOICE_PREFIX + '冰糖');
  const [voiceDescription, setVoiceDescription] = useState('');
  const [cloneFile, setCloneFile] = useState(null);
  const [tags, setTags] = useState(['知识讲解', '自然', '亲和']);
  const [format, setFormat] = useState('wav');
  const [stream, setStream] = useState(true);
  const [optimizePreview, setOptimizePreview] = useState(true);
  const [api, setApi] = useState({ endpoint: 'https://api.xiaomimimo.com/v1', apiKey: '' });
  const [savedApiKey, setSavedApiKey] = useState('');
  const [apiPersistenceStatus, setApiPersistenceStatus] = useState('loading');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [generatingSegmentId, setGeneratingSegmentId] = useState('');
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, failed: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState(null);
  const [customVoices, setCustomVoices] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [voiceLoadStatus, setVoiceLoadStatus] = useState('loading');
  const [voiceError, setVoiceError] = useState('');
  const [voiceSampleLoading, setVoiceSampleLoading] = useState(false);
  const [detailVoiceId, setDetailVoiceId] = useState('');
  const [editorState, setEditorState] = useState(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [mergedResult, setMergedResult] = useState(emptyMergedResult);
  const [isComposing, setIsComposing] = useState(false);
  const [isMergedPlaying, setIsMergedPlaying] = useState(false);
  const [mergedProgress, setMergedProgress] = useState(0);
  const [mergedDuration, setMergedDuration] = useState(0);
  const [previewingSegmentId, setPreviewingSegmentId] = useState('');
  const [isSegmentPreviewPlaying, setIsSegmentPreviewPlaying] = useState(false);
  const audioRef = useRef(null);
  const mergedAudioRef = useRef(null);
  const segmentAudioRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewUrlRef = useRef('');
  const previewRequestRef = useRef(0);
  const resultUrlRef = useRef('');
  const mergedUrlRef = useRef('');
  const segmentAudioUrlsRef = useRef(new Set());
  const segmentsRef = useRef([]);
  const segmentRequestTokensRef = useRef(new Map());
  const segmentPreviewRequestRef = useRef(0);
  const batchRunRef = useRef(0);
  const voiceSamplePromiseCacheRef = useRef(new Map());
  const voiceSampleCacheRef = useRef(new Map());
  const previewSampleCacheRef = useRef(new Map());
  const voiceSampleRequestRef = useRef(0);
  const [previewingVoice, setPreviewingVoice] = useState('');
  const [previewSampleReadyVoiceId, setPreviewSampleReadyVoiceId] = useState('');
  const [result, setResult] = useState(() => ({ name: '尚未生成音频', modeLabel: '输入文本后开始生成', format: 'wav', duration: 0, sizeLabel: '', audioUrl: '' }));
  const apiReady = Boolean(api.apiKey.trim());
  const voices = useMemo(() => [
    ...VOICES.map((voiceItem) => presetProfile(voiceItem, favoriteIds)),
    ...customVoices.map((voiceItem) => customProfile(voiceItem, favoriteIds)),
  ], [customVoices, favoriteIds]);
  const selectedVoice = voices.find((voiceItem) => voiceItem.id === selectedVoiceId);
  const mode = selectedVoice?.kind || 'preset';
  const activeVoiceProfile = useMemo(() => {
    if (!selectedVoice) return null;
    if (selectedVoice.kind === 'design') {
      return { ...selectedVoice, voiceDescription: voiceDescription.trim() };
    }
    if (selectedVoice.kind === 'clone') {
      return { ...selectedVoice, sampleDataUrl: cloneFile?.dataUrl };
    }
    return selectedVoice;
  }, [cloneFile, selectedVoice, voiceDescription]);

  useEffect(() => {
    segmentsRef.current = segments;
    const activeUrls = new Set(segments.map((segment) => segment.audioUrl).filter(Boolean));
    activeUrls.forEach((audioUrl) => segmentAudioUrlsRef.current.add(audioUrl));
    for (const audioUrl of segmentAudioUrlsRef.current) {
      if (!activeUrls.has(audioUrl)) {
        URL.revokeObjectURL(audioUrl);
        segmentAudioUrlsRef.current.delete(audioUrl);
      }
    }
  }, [segments]);

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
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.removeAttribute('src');
    }
    if (mergedAudioRef.current) {
      mergedAudioRef.current.pause();
      mergedAudioRef.current.removeAttribute('src');
    }
    segmentAudioUrlsRef.current.forEach((audioUrl) => URL.revokeObjectURL(audioUrl));
    segmentAudioUrlsRef.current.clear();
    if (mergedUrlRef.current) URL.revokeObjectURL(mergedUrlRef.current);
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

  useEffect(() => {
    if (!mergedAudioRef.current) return;
    mergedAudioRef.current.pause();
    mergedAudioRef.current.load();
    setIsMergedPlaying(false);
    setMergedProgress(0);
    setMergedDuration(0);
  }, [mergedResult.audioUrl]);

  const title = page === 'workbench' ? '工作台' : page === 'library' ? '声音库' : page === 'history' ? '历史记录' : 'API 设置';
  const updateApi = (patch) => setApi((current) => ({ ...current, ...patch }));
  const insertText = (value) => setText((current) => current + (current && !current.endsWith('\n') ? ' ' : '') + value);
  const addTag = (tag) => setTags((current) => current.includes(tag) ? current : [...current, tag]);
  const removeTag = (tag) => setTags((current) => current.filter((item) => item !== tag));
  const showToast = (type, message) => setToast({ type, message });

  const invalidateMergedAudio = () => {
    mergedAudioRef.current?.pause();
    if (mergedUrlRef.current) {
      URL.revokeObjectURL(mergedUrlRef.current);
      mergedUrlRef.current = '';
    }
    setMergedResult(emptyMergedResult());
    setIsMergedPlaying(false);
    setMergedProgress(0);
    setMergedDuration(0);
  };

  const stopSegmentPreview = () => {
    segmentPreviewRequestRef.current += 1;
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
      segmentAudioRef.current.removeAttribute('src');
      segmentAudioRef.current.load();
    }
    setPreviewingSegmentId('');
    setIsSegmentPreviewPlaying(false);
  };

  const markSegmentDraft = (segmentId, patch) => {
    segmentRequestTokensRef.current.set(segmentId, (segmentRequestTokensRef.current.get(segmentId) || 0) + 1);
    if (previewingSegmentId === segmentId) stopSegmentPreview();
    setSegments((current) => current.map((segment) => {
      if (segment.id !== segmentId) return segment;
      return {
        ...segment,
        ...patch,
        status: 'idle',
        audioBlob: null,
        audioUrl: '',
        duration: 0,
        error: '',
        generationRevision: segment.generationRevision + 1,
      };
    }));
    invalidateMergedAudio();
  };

  const updateSegmentText = (segmentId, value) => markSegmentDraft(segmentId, { text: value });
  const updateSegmentVoice = (segmentId, voiceId) => markSegmentDraft(segmentId, { voiceId });

  const addSegment = () => {
    setSegments((current) => [...current, createSegment('', selectedVoiceId)]);
    invalidateMergedAudio();
  };

  const duplicateSegment = (index) => {
    const source = segmentsRef.current[index];
    if (!source) return;
    const copy = createSegment(source.text, source.voiceId);
    setSegments((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
    invalidateMergedAudio();
  };

  const deleteSegment = (index) => {
    if (segmentsRef.current.length <= 1) {
      showToast('error', '至少保留一个段落');
      return;
    }
    const deletedSegment = segmentsRef.current[index];
    if (!deletedSegment) return;
    if (previewingSegmentId === deletedSegment.id) stopSegmentPreview();
    segmentRequestTokensRef.current.delete(deletedSegment.id);
    setSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
    invalidateMergedAudio();
  };

  const moveSegment = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= segmentsRef.current.length) return;
    setSegments((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    invalidateMergedAudio();
  };

  const splitSegmentsByNewline = () => {
    const nextSegments = [];
    segmentsRef.current.forEach((segment) => {
      const parts = segment.text.split(/\r?\n+/).map((part) => part.trim()).filter(Boolean);
      parts.forEach((part) => nextSegments.push(createSegment(part, segment.voiceId)));
    });
    // 全部为空时保留一个可编辑的空段落，避免分段编辑器失去新增入口。
    if (!nextSegments.length) nextSegments.push(createSegment('', selectedVoiceId));
    stopSegmentPreview();
    setSegments(nextSegments);
    invalidateMergedAudio();
    showToast('success', '已按换行拆分为 ' + nextSegments.length + ' 段');
  };

  const reloadVoices = useCallback(async () => {
    setVoiceLoadStatus('loading');
    setVoiceError('');
    try {
      const payload = await loadVoiceProfiles();
      setCustomVoices(payload.voices);
      setFavoriteIds(new Set(payload.favoriteIds));
      setVoiceLoadStatus('ready');
    } catch (error) {
      setVoiceLoadStatus('error');
      setVoiceError(error instanceof Error ? error.message : '读取本地音色失败');
    }
  }, []);

  useEffect(() => {
    reloadVoices();
  }, [reloadVoices]);

  useEffect(() => {
    const profile = voices.find((voiceItem) => voiceItem.id === selectedVoiceId);
    if (!profile) {
      voiceSampleRequestRef.current += 1;
      setVoiceSampleLoading(false);
      setCloneFile(null);
      return undefined;
    }
    setVoiceDescription(profile.kind === 'design' ? profile.voiceDescription : '');
    if (profile.kind !== 'clone') {
      voiceSampleRequestRef.current += 1;
      setVoiceSampleLoading(false);
      setCloneFile(null);
      return undefined;
    }
    if (profile.sample?.available === false) {
      voiceSampleRequestRef.current += 1;
      setVoiceSampleLoading(false);
      setCloneFile({ fileName: profile.sample.fileName, mimeType: profile.sample.mimeType, size: profile.sample.size, error: '音色样本文件不存在，请重新上传' });
      return undefined;
    }

    const requestId = voiceSampleRequestRef.current + 1;
    voiceSampleRequestRef.current = requestId;
    const cachedSample = voiceSampleCacheRef.current.get(profile.id);
    setVoiceSampleLoading(true);
    setCloneFile({ fileName: profile.sample.fileName, mimeType: profile.sample.mimeType, size: profile.sample.size, isNew: false });
    if (cachedSample) {
      setCloneFile({ fileName: profile.sample.fileName, mimeType: profile.sample.mimeType, size: profile.sample.size, dataUrl: cachedSample, isNew: false });
      setVoiceSampleLoading(false);
      return undefined;
    }

    let active = true;
    loadVoiceSample(profile.id)
      .then((dataUrl) => {
        if (!active || requestId !== voiceSampleRequestRef.current) return;
        voiceSampleCacheRef.current.set(profile.id, dataUrl);
        setCloneFile({ fileName: profile.sample.fileName, mimeType: profile.sample.mimeType, size: profile.sample.size, dataUrl, isNew: false });
        setVoiceSampleLoading(false);
      })
      .catch((error) => {
        if (!active || requestId !== voiceSampleRequestRef.current) return;
        setCloneFile({ fileName: profile.sample.fileName, mimeType: profile.sample.mimeType, size: profile.sample.size, error: error instanceof Error ? error.message : '读取音色样本失败' });
        setVoiceSampleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedVoiceId, voices]);

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
    if (voiceToPreview.kind !== 'clone' && !api.apiKey.trim()) {
      showToast('error', '请先在 API 设置中配置 API Key');
      return;
    }

    stopVoicePreview();
    const requestId = previewRequestRef.current;
    setPreviewingVoice(voiceToPreview.id);
    try {
      const voiceProfile = { ...voiceToPreview };
      if (voiceProfile.kind === 'clone') {
        if (voiceProfile.sample?.available === false) throw new Error('音色样本文件不存在，请编辑音色并重新上传');
        const cachedSample = voiceSampleCacheRef.current.get(voiceProfile.id);
        voiceProfile.sampleDataUrl = cachedSample || await loadVoiceSample(voiceProfile.id);
        voiceSampleCacheRef.current.set(voiceProfile.id, voiceProfile.sampleDataUrl);
      }
      if (requestId !== previewRequestRef.current) return;
      let audioUrl;
      let previewSample;
      if (voiceProfile.kind === 'clone') {
        // Clone 的试听直接播放已保存的参考样本，不需要再次调用 API，也不只是提供下载。
        audioUrl = voiceProfile.sampleDataUrl;
      } else {
        const audioBlob = await synthesize({
          endpoint: api.endpoint,
          apiKey: api.apiKey,
          voiceProfile,
          text: voiceProfile.kind === 'design' ? voiceProfile.previewText?.trim() || DEFAULT_PREVIEW_TEXT : DEFAULT_PREVIEW_TEXT,
          styleInstruction: '语气自然、清晰、亲切，适合试听音色。',
          format: 'wav',
          stream: false,
          optimizeTextPreview: false,
        });
        if (requestId !== previewRequestRef.current) return;
        const sampleDataUrl = await fileToDataUrl(audioBlob);
        if (requestId !== previewRequestRef.current) return;
        if (base64LengthFromDataUrl(sampleDataUrl) > MAX_CLONE_BASE64_BYTES) {
          throw new Error('生成的试听样本超过 10 MB，无法保存为复刻音色');
        }
        if (voiceProfile.kind === 'design') {
          // 新建设计草稿没有持久化 ID，但试听样本仍要返回创建面板用于复刻。
          previewSample = {
            dataUrl: sampleDataUrl,
            fileName: voiceToPreview.name + '-试听.' + fileExtensionForAudioBlob(audioBlob),
            mimeType: audioBlob.type,
            size: audioBlob.size,
          };
        }
        audioUrl = URL.createObjectURL(audioBlob);
        previewUrlRef.current = audioUrl;
      }
      const previewAudio = previewAudioRef.current;
      previewAudio.src = audioUrl;
      previewAudio.load();
      await previewAudio.play();
      if (requestId === previewRequestRef.current) {
        if (previewSample && voiceProfile.id !== VOICE_DRAFT_ID) {
          previewSampleCacheRef.current.set(voiceToPreview.id, previewSample);
          setPreviewSampleReadyVoiceId(voiceToPreview.id);
        }
        showToast('success', voiceToPreview.name + (voiceProfile.kind === 'clone' ? '样本试听已开始' : '试听已开始'));
        return previewSample ? { sample: previewSample } : null;
      }
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      stopVoicePreview();
      showToast('error', error instanceof Error ? error.message : '音色试听失败，请检查 API 设置');
    }
  };

  const previewDraft = async (draft) => {
    try {
      const voiceProfile = {
        id: draft.voiceId || VOICE_DRAFT_ID,
        kind: draft.kind,
        name: draft.name || '音色草稿',
        providerVoiceId: draft.kind === 'preset' ? draft.providerVoiceId : undefined,
        voiceDescription: draft.voiceDescription,
        previewText: draft.previewText,
        sampleDataUrl: draft.sampleDataUrl,
      };
      if (voiceProfile.kind === 'clone' && !voiceProfile.sampleDataUrl) {
        const sampleVoiceId = draft.voiceId || draft.sourceVoiceId;
        if (!sampleVoiceId) throw new Error('试听复刻草稿前需要准备音频样本');
        voiceProfile.sampleDataUrl = voiceSampleCacheRef.current.get(sampleVoiceId) || await loadVoiceSample(sampleVoiceId);
        voiceSampleCacheRef.current.set(sampleVoiceId, voiceProfile.sampleDataUrl);
      }
      return await previewVoice(voiceProfile);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '试听草稿失败');
    }
  };

  const solidifyDesignVoice = (voiceToSolidify) => {
    if (voiceToSolidify.kind !== 'design' || voiceToSolidify.readOnly) return;
    try {
      const initialValues = buildCloneDraftFromPreview(voiceToSolidify, previewSampleCacheRef.current.get(voiceToSolidify.id));
      setEditorState({
        voice: null,
        initialKind: 'clone',
        initialValues,
        source: page,
      });
      setDetailVoiceId('');
      showToast('success', '已载入刚刚的试听样本，请确认后保存为复刻音色');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '载入试听样本失败');
    }
  };

  const handleGenerate = async () => {
    if (!activeVoiceProfile) { showToast('error', '请先从声音库选择音色'); return; }
    if (!text.trim()) { showToast('error', '请先输入要合成的文本'); return; }
    if (text.length > 5000) { showToast('error', '单段文本不能超过 5000 字，请切换到分段模式生成'); return; }
    if (mode === 'design' && !voiceDescription.trim()) { showToast('error', '设计音色需要填写音色描述'); return; }
    if (mode === 'clone' && !cloneFile?.dataUrl) { showToast('error', '音色复刻需要先读取或上传音频样本'); return; }
    if (!api.apiKey.trim()) { showToast('error', '请先在 API 设置中配置 API Key'); return; }
    setIsGenerating(true);
    try {
      const audioBlob = await synthesize({ endpoint: api.endpoint, apiKey: api.apiKey, voiceProfile: activeVoiceProfile, text, styleInstruction, format, stream, optimizeTextPreview: optimizePreview });
      const outputFormat = fileExtensionForAudioBlob(audioBlob);
      const audioUrl = URL.createObjectURL(audioBlob);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = audioUrl;
      setResult({ name: '工作台·语音合成_' + new Date().toISOString().slice(0, 10).replaceAll('-', ''), modeLabel: MODE_CONFIG[mode].label + ' · ' + selectedVoice.name, format: outputFormat, duration: 0, sizeLabel: (audioBlob.size / 1024).toFixed(0) + ' KB', audioUrl });
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

  const openCreateVoice = (kind = 'design') => {
    setEditorState({ voice: null, initialKind: kind, initialValues: null, source: page });
    setDetailVoiceId('');
  };

  const openEditVoice = (voiceToEdit) => {
    setEditorState({ voice: voiceToEdit, initialKind: voiceToEdit.kind, initialValues: null, source: page });
    setDetailVoiceId('');
  };

  const saveVoice = async (payload) => {
    setVoiceSaving(true);
    try {
      const savedVoice = payload.voiceId
        ? await updateVoiceProfile(payload.voiceId, payload)
        : await createVoiceProfile(payload);
      if (payload.sampleDataUrl) voiceSampleCacheRef.current.set(savedVoice.id, payload.sampleDataUrl);
      setCustomVoices((current) => payload.voiceId ? current.map((voiceItem) => voiceItem.id === savedVoice.id ? savedVoice : voiceItem) : [savedVoice, ...current]);
      if (payload.voiceId && payload.kind === 'design') {
        previewSampleCacheRef.current.delete(savedVoice.id);
        if (previewSampleReadyVoiceId === savedVoice.id) setPreviewSampleReadyVoiceId('');
      }
      setVoiceLoadStatus('ready');
      setVoiceError('');
      setSelectedVoiceId(savedVoice.id);
      setEditorState(null);
      setDetailVoiceId(payload.useAfterSave || editorState?.source === 'workbench' ? '' : savedVoice.id);
      if (payload.useAfterSave) setPage('workbench');
      showToast('success', payload.voiceId ? '音色修改已保存' : '音色已保存到声音库');
    } finally {
      setVoiceSaving(false);
    }
  };

  const removeVoice = async (voiceToDelete) => {
    if (voiceToDelete.readOnly) return;
    if (!window.confirm('确定删除“' + voiceToDelete.name + '”？删除后无法在声音库中恢复。')) return;
    try {
      await deleteVoiceProfile(voiceToDelete.id);
      setCustomVoices((current) => current.filter((voiceItem) => voiceItem.id !== voiceToDelete.id));
      setFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(voiceToDelete.id);
        return next;
      });
      voiceSampleCacheRef.current.delete(voiceToDelete.id);
      previewSampleCacheRef.current.delete(voiceToDelete.id);
      if (previewSampleReadyVoiceId === voiceToDelete.id) setPreviewSampleReadyVoiceId('');
      setDetailVoiceId('');
      if (selectedVoiceId === voiceToDelete.id) {
        setSelectedVoiceId('');
        setVoiceDescription('');
        setCloneFile(null);
        showToast('success', '音色已删除，请在工作台重新选择音色');
      } else {
        showToast('success', '音色已删除');
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除音色失败');
    }
  };

  const toggleFavorite = async (voiceToToggle) => {
    const nextFavorite = !favoriteIds.has(voiceToToggle.id);
    try {
      await setVoiceFavorite(voiceToToggle.id, nextFavorite);
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (nextFavorite) next.add(voiceToToggle.id);
        else next.delete(voiceToToggle.id);
        return next;
      });
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '更新音色收藏失败');
    }
  };

  const handleUseVoice = (voiceToUse) => {
    setSelectedVoiceId(voiceToUse.id);
    setDetailVoiceId('');
    setPage('workbench');
  };

  const voiceDraftDirty = Boolean(selectedVoice && (
    (selectedVoice.kind === 'design' && voiceDescription.trim() !== selectedVoice.voiceDescription.trim())
    || (selectedVoice.kind === 'clone' && cloneFile?.isNew)
  ));

  const changeCreationMode = (nextMode) => {
    if (nextMode === creationMode) return;
    if (isBatchGenerating || isComposing || generatingSegmentId) {
      showToast('error', '请等待当前生成任务完成后再切换创作模式');
      return;
    }
    if (nextMode === 'segments') {
      if (voiceDraftDirty && !window.confirm('当前音色配置尚未保存，分段模式只使用声音库中的已保存音色，是否继续？')) return;
      const segmentText = segmentsRef.current.map((segment) => segment.text).join('\n');
      if (!segmentsRef.current.length || text !== segmentText) {
        stopSegmentPreview();
        invalidateMergedAudio();
        setSegments([createSegment(text, selectedVoiceId)]);
      }
      setCreationMode('segments');
      return;
    }
    if (mergedAudioRef.current) mergedAudioRef.current.pause();
    setIsMergedPlaying(false);
    setText(segmentsRef.current.map((segment) => segment.text).join('\n'));
    stopSegmentPreview();
    setCreationMode('single');
  };

  const selectVoice = (voiceToUse) => {
    if (voiceToUse.id === selectedVoiceId) return;
    if (page === 'workbench' && voiceDraftDirty && !window.confirm('当前音色配置尚未保存，切换音色后修改会丢失，是否继续？')) return;
    setSelectedVoiceId(voiceToUse.id);
  };
  const navigate = (nextPage) => {
    if (isBatchGenerating || isComposing || generatingSegmentId) {
      showToast('error', '请等待当前生成任务完成后再离开工作台');
      return;
    }
    const hasWorkbenchVoiceEditor = editorState?.source === 'workbench';
    if (page === 'workbench' && nextPage !== 'workbench' && (voiceDraftDirty || hasWorkbenchVoiceEditor)) {
      if (!window.confirm('当前音色配置尚未保存，离开后修改会丢失，是否继续？')) return;
      setEditorState(null);
      setDetailVoiceId('');
    }
    if (page === 'workbench' && nextPage !== 'workbench') {
      stopSegmentPreview();
      mergedAudioRef.current?.pause();
      setIsMergedPlaying(false);
    }
    setPage(nextPage);
  };

  const saveCurrentVoiceConfig = () => {
    if (!selectedVoice || !['design', 'clone'].includes(selectedVoice.kind)) return;
    setEditorState({
      voice: null,
      initialKind: selectedVoice.kind,
      initialValues: {
        name: selectedVoice.name + ' 副本',
        voiceDescription: selectedVoice.kind === 'design' ? voiceDescription : undefined,
        sample: selectedVoice.kind === 'clone' ? cloneFile : null,
      },
      source: 'workbench',
    });
  };

  const resolveSegmentVoiceProfile = async (voiceId) => {
    const voiceProfile = voices.find((voiceItem) => voiceItem.id === voiceId);
    if (!voiceProfile) {
      throw new Error('段落选择的音色已不存在，请重新选择声音库中的音色');
    }
    if (voiceProfile.kind !== 'clone') return voiceProfile;
    if (voiceProfile.sample?.available === false) {
      throw new Error('音色“' + voiceProfile.name + '”的样本文件不存在，请重新上传');
    }

    let sampleDataUrl = voiceSampleCacheRef.current.get(voiceProfile.id);
    if (!sampleDataUrl) {
      let samplePromise = voiceSamplePromiseCacheRef.current.get(voiceProfile.id);
      if (!samplePromise) {
        samplePromise = loadVoiceSample(voiceProfile.id)
          .then((dataUrl) => {
            voiceSampleCacheRef.current.set(voiceProfile.id, dataUrl);
            return dataUrl;
          })
          .finally(() => {
            voiceSamplePromiseCacheRef.current.delete(voiceProfile.id);
          });
        voiceSamplePromiseCacheRef.current.set(voiceProfile.id, samplePromise);
      }
      sampleDataUrl = await samplePromise;
    }
    return { ...voiceProfile, sampleDataUrl };
  };

  const buildSegmentGenerationOptions = () => ({
    endpoint: api.endpoint,
    apiKey: api.apiKey,
    styleInstruction,
    format,
    stream,
    optimizeTextPreview: optimizePreview,
  });

  const nextSegmentRequestToken = (segmentId) => {
    const token = (segmentRequestTokensRef.current.get(segmentId) || 0) + 1;
    segmentRequestTokensRef.current.set(segmentId, token);
    return token;
  };

  const generateSegmentAudio = async (segmentSnapshot, options, batchRunId = null) => {
    const requestToken = nextSegmentRequestToken(segmentSnapshot.id);
    const generationRevision = segmentSnapshot.generationRevision + 1;
    setSegments((current) => current.map((segment) => segment.id === segmentSnapshot.id ? {
      ...segment,
      status: 'generating',
      audioBlob: null,
      audioUrl: '',
      duration: 0,
      error: '',
      generationRevision,
    } : segment));

    try {
      const voiceProfile = await resolveSegmentVoiceProfile(segmentSnapshot.voiceId);
      const audioBlob = await synthesize({ ...options, voiceProfile, text: segmentSnapshot.text });
      const audioUrl = URL.createObjectURL(audioBlob);
      const isCurrentRequest = segmentRequestTokensRef.current.get(segmentSnapshot.id) === requestToken;
      const isCurrentBatch = batchRunId === null || batchRunRef.current === batchRunId;
      if (!isCurrentRequest || !isCurrentBatch) {
        URL.revokeObjectURL(audioUrl);
        return { status: 'stale' };
      }
      setSegments((current) => current.map((segment) => segment.id === segmentSnapshot.id ? {
        ...segment,
        status: 'ready',
        audioBlob,
        audioUrl,
        duration: 0,
        error: '',
        generationRevision,
      } : segment));
      return { status: 'ready' };
    } catch (error) {
      const isCurrentRequest = segmentRequestTokensRef.current.get(segmentSnapshot.id) === requestToken;
      const isCurrentBatch = batchRunId === null || batchRunRef.current === batchRunId;
      if (!isCurrentRequest || !isCurrentBatch) return { status: 'stale' };
      const message = error instanceof Error ? error.message : '该段落生成失败';
      setSegments((current) => current.map((segment) => segment.id === segmentSnapshot.id ? {
        ...segment,
        status: 'error',
        audioBlob: null,
        audioUrl: '',
        duration: 0,
        error: message,
        generationRevision,
      } : segment));
      return { status: 'error', error: message };
    }
  };

  const setSegmentValidationErrors = (invalidSegments) => {
    const messages = new Map(invalidSegments.map(({ id, message }) => [id, message]));
    invalidSegments.forEach(({ id }) => nextSegmentRequestToken(id));
    setSegments((current) => current.map((segment) => {
      const message = messages.get(segment.id);
      if (!message) return segment;
      return { ...segment, status: 'error', audioBlob: null, audioUrl: '', duration: 0, error: message, generationRevision: segment.generationRevision + 1 };
    }));
    invalidateMergedAudio();
  };

  const generateSingleSegment = async (segmentId) => {
    if (isBatchGenerating || isComposing || generatingSegmentId) return;
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    if (!segment) return;
    if (!segment.text.trim()) {
      setSegmentValidationErrors([{ id: segment.id, message: '请填写段落文本后再生成' }]);
      showToast('error', '请先填写这一段的文本');
      return;
    }
    if (segment.text.length > 5000) {
      setSegmentValidationErrors([{ id: segment.id, message: '单段文本不能超过 5000 字' }]);
      showToast('error', '这一段文本不能超过 5000 字');
      return;
    }
    if (!voices.some((voiceItem) => voiceItem.id === segment.voiceId)) {
      setSegmentValidationErrors([{ id: segment.id, message: '段落音色不存在，请重新选择' }]);
      showToast('error', '请为这一段重新选择音色');
      return;
    }
    if (!api.apiKey.trim()) {
      showToast('error', '请先在 API 设置中配置 API Key');
      return;
    }
    stopSegmentPreview();
    invalidateMergedAudio();
    setGeneratingSegmentId(segmentId);
    try {
      const outcome = await generateSegmentAudio(segment, buildSegmentGenerationOptions());
      if (outcome.status === 'ready') showToast('success', '第 ' + (segmentsRef.current.findIndex((item) => item.id === segmentId) + 1) + ' 段已生成');
      if (outcome.status === 'error') showToast('error', '第 ' + (segmentsRef.current.findIndex((item) => item.id === segmentId) + 1) + ' 段生成失败：' + outcome.error);
    } finally {
      setGeneratingSegmentId((current) => current === segmentId ? '' : current);
    }
  };

  const generateAllSegments = async () => {
    if (isBatchGenerating || isComposing || generatingSegmentId) return;
    if (!api.apiKey.trim()) {
      showToast('error', '请先在 API 设置中配置 API Key');
      return;
    }
    const snapshot = segmentsRef.current;
    const invalidSegments = snapshot.flatMap((segment) => {
      if (!segment.text.trim()) return [{ id: segment.id, message: '请填写段落文本后再批量生成' }];
      if (segment.text.length > 5000) return [{ id: segment.id, message: '单段文本不能超过 5000 字' }];
      if (!voices.some((voiceItem) => voiceItem.id === segment.voiceId)) return [{ id: segment.id, message: '段落音色不存在，请重新选择' }];
      return [];
    });
    if (invalidSegments.length) {
      setSegmentValidationErrors(invalidSegments);
      showToast('error', '请先修正标记为失败的段落');
      return;
    }

    const pendingSegments = snapshot.filter((segment) => segment.status !== 'ready' || !segment.audioBlob);
    if (!pendingSegments.length) {
      showToast('success', '所有段落都已生成，无需重复请求');
      return;
    }

    const batchRunId = batchRunRef.current + 1;
    batchRunRef.current = batchRunId;
    const options = buildSegmentGenerationOptions();
    setIsBatchGenerating(true);
    setBatchProgress({ completed: 0, total: pendingSegments.length, failed: 0 });
    stopSegmentPreview();
    invalidateMergedAudio();
    setSegments((current) => current.map((segment) => pendingSegments.some((pending) => pending.id === segment.id) ? { ...segment, status: 'queued', audioBlob: null, audioUrl: '', duration: 0, error: '' } : segment));

    let cursor = 0;
    let failedCount = 0;
    const worker = async () => {
      while (cursor < pendingSegments.length) {
        const segment = pendingSegments[cursor];
        cursor += 1;
        const outcome = await generateSegmentAudio(segment, options, batchRunId);
        if (outcome.status === 'error') failedCount += 1;
        setBatchProgress((current) => ({ ...current, completed: current.completed + 1, failed: current.failed + (outcome.status === 'error' ? 1 : 0) }));
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(SEGMENT_BATCH_CONCURRENCY, pendingSegments.length) }, () => worker()));
      if (failedCount) showToast('error', '批量生成完成：' + (pendingSegments.length - failedCount) + ' 段成功，' + failedCount + ' 段失败');
      else showToast('success', '已完成 ' + pendingSegments.length + ' 段音频生成');
    } finally {
      if (batchRunRef.current === batchRunId) setIsBatchGenerating(false);
    }
  };

  const detailVoice = voices.find((voiceItem) => voiceItem.id === detailVoiceId);
  const canGenerate = Boolean(selectedVoice) && !voiceSampleLoading && (mode !== 'clone' || Boolean(cloneFile?.dataUrl));

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
  const downloadSegmentAudio = (segment) => {
    if (segment.status !== 'ready' || !segment.audioBlob || !segment.audioUrl) return;
    const segmentIndex = segmentsRef.current.findIndex((item) => item.id === segment.id);
    if (segmentIndex < 0) return;
    const extension = fileExtensionForAudioBlob(segment.audioBlob);
    const link = document.createElement('a');
    link.href = segment.audioUrl;
    link.download = '工作台·第' + String(segmentIndex + 1).padStart(2, '0') + '段.' + extension;
    link.click();
  };
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

  const toggleSegmentPreview = async (segment) => {
    if (segment.status !== 'ready' || !segment.audioUrl || isBatchGenerating || isComposing || generatingSegmentId) return;
    if (previewingSegmentId === segment.id) {
      if (isSegmentPreviewPlaying) {
        segmentAudioRef.current?.pause();
        setIsSegmentPreviewPlaying(false);
      } else {
        const audio = segmentAudioRef.current;
        if (!audio) return;
        const requestId = segmentPreviewRequestRef.current;
        try {
          await audio.play();
          if (requestId !== segmentPreviewRequestRef.current) return;
          setIsSegmentPreviewPlaying(true);
        } catch (error) {
          if (requestId !== segmentPreviewRequestRef.current) return;
          showToast('error', error instanceof Error ? error.message : '段落试听失败');
          stopSegmentPreview();
        }
      }
      return;
    }

    stopSegmentPreview();
    const requestId = segmentPreviewRequestRef.current;
    const audio = segmentAudioRef.current;
    if (!audio) return;
    setPreviewingSegmentId(segment.id);
    setIsSegmentPreviewPlaying(false);
    audio.src = segment.audioUrl;
    audio.load();
    try {
      await audio.play();
      if (requestId !== segmentPreviewRequestRef.current) return;
      setIsSegmentPreviewPlaying(true);
    } catch (error) {
      if (requestId !== segmentPreviewRequestRef.current) return;
      showToast('error', error instanceof Error ? error.message : '段落试听失败');
      stopSegmentPreview();
    }
  };

  const handleSegmentPreviewEnded = () => {
    if (segmentAudioRef.current) segmentAudioRef.current.currentTime = 0;
    setIsSegmentPreviewPlaying(false);
  };

  const handleSegmentPreviewMetadata = (event) => {
    const segmentId = previewingSegmentId;
    const nextDuration = event.currentTarget.duration;
    if (!segmentId || !Number.isFinite(nextDuration)) return;
    setSegments((current) => current.map((segment) => segment.id === segmentId ? { ...segment, duration: nextDuration } : segment));
  };

  const toggleMergedPlayback = async (forcedValue) => {
    if (!mergedAudioRef.current || !mergedResult.audioUrl) return;
    const nextPlaying = typeof forcedValue === 'boolean' ? forcedValue : !isMergedPlaying;
    try {
      if (nextPlaying) await mergedAudioRef.current.play();
      else mergedAudioRef.current.pause();
      setIsMergedPlaying(nextPlaying);
    } catch (error) {
      setIsMergedPlaying(false);
      showToast('error', error instanceof Error ? error.message : '完整音频播放失败');
    }
  };

  const seekMergedAudio = (nextProgress, shouldSeek, nextDuration) => {
    if (nextDuration) setMergedDuration(nextDuration);
    setMergedProgress(nextProgress);
    syncPlaybackPosition(mergedAudioRef.current, nextProgress, shouldSeek);
  };

  const jumpMergedAudio = (seconds) => {
    if (!mergedAudioRef.current || !Number.isFinite(mergedAudioRef.current.duration)) return;
    const nextTime = Math.min(mergedAudioRef.current.duration, Math.max(0, mergedAudioRef.current.currentTime + seconds));
    mergedAudioRef.current.currentTime = nextTime;
    setMergedProgress(nextTime / mergedAudioRef.current.duration);
  };

  const downloadMergedAudio = () => {
    if (!mergedResult.audioUrl) return;
    const link = document.createElement('a');
    link.href = mergedResult.audioUrl;
    link.download = mergedResult.name + '.wav';
    link.click();
  };

  const renameMergedAudio = () => {
    const nextName = window.prompt('重命名完整音频', mergedResult.name);
    if (nextName?.trim()) setMergedResult((current) => ({ ...current, name: nextName.trim() }));
  };

  const canComposeSegments = Boolean(segments.length) && segments.every((segment) => segment.status === 'ready' && segment.audioBlob);
  const composeSegments = async () => {
    if (!canComposeSegments || isBatchGenerating || isComposing || generatingSegmentId) return;
    const snapshot = segmentsRef.current;
    const revisions = new Map(snapshot.map((segment) => [segment.id, segment.generationRevision]));
    setIsComposing(true);
    stopSegmentPreview();
    invalidateMergedAudio();
    try {
      const composed = await composeAudioSegments(snapshot.map((segment) => segment.audioBlob));
      const isCurrent = snapshot.length === segmentsRef.current.length && snapshot.every((segment) => {
        const current = segmentsRef.current.find((item) => item.id === segment.id);
        return current && revisions.get(segment.id) === current.generationRevision && current.audioBlob;
      });
      if (!isCurrent) return;
      const audioUrl = URL.createObjectURL(composed.blob);
      if (mergedUrlRef.current) URL.revokeObjectURL(mergedUrlRef.current);
      mergedUrlRef.current = audioUrl;
      setMergedResult({
        name: '工作台·多音色合成_' + new Date().toISOString().slice(0, 10).replaceAll('-', ''),
        modeLabel: '多音色 · ' + snapshot.length + ' 段',
        format: 'wav',
        duration: composed.duration,
        sizeLabel: (composed.blob.size / 1024).toFixed(0) + ' KB',
        audioUrl,
      });
      showToast('success', '完整音频已合成，可以试听或下载');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '完整音频合成失败');
    } finally {
      setIsComposing(false);
    }
  };

  return (
    <div className={'app-shell ' + (page === 'workbench' ? 'workbench-active' : '')}>
      <Sidebar page={page} onNavigate={navigate} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} apiReady={apiReady} />
      <main className="main-area">
        <Topbar title={title} onOpenMenu={() => setMobileOpen(true)} onOpenApi={() => navigate('api')} />
        <div className="page-scroller">
          {page === 'workbench' && <Workbench creationMode={creationMode} onCreationModeChange={changeCreationMode} mode={mode} selectedVoice={selectedVoice} voices={voices} onVoiceChange={selectVoice} onOpenLibrary={() => navigate('library')} onCreateVoice={openCreateVoice} voiceLoadError={voiceError} text={text} onTextChange={setText} onInsert={insertText} onClear={() => setText('')} styleInstruction={styleInstruction} onStyleChange={setStyleInstruction} voiceDescription={voiceDescription} onVoiceDescriptionChange={setVoiceDescription} cloneFile={cloneFile} onCloneFileChange={setCloneFile} tags={tags} onRemoveTag={removeTag} onAddTag={addTag} format={format} onFormatChange={setFormat} stream={stream} onStreamChange={setStream} optimizePreview={optimizePreview} onOptimizePreview={setOptimizePreview} isGenerating={isGenerating} canGenerate={canGenerate} onGenerate={handleGenerate} onSaveCurrentVoice={saveCurrentVoiceConfig} voiceSampleLoading={voiceSampleLoading} result={result} audioRef={audioRef} isPlaying={isPlaying} progress={progress} duration={duration} onToggle={togglePlayback} onSeek={seekAudio} onJump={jumpAudio} onRename={renameAudio} onDownload={downloadAudio} apiReady={apiReady} segments={segments} onSplitSegments={splitSegmentsByNewline} onAddSegment={addSegment} onSegmentTextChange={updateSegmentText} onSegmentVoiceChange={updateSegmentVoice} onMoveSegment={moveSegment} onDuplicateSegment={duplicateSegment} onDeleteSegment={deleteSegment} previewingSegmentId={previewingSegmentId} isSegmentPreviewPlaying={isSegmentPreviewPlaying} onGenerateSegment={generateSingleSegment} onDownloadSegment={downloadSegmentAudio} onToggleSegmentPreview={toggleSegmentPreview} isBatchGenerating={isBatchGenerating} generatingSegmentId={generatingSegmentId} batchProgress={batchProgress} onGenerateAllSegments={generateAllSegments} isComposing={isComposing} canComposeSegments={canComposeSegments} onComposeSegments={composeSegments} mergedResult={mergedResult} mergedAudioRef={mergedAudioRef} isMergedPlaying={isMergedPlaying} mergedProgress={mergedProgress} mergedDuration={mergedDuration} onToggleMerged={toggleMergedPlayback} onSeekMerged={seekMergedAudio} onJumpMerged={jumpMergedAudio} onRenameMerged={renameMergedAudio} onDownloadMerged={downloadMergedAudio} segmentAudioRef={segmentAudioRef} onSegmentPreviewEnded={handleSegmentPreviewEnded} onSegmentPreviewMetadata={handleSegmentPreviewMetadata} />}
          {page === 'library' && <VoiceLibrary voices={voices} selectedVoiceId={selectedVoiceId} voiceLoadStatus={voiceLoadStatus} voiceError={voiceError} onRetry={reloadVoices} onOpenVoice={(voiceToOpen) => setDetailVoiceId(voiceToOpen.id)} onPreview={previewVoice} previewingVoice={previewingVoice} onCreateVoice={openCreateVoice} onToggleFavorite={toggleFavorite} />}
          {page === 'history' && <HistoryPage onReuse={() => { navigate('workbench'); showToast('success', '已将历史配置载入工作台'); }} />}
          {page === 'api' && <ApiSettings api={api} savedApiKey={savedApiKey} onApiChange={updateApi} onSave={persistApiSettings} persistenceStatus={apiPersistenceStatus} />}
        </div>
      </main>
      <audio ref={previewAudioRef} preload="auto" hidden onEnded={stopVoicePreview} />
      {detailVoice && <VoiceDetailDrawer voice={detailVoice} sourceVoiceName={detailVoice.sourceVoiceId ? voices.find((voiceItem) => voiceItem.id === detailVoice.sourceVoiceId)?.name : ''} onClose={() => setDetailVoiceId('')} onUse={handleUseVoice} onPreview={previewVoice} previewingVoice={previewingVoice} previewSampleReady={previewSampleReadyVoiceId === detailVoice.id && Boolean(previewSampleCacheRef.current.get(detailVoice.id))} onToggleFavorite={toggleFavorite} onEdit={openEditVoice} onDelete={removeVoice} onSolidify={solidifyDesignVoice} />}
      {editorState && <VoiceEditorDrawer voice={editorState.voice} initialKind={editorState.initialKind} initialValues={editorState.initialValues} saving={voiceSaving} onClose={() => setEditorState(null)} onSave={saveVoice} onPreview={previewDraft} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
