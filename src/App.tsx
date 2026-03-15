import React, { useState, useEffect, useCallback } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { BookOpen, LogIn, LogOut, Library as LibraryIcon } from 'lucide-react'
import { auth, signInWithGoogle, logout } from './lib/firebase'
import { IGCSE_TOPICS } from './lib/gemini'
import { Timestamp } from 'firebase/firestore'
import type { GenerationConfig, Assessment, Question } from './lib/types'
import { useNotifications } from './hooks/useNotifications'
import { useAssessments } from './hooks/useAssessments'
import { useGeneration } from './hooks/useGeneration'
import { useResources } from './hooks/useResources'
import { Sidebar } from './components/Sidebar'
import { AssessmentView } from './components/AssessmentView'
import { Library as LibraryView } from './components/Library'
import { Notifications } from './components/Notifications'
import { copyToClipboard } from './lib/clipboard'

const DEFAULT_CONFIG: GenerationConfig = {
  subject: 'Mathematics',
  topic: 'Mixed Topics',
  difficulty: 'Balanced',
  count: 10,
  type: 'Mixed',
  calculator: true,
  model: 'gemini-3-flash-preview',
  syllabusContext: '',
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

  const { notifications, notify, dismiss } = useNotifications()
  const library = useAssessments(user, notify)
  const generation = useGeneration(notify)
  const resources = useResources(user, notify)

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
    generation.generate({ ...config, syllabusContext }, resources.knowledgeBase, resources.getBase64)
  }, [config, syllabusContext, resources.knowledgeBase, resources.getBase64, generation])

  const handleSave = useCallback(async () => {
    if (!generation.generatedAssessment) return
    await library.saveAssessment(generation.generatedAssessment)
  }, [generation.generatedAssessment, library])

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
        resources={resources.resources}
        knowledgeBase={resources.knowledgeBase}
        onUploadResource={resources.uploadResource}
        onAddToKB={resources.addToKnowledgeBase}
        onRemoveFromKB={resources.removeFromKnowledgeBase}
        onDeleteResource={resources.deleteResource}
        studentMode={studentMode}
        onStudentModeToggle={() => setStudentMode(s => !s)}
        syllabusContext={syllabusContext}
        onSyllabusContextChange={setSyllabusContext}
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
              onClick={() => setView(v => v === 'library' ? 'main' : 'library')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium ${view === 'library' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              <LibraryIcon className="w-3.5 h-3.5" />
              Library
            </button>
            <span className="text-xs text-stone-500">{user.displayName}</span>
            <button onClick={logout} className="p-1.5 text-stone-400 hover:text-stone-600" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

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
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            onCreateAssessmentFromQuestions={handleCreateAssessmentFromQuestions}
            onAddQuestionsToAssessment={handleAddQuestionsToAssessment}
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
          />
        )}
      </div>

      <Notifications notifications={notifications} onDismiss={dismiss} />
    </div>
  )
}
