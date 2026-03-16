import React, { useRef, useState, useEffect } from 'react'
import {
  BrainCircuit, Calculator, Loader2, Database, Trash2, Plus,
  KeyRound, Eye, EyeOff, ChevronDown, ChevronRight, ExternalLink, FileText, BookOpen, File,
} from 'lucide-react'
import type { GenerationConfig, Resource, ResourceType } from '../../lib/types'
import type { AIProvider } from '../../lib/providers'
import {
  IGCSE_SUBJECTS, IGCSE_TOPICS, DIFFICULTY_LEVELS,
} from '../../lib/gemini'
import { estimateCostIDR, MODEL_PRICING } from '../../lib/pricing'
import {
  PROVIDER_LABELS, PROVIDER_MODELS, API_KEY_PLACEHOLDERS, API_KEY_URLS, API_USAGE_URLS,
} from '../../lib/providers'

const QUESTION_TYPES = ['Mixed', 'Multiple Choice', 'Short Answer', 'Structured']

interface Props {
  config: GenerationConfig
  onConfigChange: (patch: Partial<GenerationConfig>) => void
  onGenerate: () => void
  isGenerating: boolean
  isAuditing: boolean
  retryCount: number
  resources: Resource[]
  knowledgeBase: Resource[]
  onUploadResource: (file: File, subject: string, resourceType?: ResourceType) => void
  onAddToKB: (resource: Resource) => void
  onRemoveFromKB: (id: string) => void
  onDeleteResource: (resource: Resource) => void
  onUpdateResourceType: (resource: Resource, type: ResourceType) => void
  studentMode: boolean
  onStudentModeToggle: () => void
  syllabusContext: string
  onSyllabusContextChange: (v: string) => void
  // API settings
  provider: AIProvider
  onProviderChange: (p: AIProvider) => void
  apiKeys: Record<AIProvider, string>
  onApiKeyChange: (p: AIProvider, key: string) => void
  customModel: string
  onCustomModelChange: (v: string) => void
  apiSettingsOpen?: boolean
  onApiSettingsOpenChange?: (open: boolean) => void
}

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  past_paper: 'Past Paper',
  syllabus: 'Syllabus',
  other: 'Other',
}

const RESOURCE_TYPE_ICONS: Record<ResourceType, React.ReactNode> = {
  past_paper: <FileText className="w-2.5 h-2.5" />,
  syllabus: <BookOpen className="w-2.5 h-2.5" />,
  other: <File className="w-2.5 h-2.5" />,
}

const RESOURCE_TYPE_COLORS: Record<ResourceType, string> = {
  past_paper: 'bg-blue-100 text-blue-700',
  syllabus: 'bg-purple-100 text-purple-700',
  other: 'bg-stone-100 text-stone-500',
}

