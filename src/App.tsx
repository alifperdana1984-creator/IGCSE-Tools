import React, { useState, useEffect, useCallback, useRef } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { BookOpen, LogIn, LogOut, Library as LibraryIcon, FilePlus, AlertTriangle, X, KeyRound, RefreshCw, Minus, Sparkles, Trash2 } from 'lucide-react'
import type { AIError } from './lib/types'
import { auth, signInWithGoogle, logout, deleteUserData } from './lib/firebase'
import { IGCSE_SUBJECTS, IGCSE_TOPICS, DIFFICULTY_LEVELS } from './lib/gemini'
import { Timestamp } from 'firebase/firestore'
import type { GenerationConfig, Assessment, Question, QuestionItem } from './lib/types'
import { DEFAULT_MODELS } from './lib/providers'
import { useNotifications } from './hooks/useNotifications'
import { useAssessments } from './hooks/useAssessments'
import { useGeneration } from './hooks/useGeneration'
import { useResources } from './hooks/useResources'
import { useApiSettings } from './hooks/useApiSettings'
import { Sidebar } from './components/Sidebar'
import { AssessmentView } from './components/AssessmentView'
import { Library as LibraryView } from './components/Library'
import { Notifications } from './components/Notifications'
import { copyToClipboard } from './lib/clipboard'

const DEFAULT_CONFIG: GenerationConfig = {
  provider: 'gemini',
  subject: 'Mathematics',
  topic: 'Mixed Topics',
  difficulty: 'Balanced',
  count: 4,
  type: 'Mixed',
  calculator: true,
  model: DEFAULT_MODELS['gemini'],
  syllabusContext: '',
}