export function Sidebar({
  config, onConfigChange, onGenerate, isGenerating, isAuditing, retryCount,
  resources, knowledgeBase, onUploadResource, onAddToKB, onRemoveFromKB, onDeleteResource, onUpdateResourceType,
  studentMode, onStudentModeToggle, syllabusContext, onSyllabusContextChange,
  provider, onProviderChange, apiKeys, onApiKeyChange, customModel, onCustomModelChange,
  apiSettingsOpen, onApiSettingsOpenChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingType, setPendingType] = useState<ResourceType>('other')

  useEffect(() => {
    if (apiSettingsOpen) setSettingsOpen(true)
  }, [apiSettingsOpen])

  const toggleSettings = () => {
    const next = !settingsOpen
    setSettingsOpen(next)
    onApiSettingsOpenChange?.(next)
  }

  const models = PROVIDER_MODELS[provider] ?? []
  const effectiveModel = customModel.trim() || config.model
  const inputTokens = Math.round(1500 + (syllabusContext.length / 4))
  const outputTokens = config.count * 600
  const costIDR = estimateCostIDR(effectiveModel, inputTokens, outputTokens)
  const currentApiKey = apiKeys[provider] ?? ''

  return (
    <div className="w-80 border-r border-stone-200 bg-stone-50 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-stone-200">
        <h2 className="font-semibold text-stone-800 text-sm flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-emerald-600" />
          Assessment Designer
        </h2>
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Provider */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">AI Provider</label>
          <select
            value={provider}
            onChange={e => onProviderChange(e.target.value as AIProvider)}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {/* Subject */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Subject</label>
          <select
            value={config.subject}
            onChange={e => onConfigChange({ subject: e.target.value, topic: IGCSE_TOPICS[e.target.value][0] })}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {IGCSE_SUBJECTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Topic */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Topic</label>
          <select
            value={config.topic}
            onChange={e => onConfigChange({ topic: e.target.value })}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {(IGCSE_TOPICS[config.subject] ?? []).map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        {/* Difficulty */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Difficulty</label>
          <select
            value={config.difficulty}
            onChange={e => onConfigChange({ difficulty: e.target.value })}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {DIFFICULTY_LEVELS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

        {/* Count */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">
            Questions: {config.count}
          </label>
          <input
            type="range" min={1} max={20} value={config.count}
            onChange={e => onConfigChange({ count: Number(e.target.value) })}
            className="w-full accent-emerald-600"
          />
        </div>

        {/* Question Type */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Question Type</label>
          <select
            value={config.type}
            onChange={e => onConfigChange({ type: e.target.value })}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            {QUESTION_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Model</label>
          <select
            value={config.model}
            onChange={e => onConfigChange({ model: e.target.value })}
            className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
            disabled={!!customModel.trim()}
          >
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <input
            type="text"
            value={customModel}
            onChange={e => onCustomModelChange(e.target.value)}
            placeholder="Custom model ID (overrides dropdown)"
            className="w-full text-xs border border-stone-300 rounded-lg px-2 py-1.5 mt-1 font-mono"
          />
        </div>

        {/* Calculator */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="calc" checked={config.calculator}
            onChange={e => onConfigChange({ calculator: e.target.checked })}
            className="accent-emerald-600"
          />
          <label htmlFor="calc" className="text-xs text-stone-600 flex items-center gap-1">
            <Calculator className="w-3.5 h-3.5" /> Calculator Allowed
          </label>
        </div>

        {/* Syllabus context */}
        <div>
          <label className="text-xs font-medium text-stone-600 mb-1 block">Syllabus Context (optional)</label>
          <textarea
            value={syllabusContext}
            onChange={e => onSyllabusContextChange(e.target.value)}
            placeholder="Paste specific learning objectives..."
            rows={3}
            className="w-full text-xs border border-stone-300 rounded-lg px-2 py-1.5 resize-none"
          />
        </div>

        {/* Cost estimate */}
        <div className="text-xs text-stone-500 bg-stone-100 rounded px-2 py-1.5">
          Estimated cost: ~Rp {costIDR.toLocaleString('id-ID')}
          {!MODEL_PRICING_HAS(effectiveModel) && <span className="text-stone-400"> (estimate)</span>}
        </div>

        {/* Student mode */}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="student" checked={studentMode} onChange={onStudentModeToggle} className="accent-emerald-600" />
          <label htmlFor="student" className="text-xs text-stone-600">Student Mode (hide answers)</label>
        </div>

        {/* Generate button */}
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {isAuditing ? 'Auditing...' : retryCount > 0 ? `Retrying ${retryCount}/3...` : 'Generating...'}
            </>
          ) : (
            <>
              <BrainCircuit className="w-4 h-4" />
              Generate Assessment
            </>
          )}
        </button>

        {/* Knowledge Base */}
        <div className="border-t border-stone-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-stone-600 flex items-center gap-1">
              <Database className="w-3.5 h-3.5" /> Knowledge Base
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) {
                  setPendingFile(file)
                  // Auto-detect type from filename
                  const name = file.name.toLowerCase()
                  if (name.includes('syllabus') || name.includes('spec')) setPendingType('syllabus')
                  else if (name.includes('paper') || name.includes('past') || name.includes('exam') || name.includes('ms')) setPendingType('past_paper')
                  else setPendingType('other')
                }
                e.target.value = ''
              }}
            />
          </div>

          {/* Pending upload type selector */}
          {pendingFile && (
            <div className="mb-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-stone-700 truncate mb-1.5 font-medium">{pendingFile.name}</p>
              <label className="text-xs text-stone-500 mb-1 block">Document type:</label>
              <select
                value={pendingType}
                onChange={e => setPendingType(e.target.value as ResourceType)}
                className="w-full text-xs border border-stone-300 rounded px-1.5 py-1 bg-white mb-2"
              >
                <option value="past_paper">Past Paper</option>
                <option value="syllabus">Syllabus</option>
                <option value="other">Other</option>
              </select>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    onUploadResource(pendingFile, config.subject, pendingType)
                    setPendingFile(null)
                  }}
                  className="flex-1 text-xs py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                >
                  Upload
                </button>
                <button
                  onClick={() => setPendingFile(null)}
                  className="text-xs px-2 py-1 bg-stone-200 text-stone-600 rounded hover:bg-stone-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {resources.length === 0 && !pendingFile && (
            <div className="text-xs text-stone-400 italic">No resources uploaded</div>
          )}
          {resources.map(r => {
            const inKB = knowledgeBase.some(x => x.id === r.id)
            const rType = r.resourceType ?? 'other'
            return (
              <div key={r.id} className="py-1">
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={inKB}
                    onChange={() => inKB ? onRemoveFromKB(r.id) : onAddToKB(r)}
                    className="accent-emerald-600 shrink-0"
                  />
                  <span className="flex-1 truncate text-stone-700">{r.name}</span>
                  <button onClick={() => onDeleteResource(r)} className="text-red-400 hover:text-red-600 shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="ml-4 mt-0.5">
                  <select
                    value={rType}
                    onChange={e => onUpdateResourceType(r, e.target.value as ResourceType)}
                    className={`text-xs px-1.5 py-0.5 rounded font-medium border-0 outline-none cursor-pointer ${RESOURCE_TYPE_COLORS[rType]}`}
                  >
                    <option value="past_paper">Past Paper</option>
                    <option value="syllabus">Syllabus</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            )
          })}
        </div>

        {/* API Settings */}
        <div className="border-t border-stone-200 pt-3">
          <button
            onClick={toggleSettings}
            className="flex items-center justify-between w-full text-xs font-medium text-stone-600 mb-2"
          >
            <span className="flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" /> API Settings
              {!currentApiKey && <span className="ml-1 text-amber-500 font-normal">(shared key)</span>}
            </span>
            {settingsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {settingsOpen && (
            <div className="flex flex-col gap-3">
              {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map(p => (
                <div key={p}>
                  <label className="text-xs text-stone-500 mb-1 flex items-center justify-between">
                    <span>{PROVIDER_LABELS[p]} API Key</span>
                    <span className="flex items-center gap-2">
                      <a
                        href={API_KEY_URLS[p]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
                      >
                        Get key <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      {apiKeys[p] && (
                        <a
                          href={API_USAGE_URLS[p]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-stone-400 hover:text-stone-600 flex items-center gap-0.5"
                        >
                          Usage <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </span>
                  </label>
                  <div className="flex gap-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeys[p] ?? ''}
                      onChange={e => onApiKeyChange(p, e.target.value)}
                      placeholder={API_KEY_PLACEHOLDERS[p]}
                      className="flex-1 text-xs border border-stone-300 rounded-lg px-2 py-1.5 font-mono min-w-0"
                    />
                    {p === provider && (
                      <button
                        onClick={() => setShowApiKey(s => !s)}
                        className="p-1.5 text-stone-400 hover:text-stone-600 border border-stone-300 rounded-lg shrink-0"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  {apiKeys[p] && (
                    <p className="text-xs text-emerald-600 mt-0.5">Using your {PROVIDER_LABELS[p]} key</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MODEL_PRICING_HAS(modelId: string): boolean {
  return modelId in MODEL_PRICING
}