function ErrorBanner({ error, onDismiss, onRetry, onOpenApiSettings }: {
  error: AIError
  onDismiss: () => void
  onRetry: () => void
  onOpenApiSettings: () => void
}) {
  const isRateLimit = error.type === 'rate_limit'
  const isOverloaded = error.type === 'model_overloaded'

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-amber-800">
            {isRateLimit ? 'API Rate Limit Reached' : isOverloaded ? 'Model Overloaded' : 'Generation Failed'}
          </p>
          <button onClick={onDismiss} className="text-amber-400 hover:text-amber-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-amber-700 mt-1">
          {isRateLimit
            ? 'The shared API key has hit its per-minute or daily limit. To fix this:'
            : isOverloaded
            ? 'The selected model is currently overloaded. To fix this:'
            : error.message}
        </p>
        {(isRateLimit || isOverloaded) && (
          <ol className="mt-2 flex flex-col gap-1.5 text-xs text-amber-800">
            {isRateLimit && (
              <li className="flex items-start gap-1.5">
                <span className="font-bold shrink-0">1.</span>
                <span>
                  <button
                    onClick={onOpenApiSettings}
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-amber-900"
                  >
                    <KeyRound className="w-3 h-3" /> Add your own API key
                  </button>
                  {' '}— available free from your provider's console.
                </span>
              </li>
            )}
            {isOverloaded && (
              <li className="flex items-start gap-1.5">
                <span className="font-bold shrink-0">1.</span>
                <span>
                  Open{' '}
                  <button onClick={onOpenApiSettings} className="font-semibold underline underline-offset-2 hover:text-amber-900">
                    API Settings
                  </button>
                  {' '}and switch to a lighter model (e.g. <code className="bg-amber-100 px-0.5 rounded">gemini-2.0-flash</code> or <code className="bg-amber-100 px-0.5 rounded">gpt-4o-mini</code>).
                </span>
              </li>
            )}
            <li className="flex items-start gap-1.5">
              <span className="font-bold shrink-0">2.</span>
              <span>Wait a few minutes, then try again.</span>
            </li>
            {isRateLimit && (
              <li className="flex items-start gap-1.5">
                <span className="font-bold shrink-0">3.</span>
                <span>Reduce the number of questions in the sidebar.</span>
              </li>
            )}
          </ol>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
          <button
            onClick={onDismiss}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50"
          >
            <Minus className="w-3 h-3" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

function NewAssessmentModal({ onConfirm, onClose }: {
  onConfirm: (subject: string, topic: string, difficulty: string) => void
  onClose: () => void
}) {
  const [subject, setSubject] = useState('Mathematics')
  const [topic, setTopic] = useState(IGCSE_TOPICS['Mathematics'][0])
  const [difficulty, setDifficulty] = useState('Balanced')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      onKeyDown={e => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="New Assessment"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-stone-800">New Assessment</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1 block">Subject</label>
            <select
              value={subject}
              onChange={e => { setSubject(e.target.value); setTopic(IGCSE_TOPICS[e.target.value][0]) }}
              className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5"
            >
              {IGCSE_SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1 block">Topic</label>
            <select
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5"
            >
              {(IGCSE_TOPICS[subject] ?? []).map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1 block">Difficulty</label>
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value)}
              className="w-full text-sm border border-stone-300 rounded-lg px-2 py-1.5"
            >
              {DIFFICULTY_LEVELS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200">Cancel</button>
          <button
            onClick={() => onConfirm(subject, topic, difficulty)}
            className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteAccountModal({ onConfirm, onClose, isDeleting }: {
  onConfirm: () => void
  onClose: () => void
  isDeleting: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={!isDeleting ? onClose : undefined}
      onKeyDown={e => !isDeleting && e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Delete Account"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <Trash2 className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-stone-800">Delete Account</h2>
            <p className="text-xs text-stone-500 mt-1">
              This permanently deletes your account and all data — assessments, questions, folders, and resources. This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-60 flex items-center gap-1.5"
          >
            {isDeleting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            {isDeleting ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<'main' | 'library'>('main')
  const [config, setConfig] = useState<GenerationConfig>(DEFAULT_CONFIG)
  const [syllabusContext, setSyllabusContext] = useState('')
  const [studentMode, setStudentMode] = useState(false)
  const [activeTab, setActiveTab] = useState<'questions' | 'answerKey' | 'markScheme'>('questions')
  const [isEditing, setIsEditing] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | undefined>(undefined)
  const [showNewAssessmentModal, setShowNewAssessmentModal] = useState(false)
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { notifications, notify, dismiss } = useNotifications()
  const { provider, setProvider, apiKeys, setApiKey, currentApiKey, customModel, setCustomModel, defaultModel } = useApiSettings()
  const library = useAssessments(user, notify)
  const resources = useResources(user, notify)
  const generation = useGeneration(notify, provider, currentApiKey || undefined, resources.updateGeminiUri)

  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u)
      if (u) {
        library.loadAll()
        resources.loadResources(config.subject)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) resources.loadResources(config.subject)
  }, [config.subject, user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user && view === 'library') library.loadAll(selectedFolderId ?? undefined)
  }, [view, selectedFolderId, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback(() => {
    if (!currentApiKey) {
      notify('No API key set. Open API Settings and add your key to get started.', 'error')
      setApiSettingsOpen(true)
      return
    }
    setView('main')
    const effectiveModel = customModel.trim() || config.model
    generation.generate({ ...config, provider, model: effectiveModel, syllabusContext }, resources.knowledgeBase, resources.getBase64)
  }, [config, provider, customModel, syllabusContext, currentApiKey, resources.knowledgeBase, resources.getBase64, generation, notify])

  // Smart save: update if already in Firestore, else create new
  const handleSave = useCallback(async () => {
    const assessment = generation.generatedAssessment
    if (!assessment) return
    const alreadySaved = library.assessments.some(a => a.id === assessment.id)
    if (alreadySaved) {
      await library.updateAssessment(assessment.id, {
        questions: assessment.questions,
        topic: assessment.topic,
        subject: assessment.subject,
        difficulty: assessment.difficulty,
      })
      notify('Assessment updated', 'success')
    } else {
      const savedId = await library.saveAssessment(assessment)
      if (savedId) generation.setGeneratedAssessment({ ...assessment, id: savedId })
    }
  }, [generation, library, notify])

  const handleCreateBlankAssessment = useCallback((subject: string, topic: string, difficulty: string) => {
    const assessment: Assessment = {
      id: crypto.randomUUID(),
      subject,
      topic,
      difficulty,
      questions: [],
      userId: '',
      createdAt: Timestamp.now(),
    }
    generation.setGeneratedAssessment(assessment)
    setView('main')
    setShowNewAssessmentModal(false)
  }, [generation])

  const handleRemoveQuestion = useCallback((questionId: string) => {
    const assessment = generation.generatedAssessment
    if (!assessment) return
    generation.setGeneratedAssessment({
      ...assessment,
      questions: assessment.questions.filter(q => q.id !== questionId),
    })
  }, [generation])

  const handleMoveQuestion = useCallback((questionId: string, direction: 'up' | 'down') => {
    const assessment = generation.generatedAssessment
    if (!assessment) return
    const idx = assessment.questions.findIndex(q => q.id === questionId)
    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || newIdx < 0 || newIdx >= assessment.questions.length) return
    const questions = [...assessment.questions]
    ;[questions[idx], questions[newIdx]] = [questions[newIdx], questions[idx]]
    generation.setGeneratedAssessment({ ...assessment, questions })
  }, [generation])

  const handleAddQuestionsToCurrentAssessment = useCallback((questions: QuestionItem[]) => {
    const assessment = generation.generatedAssessment
    if (!assessment) return
    generation.setGeneratedAssessment({
      ...assessment,
      questions: [...assessment.questions, ...questions],
    })
  }, [generation])

  const handleCreateAssessmentFromQuestions = useCallback((questions: Question[]) => {
    const assessment: Assessment = {
      id: crypto.randomUUID(),
      subject: questions[0]?.subject ?? 'Mixed',
      topic: 'Custom Selection',
      difficulty: questions[0]?.difficulty ?? 'Mixed',
      questions,
      userId: '',
      createdAt: Timestamp.now(),
    }
    generation.setGeneratedAssessment(assessment)
    setView('main')
  }, [generation])

  const handleAddQuestionsToAssessment = useCallback(async (assessmentId: string, newQuestions: Question[]) => {
    const target = library.assessments.find(a => a.id === assessmentId)
    if (!target) return
    await library.updateAssessment(assessmentId, { questions: [...target.questions, ...newQuestions] })
  }, [library])

  const handleUpdateQuestion = useCallback((questionId: string, updates: Partial<QuestionItem>) => {
    const assessment = generation.generatedAssessment
    if (!assessment) return
    generation.setGeneratedAssessment({
      ...assessment,
      questions: assessment.questions.map(q => q.id === questionId ? { ...q, ...updates } : q),
    })
  }, [generation])

  const handleDeleteAccount = useCallback(async () => {
    setIsDeleting(true)
    try {
      await deleteUserData()
      // Auth state change fires automatically after account deletion
    } catch (e) {
      notify('Failed to delete account. You may need to re-login first.', 'error')
      setIsDeleting(false)
      setShowDeleteModal(false)
    }
  }, [notify])

  const handleCopy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text)
    notify(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'success' : 'error')
  }, [notify])

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-stone-800 mb-2">IGCSE Tools</h1>
          <p className="text-stone-500 mb-6">Cambridge IGCSE Assessment Designer</p>
          <button
            onClick={signInWithGoogle}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium flex items-center gap-2 mx-auto"
          >
            <LogIn className="w-4 h-4" /> Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar
        config={config}
        onConfigChange={patch => setConfig(c => ({
          ...c,
          ...patch,
          topic: patch.subject ? (IGCSE_TOPICS[patch.subject]?.[0] ?? c.topic) : (patch.topic ?? c.topic),
        }))}
        onGenerate={handleGenerate}
        isGenerating={generation.isGenerating}
        isAuditing={generation.isAuditing}
        retryCount={generation.retryCount}
        lastRunCostIDR={generation.lastRunCostIDR}
        resources={resources.resources}
        knowledgeBase={resources.knowledgeBase}
        onUploadResource={(file, subject, resourceType) => {
          const geminiKey = apiKeys['gemini']
          const isPdf = (resourceType === 'syllabus' || resourceType === 'past_paper')
          if (isPdf && !geminiKey) {
            notify('A Gemini API key is required to extract and cache PDF content. Add your free key in API Settings → Google Gemini.', 'error')
          }
          resources.uploadResource(file, subject, resourceType).then(resource => {
            if (resource && resourceType === 'syllabus' && geminiKey) {
              resources.processSyllabus(resource, geminiKey)
            }
            if (resource && resourceType === 'past_paper' && geminiKey) {
              resources.processPastPaper(resource, geminiKey)
            }
          })
        }}
        onAddToKB={(resource) => {
          resources.addToKnowledgeBase(resource)
          const geminiKey = apiKeys['gemini']
          const isPdf = (resource.resourceType === 'past_paper' || resource.resourceType === 'syllabus')
          if (isPdf && !geminiKey) {
            notify('A Gemini API key is required to extract PDF content for use as a reference. Add your free key in API Settings → Google Gemini.', 'error')
          }
          if (resource.resourceType === 'past_paper' && geminiKey) {
            resources.processPastPaper(resource, geminiKey)
          }
          if (resource.resourceType === 'syllabus' && geminiKey) {
            resources.processSyllabus(resource, geminiKey)
          }
        }}
        onRemoveFromKB={resources.removeFromKnowledgeBase}
        onDeleteResource={resources.deleteResource}
        onUpdateResourceType={resources.updateResourceType}
        onToggleShared={resources.toggleShared}
        currentUserId={user?.uid}
        uploading={resources.uploading}
        processingIds={resources.processingIds}
        studentMode={studentMode}
        onStudentModeToggle={() => setStudentMode(s => !s)}
        syllabusContext={syllabusContext}
        onSyllabusContextChange={setSyllabusContext}
        provider={provider}
        onProviderChange={p => {
          setProvider(p)
          setConfig(c => ({ ...c, provider: p, model: DEFAULT_MODELS[p] }))
          if (p !== 'gemini') {
            notify('Quality audit is only available with Gemini. Generated questions will not be audited for Cambridge IGCSE standards.', 'info')
          }
        }}
        apiKeys={apiKeys}
        onApiKeyChange={setApiKey}
        customModel={customModel}
        onCustomModelChange={setCustomModel}
        apiSettingsOpen={apiSettingsOpen}
        onApiSettingsOpenChange={setApiSettingsOpen}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top nav */}
        <header className="border-b border-stone-200 px-4 py-2 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            IGCSE Tools
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewAssessmentModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium bg-stone-100 text-stone-600 hover:bg-stone-200"
              title="Create blank assessment"
            >
              <FilePlus className="w-3.5 h-3.5" /> New
            </button>
            <button
              onClick={() => setView(v => v === 'library' ? 'main' : 'library')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium ${view === 'library' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              <LibraryIcon className="w-3.5 h-3.5" />
              Library
            </button>
            <span className="text-xs text-stone-500">{user.displayName}</span>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="p-1.5 text-stone-300 hover:text-red-500 transition-colors"
              title="Delete account"
              aria-label="Delete account"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={logout}
              className="p-1.5 text-stone-400 hover:text-stone-600"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Error banner */}
        {generation.error && (
          <ErrorBanner
            error={generation.error}
            onDismiss={() => generation.setError(null)}
            onRetry={() => { generation.setError(null); handleGenerate() }}
            onOpenApiSettings={() => { setApiSettingsOpen(true) }}
          />
        )}

        {/* Main content */}
        {view === 'library' ? (
          <LibraryView
            assessments={library.assessments}
            questions={library.questions}
            folders={library.folders}
            loading={library.loading}
            onSelect={a => { generation.setGeneratedAssessment(a); setView('main') }}
            onDeleteAssessment={library.deleteAssessment}
            onMoveAssessment={library.moveAssessment}
            onRenameAssessment={(id, topic) => library.updateAssessment(id, { topic })}
            onDeleteQuestion={library.deleteQuestion}
            onMoveQuestion={library.moveQuestion}
            onCreateFolder={library.createFolder}
            onDeleteFolder={library.deleteFolder}
            onRenameFolder={library.renameFolder}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            onCreateAssessmentFromQuestions={handleCreateAssessmentFromQuestions}
            onAddQuestionsToAssessment={handleAddQuestionsToAssessment}
            onUpdateQuestion={library.updateQuestion}
            currentUserId={user.uid}
            currentUserName={user.displayName ?? user.email ?? 'Unknown'}
            onTogglePublicAssessment={(id, isPublic) => library.togglePublicAssessment(id, isPublic, user.displayName ?? user.email ?? 'Unknown')}
            onTogglePublicQuestion={(id, isPublic) => library.togglePublicQuestion(id, isPublic, user.displayName ?? user.email ?? 'Unknown')}
          />
        ) : (
          <AssessmentView
            assessment={generation.generatedAssessment}
            analysisText={generation.analysisText}
            isEditing={isEditing}
            studentMode={studentMode}
            onEdit={() => setIsEditing(true)}
            onCancelEdit={() => setIsEditing(false)}
            onSaveToLibrary={handleSave}
            onSave={handleSave}
            onStudentFeedback={(answers) => generation.getStudentFeedback(answers, config.model)}
            onCopy={handleCopy}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onRemoveQuestion={handleRemoveQuestion}
            onMoveQuestion={handleMoveQuestion}
            bankQuestions={library.questions}
            onAddQuestions={handleAddQuestionsToCurrentAssessment}
            onUpdateQuestion={handleUpdateQuestion}
          />
        )}

        {/* Footer — fixed at bottom, always visible */}
        <footer className="shrink-0 border-t border-stone-200 bg-stone-50/80 px-4 py-2 flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="font-medium text-stone-500">IGCSE Tools</span>
            <span className="hidden sm:inline text-stone-300">·</span>
            <span className="hidden sm:inline">Cambridge Assessment Designer</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-violet-400" />
              AI-Powered
            </span>
            <span className="text-stone-300">·</span>
            <span>© {new Date().getFullYear()} Eduversal</span>
          </div>
        </footer>
      </div>

      <Notifications notifications={notifications} onDismiss={dismiss} />

      {showNewAssessmentModal && (
        <NewAssessmentModal
          onConfirm={handleCreateBlankAssessment}
          onClose={() => setShowNewAssessmentModal(false)}
        />
      )}

      {showDeleteModal && (
        <DeleteAccountModal
          onConfirm={handleDeleteAccount}
          onClose={() => setShowDeleteModal(false)}
          isDeleting={isDeleting}
        />
      )}
    </div>
  )
}
