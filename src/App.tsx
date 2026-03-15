import React, { useState, useRef, useEffect } from "react";
import { 
  BookOpen, 
  Settings, 
  FileText, 
  CheckSquare, 
  Calculator, 
  Image as ImageIcon, 
  Loader2, 
  Download, 
  Plus, 
  Trash2,
  ChevronRight,
  BrainCircuit,
  Library,
  Folder as FolderIcon,
  X,
  Edit3,
  Save,
  Bold,
  Italic,
  List,
  Heading1,
  Heading2,
  Type,
  GraduationCap,
  ShieldCheck,
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  Database,
  Check,
  FolderInput,
  Pencil,
  HelpCircle,
  RefreshCw,
  AlertCircle,
  Info
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { 
  generateTest, 
  auditTest,
  getStudentFeedback,
  analyzeFile, 
  IGCSE_SUBJECTS,
  IGCSE_TOPICS, 
  DIFFICULTY_LEVELS, 
  type TestResponse 
} from "./lib/gemini";
import { 
  auth, 
  signInWithGoogle, 
  logout, 
  saveAssessment, 
  getSavedAssessments, 
  deleteAssessment,
  moveAssessment,
  updateAssessment,
  saveQuestion,
  getQuestions,
  deleteQuestion,
  moveQuestion,
  saveResource,
  getResources,
  deleteResource,
  createFolder,
  getFolders,
  deleteFolder,
  type SavedAssessment,
  type Question,
  type Resource,
  type Folder
} from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeMarkdown(content: string): string {
  return content.replace(/\\n/g, '\n');
}

function getPreviewContent(content: string): string {
  return normalizeMarkdown(content).replace(/```svg[\s\S]*?```/g, '*(diagram)*');
}

export default function App() {
  const [subject, setSubject] = useState("Mathematics");
  const [topic, setTopic] = useState("Mixed Topics");
  const [difficulty, setDifficulty] = useState("Balanced");
  const [count, setCount] = useState(10);
  const [type, setType] = useState("Mixed");
  const [model, setModel] = useState("gemini-3-flash-preview");
  const [calculator, setCalculator] = useState(true);
  const [studentMode, setStudentMode] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syllabusContext, setSyllabusContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBank, setLoadingBank] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [savedAssessments, setSavedAssessments] = useState<SavedAssessment[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<Question[]>([]);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [saveToFolderId, setSaveToFolderId] = useState<string>("");
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [savedResources, setSavedResources] = useState<Resource[]>([]);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [showBank, setShowBank] = useState(false);
  const [bankView, setBankView] = useState<"assessments" | "questions">("assessments");
  const [test, setTest] = useState<TestResponse | null>(null);
  const [activeTab, setActiveTab] = useState<"questions" | "answerKey" | "markScheme">("questions");
  const [analysis, setAnalysis] = useState<{ analysis: string; similarQuestions: string; answerKey: string; markScheme: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string, data: string, type: string } | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<Record<string, { name: string, data: string, type: string }[]>>({
    "Mathematics": [],
    "Biology": [],
    "Physics": [],
    "Chemistry": []
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const syllabusInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setSavedAssessments([]);
        setSavedQuestions([]);
        setFolders([]);
        setSavedResources([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      if (selectedFolderId !== undefined) {
        loadSavedAssessments(selectedFolderId || undefined);
      }
      loadFolders();
    }
  }, [user, selectedFolderId]);

  useEffect(() => {
    if (user) {
      loadResources(subject);
    }
  }, [subject, user]);

  const loadResources = async (subj: string) => {
    try {
      const resources = await getResources(subj);
      setSavedResources(resources);
    } catch (error) {
      console.error("Failed to load resources:", error);
    }
  };

  const loadFolders = async () => {
    try {
      const data = await getFolders();
      setFolders(data);
    } catch (error) {
      console.error("Failed to load folders:", error);
    }
  };

  const loadSavedAssessments = async (folderId?: string) => {
    setLoadingBank(true);
    setSavedAssessments([]); // Clear stale data immediately
    setSavedQuestions([]);
    try {
      const assessments = await getSavedAssessments(folderId);
      const questions = await getQuestions(folderId);
      setSavedAssessments(assessments);
      setSavedQuestions(questions);
    } catch (error) {
      console.error("Failed to load assessments/questions:", error);
    } finally {
      setLoadingBank(false);
    }
  };

  const handleSaveToBank = async () => {
    if ((!test && !analysis)) return;
    
    if (!user) {
      try {
        await signInWithGoogle();
        return; 
      } catch (error) {
        console.error("Login failed:", error);
        return;
      }
    }

    setShowFolderModal(true);
  };

  const confirmSaveToBank = async () => {
    setLoading(true);
    setShowFolderModal(false);
    try {
      const questionsToSave = test ? test.questions : analysis?.similarQuestions || "";
      const answerKeyToSave = test ? test.answerKey : analysis?.answerKey || "";
      const markSchemeToSave = test ? test.markScheme : analysis?.markScheme || "";

      // Save the assessment as a whole (legacy/batch)
      const assessmentResult = await saveAssessment({
        subject,
        topic: test ? topic : "Analyzed Content",
        difficulty: test ? difficulty : "N/A",
        questions: questionsToSave,
        answerKey: answerKeyToSave,
        markScheme: markSchemeToSave,
        folderId: saveToFolderId || null
      });

      // Parse and save individual questions
      const parsedQuestions = parseAssessmentIntoQuestions(questionsToSave, answerKeyToSave, markSchemeToSave);
      
      await Promise.all(parsedQuestions.map(q => 
        saveQuestion({
          subject,
          topic: test ? topic : "Analyzed Content",
          difficulty: test ? difficulty : "N/A",
          content: q.content,
          answer: q.answer,
          markScheme: q.markScheme,
          assessmentId: assessmentResult.id,
          folderId: saveToFolderId || null
        })
      ));

      setCurrentSavedId(assessmentResult.id);
      showNotification(`Assessment and ${parsedQuestions.length} questions saved to bank!`, 'success');
      loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to save to bank:", error);
      showNotification("Failed to save to bank.", 'error');
    } finally {
      setLoading(false);
    }
  };

  const parseAssessmentIntoQuestions = (questionsMd: string, answersMd: string, markSchemeMd: string) => {
    // More robust regex to handle various markdown formats without splitting on internal numbering
    // We look for patterns that clearly indicate a NEW question
    const questionPattern = /(?:\n|^)(?:\s*###?\s+Question\s+\d+|\s*\*\*Question\s+\d+[:\*]\*\*|\s*\*\*\d+\.|\s*Question\s+\d+[:\*]|\s*###?\s+\d+\.)/gi;
    const answerPattern = /(?:\n|^)(?:\s*###?\s+Question\s+\d+|\s*\*\*Question\s+\d+[:\*]\*\*|\s*\*\*\d+\.|\s*Question\s+\d+[:\*]|\s*Answer\s+\d+[:\*]|\s*###?\s+Answer\s+\d+)/gi;
    const markSchemePattern = /(?:\n|^)(?:\s*###?\s+Question\s+\d+|\s*\*\*Question\s+\d+[:\*]\*\*|\s*\*\*\d+\.|\s*Question\s+\d+[:\*]|\s*Mark\s+Scheme\s+\d+[:\*]|\s*###?\s+Mark\s+Scheme\s+\d+)/gi;

    const splitText = (text: string, pattern: RegExp) => {
      const matches = [...text.matchAll(pattern)];
      if (matches.length === 0) return [];
      
      const results = [];
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index!;
        const nextMatch = matches[i + 1];
        const end = nextMatch ? nextMatch.index! : text.length;
        results.push(text.substring(start, end).trim());
      }
      return results;
    };

    let questionContents = splitText(questionsMd, questionPattern);
    let answerContents = splitText(answersMd, answerPattern);
    let markSchemeContents = splitText(markSchemeMd, markSchemePattern);

    // Fallback 1: If no patterns found, try to split by double newlines if the text is long enough
    if (questionContents.length === 0 && questionsMd.length > 50) {
       const parts = questionsMd.split(/\n\s*\n/).filter(p => p.trim().length > 30);
       if (parts.length > 0) {
         questionContents = parts;
       }
    }

    // Fallback 2: If still nothing, just take the whole thing as one question if it's not empty
    if (questionContents.length === 0 && questionsMd.trim().length > 0) {
      questionContents = [questionsMd.trim()];
    }

    const questions = [];
    for (let i = 0; i < questionContents.length; i++) {
      questions.push({
        content: questionContents[i],
        answer: answerContents[i] || "N/A",
        markScheme: markSchemeContents[i] || "N/A"
      });
    }
    return questions;
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName);
      setNewFolderName("");
      loadFolders();
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    // Removing blocking confirm()
    try {
      await deleteFolder(id);
      loadFolders();
      if (selectedFolderId === id) setSelectedFolderId(null);
      showNotification("Folder deleted successfully.", 'info');
    } catch (error) {
      console.error("Failed to delete folder:", error);
      showNotification("Failed to delete folder.", 'error');
    }
  };

  const handleDeleteSaved = async (id: string) => {
    // Removing blocking confirm() as per iframe guidelines
    setLoading(true);
    try {
      await deleteAssessment(id);
      await loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to delete assessment:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    // Removing blocking confirm() as per iframe guidelines
    setLoading(true);
    try {
      await deleteQuestion(id);
      await loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to delete question:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveAssessment = async (assessmentId: string, folderId: string | null) => {
    try {
      await moveAssessment(assessmentId, folderId);
      loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to move assessment:", error);
    }
  };

  const handleMoveQuestion = async (questionId: string, folderId: string | null) => {
    try {
      await moveQuestion(questionId, folderId);
      loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to move question:", error);
    }
  };

  const handleRenameAssessment = async (id: string) => {
    if (!editNameValue.trim()) return;
    try {
      await updateAssessment(id, { topic: editNameValue });
      setEditingAssessmentId(null);
      loadSavedAssessments(selectedFolderId || undefined);
    } catch (error) {
      console.error("Failed to rename assessment:", error);
    }
  };

  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };


  const getQuestionCount = (markdown: string) => {
    if (!markdown) return 0;
    // Count patterns like "1.", "2.", or "**Question 1:**", "### Question 1"
    const matches = markdown.match(/^(?:\d+\.|\*\*Question \d+[:\*]|###? Question \d+)/gm);
    return matches ? matches.length : 0;
  };

  const handleLoadSaved = (assessment: SavedAssessment) => {
    setSubject(assessment.subject);
    setTopic(assessment.topic);
    setDifficulty(assessment.difficulty);
    setTest({
      questions: assessment.questions,
      answerKey: assessment.answerKey,
      markScheme: assessment.markScheme
    });
    setCurrentSavedId(assessment.id || null);
    setShowBank(false);
    setActiveTab("questions");
  };

  const handleLoadQuestion = (question: Question) => {
    setSubject(question.subject);
    setTopic(question.topic);
    setDifficulty(question.difficulty);
    setTest({
      questions: question.content,
      answerKey: question.answer,
      markScheme: question.markScheme
    });
    setCurrentSavedId(question.id || null);
    setShowBank(false);
    setActiveTab("questions");
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById("assessment-content");
    if (!element) return;

    setLoading(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          const style = clonedDoc.createElement('style');
          style.innerHTML = `
            #assessment-content * {
              color-scheme: light !important;
              -webkit-print-color-adjust: exact;
            }
            /* Override oklch colors with RGB for html2canvas compatibility */
            #assessment-content {
              color: #1c1917 !important;
              background-color: #ffffff !important;
            }
            .text-emerald-600 { color: #059669 !important; }
            .text-emerald-700 { color: #047857 !important; }
            .text-emerald-800 { color: #065f46 !important; }
            .text-emerald-900 { color: #064e3b !important; }
            .text-emerald-950 { color: #022c22 !important; }
            .bg-emerald-50 { background-color: #ecfdf5 !important; }
            .bg-emerald-100 { background-color: #d1fae5 !important; }
            .bg-emerald-600 { background-color: #059669 !important; }
            .border-emerald-100 { border-color: #d1fae5 !important; }
            .border-emerald-200 { border-color: #a7f3d0 !important; }
            .border-stone-200 { border-color: #e7e5e4 !important; }
            .bg-stone-50 { background-color: #fafaf9 !important; }
            .bg-stone-100 { background-color: #f5f5f4 !important; }
            .bg-stone-200 { background-color: #e7e5e4 !important; }
            .text-stone-400 { color: #a8a29e !important; }
            .text-stone-500 { color: #78716c !important; }
            .text-stone-600 { color: #57534e !important; }
            .text-stone-700 { color: #44403c !important; }
            .text-stone-800 { color: #292524 !important; }
            .text-stone-900 { color: #1c1917 !important; }
            .bg-white { background-color: #ffffff !important; }
            .border-stone-100 { border-color: #f5f5f4 !important; }
            
            /* Additional common Tailwind v4 oklch fallbacks */
            [class*="bg-stone-"] { background-color: #f5f5f4 !important; }
            [class*="text-stone-"] { color: #44403c !important; }
            [class*="border-stone-"] { border-color: #e7e5e4 !important; }
            [class*="bg-emerald-"] { background-color: #ecfdf5 !important; }
            [class*="text-emerald-"] { color: #059669 !important; }
            [class*="border-emerald-"] { border-color: #d1fae5 !important; }
          `;
          clonedDoc.head.appendChild(style);

          // Force standard colors on all elements in the cloned document
          // to prevent html2canvas from trying to parse oklch
          const allElements = clonedDoc.getElementById("assessment-content")?.querySelectorAll('*');
          if (allElements) {
            allElements.forEach((el: any) => {
              if (el instanceof HTMLElement) {
                // If the element has oklch in its inline style, strip it
                if (el.style.color?.includes('oklch')) el.style.color = 'inherit';
                if (el.style.backgroundColor?.includes('oklch')) el.style.backgroundColor = 'transparent';
                if (el.style.borderColor?.includes('oklch')) el.style.borderColor = 'currentColor';
              }
            });
          }
        }
      });
      
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height]
      });
      
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`IGCSE_${subject}_${topic.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      showNotification("Failed to generate PDF. You can also use Ctrl+P to print the page.", 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateEstimatedCost = () => {
    const USD_TO_IDR = 15800;
    const isPro = model === "gemini-3.1-pro-preview";
    
    // Approximate tokens
    const inputTokens = 1500 + (syllabusContext.length / 4);
    const outputTokensPerQuestion = 600;
    const totalOutputTokens = count * outputTokensPerQuestion;
    
    // Pricing per 1M tokens
    const pricing = isPro 
      ? { input: 1.25, output: 5.00 } 
      : { input: 0.10, output: 0.40 };
      
    const costUSD = ((inputTokens / 1000000) * pricing.input) + ((totalOutputTokens / 1000000) * pricing.output);
    
    // Add Audit cost (Audit uses Pro by default in the code)
    const auditInputTokens = totalOutputTokens + 500;
    const auditOutputTokens = totalOutputTokens;
    const auditCostUSD = ((auditInputTokens / 1000000) * 1.25) + ((auditOutputTokens / 1000000) * 5.00);
    
    const totalCostIDR = (costUSD + auditCostUSD) * USD_TO_IDR;
    
    return totalCostIDR.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleGenerate = async () => {
    if (pendingFile) {
      handleAnalyzePending();
      return;
    }
    setLoading(true);
    setAnalysis(null);
    setCurrentSavedId(null);
    try {
      const localRefs = knowledgeBase[subject].map(kb => ({ data: kb.data, mimeType: kb.type }));
      const savedRefs = savedResources
        .filter(r => selectedResourceIds.includes(r.id!))
        .map(r => ({ data: r.data, mimeType: r.mimeType }));
      
      const references = [...localRefs, ...savedRefs];
      
      const initialResult = await generateTest({ subject, topic, difficulty, count, type, calculator, model, syllabusContext, references });
      
      // Step 2: Audit and Refine (Multi-Agent Workflow)
      const auditedResult = await auditTest(subject, initialResult, model === "gemini-3-flash-preview" ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview");
      
      setTest(auditedResult);
      setActiveTab("questions");
    } catch (error: any) {
      console.error("Failed to generate test:", error);
      let message = "Failed to generate test. Please try again.";
      if (error.message?.includes("quota") || error.message?.includes("429")) {
        message = "Gemini API quota exceeded. If you are on the Free Tier, please wait a minute or check your limits at aistudio.google.com.";
      }
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubjectChange = (newSubject: string) => {
    setSubject(newSubject);
    setTopic("Mixed Topics");
  };

  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [saveUploadedFiles, setSaveUploadedFiles] = useState(true);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setPendingFile({ name: file.name, data: base64, type: file.type });
      setTest(null);
      setAnalysis(null);

      // Save to resources if checked and user is logged in
      if (user && saveUploadedFiles) {
        try {
          await saveResource({
            name: file.name,
            subject: subject,
            data: base64,
            mimeType: file.type
          });
          loadResources(subject);
        } catch (error) {
          console.error("Failed to auto-save uploaded file:", error);
        }
      }
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = "";
  };

  const handleAnalyzePending = async () => {
    if (!pendingFile) return;
    setLoading(true);
    try {
      const localRefs = knowledgeBase[subject].map(kb => ({ data: kb.data, mimeType: kb.type }));
      const savedRefs = savedResources
        .filter(r => selectedResourceIds.includes(r.id!))
        .map(r => ({ data: r.data, mimeType: r.mimeType }));
      
      const references = [...localRefs, ...savedRefs];
      
      const result = await analyzeFile(pendingFile.data, pendingFile.type, subject, count, model, references);
      setAnalysis(result);
      setPendingFile(null);
    } catch (error: any) {
      console.error("Failed to analyze file:", error);
      let message = "Failed to analyze file. Please try again.";
      if (error.message?.includes("quota") || error.message?.includes("429")) {
        message = "Gemini API quota exceeded. If you are on the Free Tier, please wait a minute or check your limits at aistudio.google.com.";
      }
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const [copied, setCopied] = useState(false);

  const handleSyllabusUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      
      // Add to local knowledge base
      setKnowledgeBase(prev => ({
        ...prev,
        [subject]: [...prev[subject], { name: file.name, data: base64, type: file.type }]
      }));

      // If user is logged in, save to permanent resources
      if (user) {
        try {
          await saveResource({
            name: file.name,
            subject: subject,
            data: base64,
            mimeType: file.type
          });
          loadResources(subject);
        } catch (error) {
          console.error("Failed to save resource permanently:", error);
        }
      }
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = "";
  };

  const handleDeleteResource = async (id: string) => {
    // Removing blocking confirm()
    try {
      await deleteResource(id);
      loadResources(subject);
      setSelectedResourceIds(prev => prev.filter(rid => rid !== id));
      showNotification("Resource deleted.", 'info');
    } catch (error) {
      console.error("Failed to delete resource:", error);
      showNotification("Failed to delete resource.", 'error');
    }
  };

  const toggleResource = (id: string) => {
    setSelectedResourceIds(prev => 
      prev.includes(id) ? prev.filter(rid => rid !== id) : [...prev, id]
    );
  };

  const removeKnowledge = (index: number) => {
    setKnowledgeBase(prev => ({
      ...prev,
      [subject]: prev[subject].filter((_, i) => i !== index)
    }));
  };

  const copyToClipboard = () => {
    const content = test ? test[activeTab] : analysis ? analysis.similarQuestions : "";
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGetFeedback = async () => {
    if (!test || !studentAnswers.trim()) return;
    
    setLoading(true);
    setFeedback(null);
    try {
      const result = await getStudentFeedback(subject, test, studentAnswers, model);
      setFeedback(result);
    } catch (error) {
      console.error("Failed to get feedback:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (test) {
      setTest({ ...test, [activeTab]: value });
    } else if (analysis) {
      setAnalysis({ ...analysis, similarQuestions: value });
    }
  };

  const lastFocusedRef = useRef<string | null>(null);

  const applyFormatting = (prefix: string, suffix: string = prefix) => {
    const targetId = lastFocusedRef.current || "editor-textarea";
    const textarea = document.getElementById(targetId) as HTMLTextAreaElement;
    
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    const beforeText = text.substring(0, start);
    const afterText = text.substring(end);

    const newText = beforeText + prefix + selectedText + suffix + afterText;
    
    if (targetId === "analysis-textarea" && analysis) {
      setAnalysis({ ...analysis, analysis: newText });
    } else if (test) {
      setTest({ ...test, [activeTab]: newText });
    } else if (analysis) {
      setAnalysis({ ...analysis, similarQuestions: newText });
    }

    // Reset focus and selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-stone-200 bg-white flex flex-col">
        <div className="p-6 border-bottom border-stone-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-emerald-600 p-1.5 rounded-lg">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-lg tracking-tight">IGCSE Designer</h1>
            </div>
            {user ? (
              <button 
                onClick={logout}
                className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                title="Login with Google"
              >
                <LogIn className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-stone-500">Cambridge Exam Assessment Tool</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section>
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              <Settings className="w-3 h-3" />
              Configuration
            </label>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Subject</label>
                <select 
                  value={subject}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  {IGCSE_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Topic</label>
                <select 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  {IGCSE_TOPICS[subject].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Difficulty</label>
                <div className="grid grid-cols-2 gap-2">
                  {DIFFICULTY_LEVELS.map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={cn(
                        "px-3 py-2 text-xs font-medium rounded-lg border transition-all",
                        difficulty === d 
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                          : "bg-white border-stone-200 text-stone-600 hover:border-stone-300"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Questions ({count})</label>
                <input 
                  type="range" 
                  min="1" 
                  max="20" 
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Question Type</label>
                <select 
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="Mixed">Mixed Types</option>
                  <option value="Multiple Choice">Multiple Choice</option>
                  <option value="Short Answer">Short Answer</option>
                  <option value="Structured">Structured (a, b, c)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">AI Model</label>
                <select 
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast, High Quota)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Smart, Low Quota)</option>
                </select>
                <p className="mt-1 text-[10px] text-stone-400">
                  Switch to Flash if you hit quota limits. Pro is better for complex math.
                </p>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-stone-400" />
                  <span className="text-sm font-medium text-stone-700">Calculator Allowed</span>
                </div>
                <button 
                  onClick={() => setCalculator(!calculator)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    calculator ? "bg-emerald-600" : "bg-stone-300"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    calculator ? "left-6" : "left-1"
                  )} />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Syllabus Context (Optional)</label>
                <textarea 
                  value={syllabusContext}
                  onChange={(e) => setSyllabusContext(e.target.value)}
                  placeholder="Paste learning objectives or syllabus URLs here..."
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 outline-none transition-all h-20 resize-none"
                />
              </div>

              <div className="flex items-center justify-between py-2 border-t border-stone-100 mt-2">
                <div className="flex items-center gap-2">
                  {studentMode ? (
                    <Eye className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-stone-400" />
                  )}
                  <span className="text-sm font-medium text-stone-700">Student Mode</span>
                </div>
                <button 
                  onClick={() => setStudentMode(!studentMode)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative flex items-center",
                    studentMode ? "bg-indigo-600" : "bg-stone-300"
                  )}
                >
                  <div className="absolute inset-0 flex items-center justify-between px-1">
                    <Eye className={cn("w-3 h-3 transition-all duration-300", studentMode ? "opacity-100 text-white" : "opacity-0")} />
                    <EyeOff className={cn("w-3 h-3 transition-all duration-300", !studentMode ? "opacity-100 text-stone-500" : "opacity-0")} />
                  </div>
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm z-10",
                    studentMode ? "left-6" : "left-1"
                  )} />
                </button>
              </div>
            </div>
          </section>

          <section className="pt-4 border-t border-stone-100">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              <Database className="w-3 h-3" />
              Question Bank
            </label>
            <button 
              onClick={() => setShowBank(!showBank)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border",
                showBank 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                  : "bg-white border-stone-200 text-stone-600 hover:border-stone-300"
              )}
            >
              <div className="flex items-center gap-2">
                <Library className="w-4 h-4" />
                <span className="text-sm font-medium">Browse Saved</span>
              </div>
              <span className="bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {savedAssessments.length}
              </span>
            </button>
          </section>

          <section className="pt-4 border-t border-stone-100">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              <ImageIcon className="w-3 h-3" />
              Past Paper Analysis
            </label>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-stone-500 hover:border-emerald-300 hover:text-emerald-600 transition-all group"
            >
              <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-medium">Upload Screenshot or PDF</span>
            </button>
            <div className="mt-2 px-1 flex items-center gap-2">
              <input 
                type="checkbox" 
                id="save-upload"
                checked={saveUploadedFiles}
                onChange={(e) => setSaveUploadedFiles(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
              />
              <label htmlFor="save-upload" className="text-[10px] font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Save to resources for future use
              </label>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept="image/*,.pdf"
            />

            {pendingFile && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tight">Pending File</span>
                  <button onClick={() => setPendingFile(null)} className="text-emerald-400 hover:text-emerald-600">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-xs text-emerald-900 truncate font-medium">{pendingFile.name}</div>
              </div>
            )}
          </section>

          <section className="pt-4 border-t border-stone-100">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              <Library className="w-3 h-3" />
              Knowledge Base ({subject})
            </label>
            <div className="space-y-2">
              {knowledgeBase[subject].map((kb, i) => (
                <div key={i} className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs">
                  <span className="truncate max-w-[180px] text-stone-600">{kb.name}</span>
                  <button 
                    onClick={() => removeKnowledge(i)}
                    className="text-stone-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button 
                onClick={() => syllabusInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-stone-200 rounded-lg text-stone-500 hover:bg-stone-50 transition-all"
              >
                <Plus className="w-3 h-3" />
                <span className="text-xs font-medium">Add Syllabus PDF</span>
              </button>
              <input 
                type="file" 
                ref={syllabusInputRef} 
                onChange={handleSyllabusUpload} 
                className="hidden" 
                accept=".pdf"
              />
            </div>
            <p className="mt-2 text-[10px] text-stone-400 italic">
              Documents added here will be used as reference for all generations in this subject.
            </p>
          </section>

          {user && savedResources.length > 0 && (
            <section className="pt-4 border-t border-stone-100">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                <Database className="w-3 h-3" />
                Saved Resources ({subject})
              </label>
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                {savedResources.map((res) => (
                  <div key={res.id} className="flex items-center gap-2 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-[10px]">
                    <input 
                      type="checkbox" 
                      checked={selectedResourceIds.includes(res.id!)}
                      onChange={() => toggleResource(res.id!)}
                      className="w-3 h-3 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="flex-1 truncate text-stone-600 font-medium">{res.name}</span>
                    <button 
                      onClick={() => handleDeleteResource(res.id!)}
                      className="text-stone-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="p-6 border-t border-stone-100 bg-stone-50/50">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Est. Cost</span>
            <span className="text-xs font-mono font-bold text-emerald-700">Rp {calculateEstimatedCost()}</span>
          </div>
          <button 
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl shadow-lg shadow-emerald-900/10 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
            {loading ? "Generating..." : pendingFile ? "Analyze & Generate" : "Generate Assessment"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-stone-200 bg-white flex items-center justify-between px-8 shrink-0">
          {!showBank ? (
            <>
              <div className="flex items-center gap-6">
                {user && (
                  <button 
                    onClick={() => setShowBank(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all group"
                  >
                    <Library className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    Library
                  </button>
                )}
                {(test || analysis) && (
                  <nav className="flex gap-1">
                    {(["questions", "answerKey", "markScheme"] as const).filter(tab => {
                      if (studentMode && tab !== 'questions') return false;
                      if (tab === 'answerKey') return !!(test?.answerKey || analysis?.answerKey);
                      if (tab === 'markScheme') return !!(test?.markScheme || analysis?.markScheme);
                      return true;
                    }).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          "px-4 py-1.5 text-sm font-medium rounded-lg transition-all capitalize",
                          activeTab === tab 
                            ? "bg-stone-100 text-stone-900" 
                            : "text-stone-500 hover:text-stone-800"
                        )}
                      >
                        {tab.replace(/([A-Z])/g, ' $1').trim()}
                      </button>
                    ))}
                  </nav>
                )}
              </div>

              <div className="flex items-center gap-3">
                {(test || analysis) && (
                  <>
                    <button 
                      onClick={() => setIsEditing(!isEditing)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        isEditing 
                          ? "bg-emerald-600 text-white shadow-sm" 
                          : "text-stone-500 hover:bg-stone-100"
                      )}
                    >
                      {isEditing ? <Save className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                      {isEditing ? "Finish Editing" : "Edit Content"}
                    </button>
                    {!currentSavedId && (
                      <button 
                        onClick={handleSaveToBank}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {user ? "Save to Bank" : "Login to Save"}
                      </button>
                    )}
                    {currentSavedId && (
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-lg">
                        <Check className="w-3.5 h-3.5" />
                        Saved to Bank
                      </div>
                    )}
                  </>
                )}
                {test && (
                  <button 
                    onClick={handleDownloadPDF}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-all shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </button>
                )}
                {copied && <span className="text-xs font-medium text-emerald-600 animate-in fade-in slide-in-from-right-2">Copied!</span>}
                <button 
                  onClick={copyToClipboard}
                  className="p-2 text-stone-400 hover:text-stone-600 transition-colors"
                  title="Copy to clipboard"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => { setTest(null); setAnalysis(null); }}
                  className="p-2 text-stone-400 hover:text-stone-600 transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Database className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="font-bold text-stone-800 tracking-tight">Library Explorer</span>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto">
            {showBank ? (
              <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-3xl font-black text-stone-900 tracking-tight">Question Bank</h2>
                    <p className="text-stone-500 font-medium">Organize and reuse your Cambridge assessments.</p>
                  </div>
                  <div className="flex items-center gap-4">

                    <div className="flex bg-stone-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setBankView("assessments")}
                        className={cn(
                          "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2",
                          bankView === "assessments" ? "bg-white text-emerald-600 shadow-sm" : "text-stone-500 hover:text-stone-700"
                        )}
                      >
                        Assessments
                        <span className="px-1.5 py-0.5 bg-stone-50 text-stone-400 rounded-md text-[9px] font-black">
                          {savedAssessments.length}
                        </span>
                      </button>
                      <button 
                        onClick={() => setBankView("questions")}
                        className={cn(
                          "px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2",
                          bankView === "questions" ? "bg-white text-emerald-600 shadow-sm" : "text-stone-500 hover:text-stone-700"
                        )}
                      >
                        Questions
                        <span className="px-1.5 py-0.5 bg-stone-50 text-stone-400 rounded-md text-[9px] font-black">
                          {savedQuestions.length}
                        </span>
                      </button>
                    </div>
                    <button 
                      onClick={() => setShowBank(false)}
                      className="w-10 h-10 flex items-center justify-center bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0">
                  {/* Folder Sidebar */}
                  <div className="w-full lg:w-72 flex flex-col gap-6">
                    <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <FolderIcon className="w-3 h-3" />
                        Collections
                      </h3>
                      <div className="space-y-1.5">
                        <button 
                          onClick={() => setSelectedFolderId(null)}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all group",
                            selectedFolderId === null 
                              ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/10" 
                              : "text-stone-600 hover:bg-stone-50"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Library className={cn("w-4 h-4", selectedFolderId === null ? "text-emerald-200" : "text-stone-400")} />
                            {bankView === "assessments" ? "All Assessments" : "All Questions"}
                          </div>
                        </button>
                        
                        {folders.map(folder => (
                          <div key={folder.id} className="group relative">
                            <button 
                              onClick={() => setSelectedFolderId(folder.id!)}
                              className={cn(
                                "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                                selectedFolderId === folder.id 
                                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20 translate-x-1" 
                                  : "text-stone-600 hover:bg-stone-100 hover:translate-x-1"
                              )}
                            >
                              <div className="flex items-center gap-3 truncate pr-6">
                                <FolderIcon className={cn("w-4 h-4 transition-transform group-hover:scale-110", selectedFolderId === folder.id ? "text-emerald-200" : "text-stone-400")} />
                                <span className="truncate">{folder.name}</span>
                              </div>
                            </button>
                            {folder.id !== "default" && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id!); }}
                                className={cn(
                                  "absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all duration-200",
                                  selectedFolderId === folder.id 
                                    ? "text-emerald-200 hover:text-white hover:bg-emerald-500" 
                                    : "opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 hover:bg-red-50"
                                )}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      <div className="mt-6 pt-6 border-t border-stone-100">
                        <div className="relative">
                          <input 
                            type="text" 
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Create new folder..."
                            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-4 pr-10 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                          />
                          <button 
                            onClick={handleCreateFolder}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50 transition-all shadow-sm"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Assessments Grid */}
                  <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                    {!user ? (
                      <div className="h-full flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12 text-center">
                        <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                          <LogIn className="w-10 h-10 text-stone-200" />
                        </div>
                        <h3 className="text-xl font-black text-stone-900 mb-2">Login Required</h3>
                        <p className="text-stone-500 max-w-xs mx-auto mb-8">Sign in with your Google account to access your personal assessment library.</p>
                        <button 
                          onClick={signInWithGoogle}
                          className="bg-stone-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-900/20 flex items-center gap-2"
                        >
                          <LogIn className="w-5 h-5" />
                          Login with Google
                        </button>
                      </div>
                    ) : loadingBank ? (
                      <div className="h-full flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12">
                        <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
                        <p className="text-stone-400 font-bold tracking-tight">Syncing your library...</p>
                      </div>
                    ) : selectedFolderId === undefined ? (
                      <div className="h-full flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12 text-center">
                        <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                          <FolderIcon className="w-10 h-10 text-stone-200" />
                        </div>
                        <h3 className="text-xl font-black text-stone-900 mb-2">Select a Collection</h3>
                        <p className="text-stone-500 max-w-xs mx-auto">Choose a folder or click "All Assessments" to browse your saved questions.</p>
                      </div>
                    ) : bankView === "assessments" ? (
                      savedAssessments.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12 text-center">
                          <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                            <Database className="w-10 h-10 text-stone-200" />
                          </div>
                          <h3 className="text-xl font-black text-stone-900 mb-2">Empty Collection</h3>
                          <p className="text-stone-500 max-w-xs mx-auto">No assessments found in this folder. Start by generating a new test or analyzing a past paper.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-12">
                          {savedAssessments.map((item) => (
                            <div 
                              key={item.id}
                              className="bg-white border border-stone-200 rounded-3xl p-6 hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-900/10 transition-all duration-300 group relative overflow-hidden flex flex-col"
                            >
                              {/* Decorative accent */}
                              <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-all duration-300" />
                              
                              <div className="flex items-start justify-between mb-6">
                                <div className="flex flex-wrap gap-2">
                                  <span className="px-3 py-1 bg-stone-100 text-stone-600 text-[10px] font-black rounded-full uppercase tracking-widest">
                                    {item.subject}
                                  </span>
                                  <span className={cn(
                                    "px-3 py-1 text-[10px] font-black rounded-full uppercase tracking-widest",
                                    item.difficulty === "Hard" ? "bg-red-50 text-red-600" : 
                                    item.difficulty === "Medium" ? "bg-amber-50 text-amber-600" : 
                                    "bg-emerald-50 text-emerald-600"
                                  )}>
                                    {item.difficulty}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      setEditingAssessmentId(item.id!); 
                                      setEditNameValue(item.topic); 
                                    }}
                                    className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                                    title="Rename"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSaved(item.id!); }}
                                    className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {editingAssessmentId === item.id ? (
                                <div className="mb-6 flex gap-2" onClick={e => e.stopPropagation()}>
                                  <input 
                                    autoFocus
                                    type="text"
                                    value={editNameValue}
                                    onChange={(e) => setEditNameValue(e.target.value)}
                                    className="flex-1 bg-stone-50 border-2 border-emerald-500 rounded-2xl px-4 py-3 text-sm font-bold outline-none shadow-inner"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRenameAssessment(item.id!);
                                      if (e.key === 'Escape') setEditingAssessmentId(null);
                                    }}
                                  />
                                  <button 
                                    onClick={() => handleRenameAssessment(item.id!)}
                                    className="bg-emerald-600 text-white px-4 rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                                  >
                                    <Check className="w-5 h-5" />
                                  </button>
                                </div>
                              ) : (
                                <h3 className="text-xl font-black text-stone-900 mb-2 line-clamp-2 leading-tight group-hover:text-emerald-700 transition-colors">
                                  {item.topic}
                                </h3>
                              )}

                              <div className="flex items-center gap-4 mt-auto pt-6 border-t border-stone-50">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Questions</span>
                                  <span className="text-sm font-black text-stone-700">{getQuestionCount(item.questions)} items</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Created</span>
                                  <span className="text-sm font-black text-stone-700">
                                    {item.createdAt?.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-6 flex items-center gap-3">
                                <button 
                                  onClick={() => handleLoadSaved(item)}
                                  className="flex-1 bg-stone-900 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-xl shadow-stone-900/10 active:scale-95"
                                >
                                  Open Assessment
                                </button>
                                
                                <div className="relative group/move" onClick={e => e.stopPropagation()}>
                                  <button className="p-4 bg-stone-100 text-stone-600 rounded-2xl hover:bg-stone-200 transition-all active:scale-95">
                                    <FolderInput className="w-5 h-5" />
                                  </button>
                                  <div className="absolute bottom-full right-0 mb-3 w-56 bg-white border border-stone-200 rounded-2xl shadow-2xl opacity-0 invisible group-hover/move:opacity-100 group-hover/move:visible transition-all z-20 p-2 translate-y-2 group-hover/move:translate-y-0">
                                    <div className="text-[10px] font-black text-stone-400 px-3 py-2 uppercase tracking-widest border-bottom border-stone-50">Move to Folder</div>
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                      {folders.map(f => (
                                        <button
                                          key={f.id}
                                          onClick={() => handleMoveAssessment(item.id!, f.id!)}
                                          className={cn(
                                            "w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all",
                                            item.folderId === f.id 
                                              ? "bg-emerald-50 text-emerald-700" 
                                              : "text-stone-600 hover:bg-stone-50 hover:translate-x-1"
                                          )}
                                        >
                                          {f.name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      savedQuestions.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center bg-white border border-stone-200 rounded-3xl p-12 text-center">
                          <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                            <HelpCircle className="w-10 h-10 text-stone-200" />
                          </div>
                          <h3 className="text-xl font-black text-stone-900 mb-2">No Questions</h3>
                          <p className="text-stone-500 max-w-xs mx-auto">Your individual question bank is empty.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-4 pb-12">
                          {savedQuestions.map((q) => (
                            <div 
                              key={q.id}
                              className="bg-white border border-stone-200 rounded-2xl p-5 hover:border-emerald-500 hover:shadow-xl transition-all group relative"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex gap-2">
                                  <span className="px-2 py-0.5 bg-stone-100 text-stone-500 text-[8px] font-black rounded uppercase tracking-widest">
                                    {q.subject}
                                  </span>
                                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[8px] font-black rounded uppercase tracking-widest">
                                    {q.topic}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => handleDeleteQuestion(q.id!)}
                                    className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="text-sm text-stone-800 line-clamp-3 mb-4 font-medium markdown-body">
                                <ReactMarkdown
                                  remarkPlugins={[remarkMath, remarkGfm]} 
                                  rehypePlugins={[rehypeKatex, rehypeRaw]}
                                  components={{
                                    svg: ({ node, ...props }: any) => (
                                      <svg {...props} className={cn("max-w-full h-auto mx-auto my-2", props.className)} />
                                    ),
                                    text: ({ node, "font-family": fontFamily, "font-size": fontSize, "text-anchor": textAnchor, "dominant-baseline": dominantBaseline, ...props }: any) => (
                                      <text 
                                        {...props} 
                                        fontFamily={fontFamily} 
                                        fontSize={fontSize} 
                                        textAnchor={textAnchor} 
                                        dominantBaseline={dominantBaseline} 
                                      />
                                    ),
                                    line: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <line {...props} strokeWidth={strokeWidth} />
                                    ),
                                    path: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <path {...props} strokeWidth={strokeWidth} />
                                    ),
                                    ellipse: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <ellipse {...props} strokeWidth={strokeWidth} />
                                    ),
                                    circle: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <circle {...props} strokeWidth={strokeWidth} />
                                    ),
                                    rect: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <rect {...props} strokeWidth={strokeWidth} />
                                    ),
                                    polygon: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <polygon {...props} strokeWidth={strokeWidth} />
                                    ),
                                    polyline: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                                      <polyline {...props} strokeWidth={strokeWidth} />
                                    )
                                  }}
                                >
                                  {getPreviewContent(q.content)}
                                </ReactMarkdown>
                              </div>
                              <div className="flex items-center justify-between pt-4 border-t border-stone-50">
                                <span className="text-[10px] font-bold text-stone-400">
                                  {q.createdAt?.toDate().toLocaleDateString()}
                                </span>
                                <button 
                                  onClick={() => handleLoadQuestion(q)}
                                  className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700"
                                >
                                  View Details
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {!test && !analysis && !loading && (
                  <div className="h-full flex flex-col items-center justify-center text-center py-20">
                    <div className="w-20 h-20 bg-stone-100 rounded-3xl flex items-center justify-center mb-6">
                      <BookOpen className="w-10 h-10 text-stone-300" />
                    </div>
                    <h2 className="text-2xl font-bold text-stone-800 mb-2">Ready to Design</h2>
                    <p className="text-stone-500 max-w-md mx-auto">
                      Configure your test parameters on the left or upload a screenshot/PDF of a past paper question to generate similar ones.
                    </p>
                  </div>
                )}

                {loading && (
                  <div className="h-full flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
                    <p className="text-stone-600 font-medium animate-pulse">Designing your IGCSE assessment...</p>
                  </div>
                )}

                {test && !loading && (
              <div id="assessment-content" className="bg-white border border-stone-200 rounded-2xl shadow-sm flex flex-col min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-500">
                {isEditing && (
                  <div className="flex items-center gap-1 p-2 border-b border-stone-100 bg-stone-50/50 rounded-t-2xl">
                    <button onClick={() => applyFormatting("**")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Bold"><Bold className="w-4 h-4" /></button>
                    <button onClick={() => applyFormatting("*")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Italic"><Italic className="w-4 h-4" /></button>
                    <button onClick={() => applyFormatting("# ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Heading 1"><Heading1 className="w-4 h-4" /></button>
                    <button onClick={() => applyFormatting("## ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Heading 2"><Heading2 className="w-4 h-4" /></button>
                    <button onClick={() => applyFormatting("- ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Bullet List"><List className="w-4 h-4" /></button>
                    <div className="w-px h-4 bg-stone-200 mx-1" />
                    <button onClick={() => applyFormatting("\n\n", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="New Paragraph"><Type className="w-4 h-4" /></button>
                  </div>
                )}
                
                <div className="p-10 flex-1">
                  {studentMode ? (
                    <div className="space-y-8">
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6">
                        <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm uppercase tracking-wider mb-2">
                          <Eye className="w-4 h-4" />
                          Student Workspace
                        </div>
                        <p className="text-indigo-900/70 text-sm">
                          Solve the questions below and paste your answers in the box. Click "Get AI Feedback" for a detailed evaluation based on the Cambridge mark scheme.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="markdown-body prose prose-stone max-w-none">
                          <ReactMarkdown 
                            remarkPlugins={[remarkMath, remarkGfm]} 
                            rehypePlugins={[rehypeKatex, rehypeRaw]}
                          >
                            {normalizeMarkdown(test.questions)}
                          </ReactMarkdown>
                        </div>
                        
                        <div className="space-y-4">
                          <label className="block text-sm font-bold text-stone-700 uppercase tracking-tight">Your Answers</label>
                          <textarea
                            value={studentAnswers}
                            onChange={(e) => setStudentAnswers(e.target.value)}
                            placeholder="Type your answers here (e.g., 1a. Answer...)"
                            className="w-full h-[400px] p-4 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-sm font-sans"
                          />
                          <button 
                            onClick={handleGetFeedback}
                            disabled={loading || !studentAnswers.trim()}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl shadow-lg shadow-indigo-900/10 flex items-center justify-center gap-2 transition-all"
                          >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                            Get AI Feedback
                          </button>

                          {feedback && (
                            <div className="mt-6 p-6 bg-emerald-50 border border-emerald-100 rounded-xl animate-in fade-in slide-in-from-bottom-2">
                              <h4 className="font-bold text-emerald-800 mb-3 flex items-center gap-2">
                                <BrainCircuit className="w-4 h-4" />
                                AI Evaluation
                              </h4>
                              <div className="markdown-body prose prose-emerald text-sm">
                                <ReactMarkdown>{feedback}</ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : isEditing ? (
                    <textarea
                      id="editor-textarea"
                      value={test[activeTab]}
                      onFocus={() => lastFocusedRef.current = "editor-textarea"}
                      onChange={handleContentChange}
                      className="w-full h-full min-h-[500px] bg-transparent border-none outline-none resize-none font-mono text-sm leading-relaxed text-stone-800"
                      placeholder="Start editing your exam content..."
                    />
                  ) : (
                    <div className="markdown-body">
                      <ReactMarkdown 
                        remarkPlugins={[remarkMath, remarkGfm]} 
                        rehypePlugins={[rehypeKatex, rehypeRaw]}
                        components={{
                          // Handle raw SVG tags if they leak out of code blocks
                          svg: ({ node, ...props }: any) => (
                            <svg {...props} className={cn("max-w-full h-auto mx-auto my-6", props.className)} />
                          ),
                          // Map kebab-case to camelCase for common SVG properties to avoid React warnings
                          text: ({ node, "font-family": fontFamily, "font-size": fontSize, "text-anchor": textAnchor, "dominant-baseline": dominantBaseline, ...props }: any) => (
                            <text 
                              {...props} 
                              fontFamily={fontFamily} 
                              fontSize={fontSize} 
                              textAnchor={textAnchor} 
                              dominantBaseline={dominantBaseline} 
                            />
                          ),
                          line: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                            <line {...props} strokeWidth={strokeWidth} />
                          ),
                          path: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                            <path {...props} strokeWidth={strokeWidth} />
                          ),
                          ellipse: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                            <ellipse {...props} strokeWidth={strokeWidth} />
                          ),
                          circle: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                            <circle {...props} strokeWidth={strokeWidth} />
                          ),
                          rect: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                            <rect {...props} strokeWidth={strokeWidth} />
                          ),
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || "");
                            const isSvg = match && match[1] === "svg";
                            const content = String(children);
                            
                            if (!inline && (isSvg || content.includes("<svg"))) {
                              // Clean up the SVG content if it's wrapped in extra tags or has newlines that break dangerouslySetInnerHTML
                              const svgMatch = content.match(/<svg[\s\S]*<\/svg>/);
                              const svgContent = svgMatch ? svgMatch[0] : content;
                              const cleanSvg = svgContent.replace(/\\"/g, '"').replace(/\n/g, " ");

                              return (
                                <div
                                  className="my-6 flex justify-center bg-stone-50 p-6 rounded-xl border border-stone-100 overflow-x-auto"
                                  dangerouslySetInnerHTML={{ __html: cleanSvg }}
                                />
                              );
                            }
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {normalizeMarkdown(test[activeTab])}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            )}

            {analysis && !loading && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-8">
                  <h3 className="text-emerald-900 font-bold text-lg mb-3 flex items-center gap-2">
                    <BrainCircuit className="w-5 h-5" />
                    Topic Analysis
                  </h3>
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 p-1 border-b border-emerald-100 bg-emerald-50/50 rounded-t-lg">
                        <button onClick={() => applyFormatting("**")} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-emerald-700" title="Bold"><Bold className="w-3.5 h-3.5" /></button>
                        <button onClick={() => applyFormatting("*")} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-emerald-700" title="Italic"><Italic className="w-3.5 h-3.5" /></button>
                        <button onClick={() => applyFormatting("- ", "")} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-emerald-700" title="Bullet List"><List className="w-3.5 h-3.5" /></button>
                      </div>
                      <textarea
                        id="analysis-textarea"
                        value={analysis.analysis}
                        onFocus={() => lastFocusedRef.current = "analysis-textarea"}
                        onChange={(e) => setAnalysis({ ...analysis, analysis: e.target.value })}
                        className="w-full bg-transparent border-none outline-none resize-none font-mono text-sm leading-relaxed text-emerald-900 h-32"
                        placeholder="Edit analysis..."
                      />
                    </div>
                  ) : (
                    <div className="markdown-body markdown-emerald">
                      <ReactMarkdown 
                        remarkPlugins={[remarkMath, remarkGfm]} 
                        rehypePlugins={[rehypeKatex, rehypeRaw]}
                      >
                        {normalizeMarkdown(analysis.analysis)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                <div className="bg-white border border-stone-200 rounded-2xl shadow-sm flex flex-col min-h-[600px]">
                  {isEditing && (
                    <div className="flex items-center gap-1 p-2 border-b border-stone-100 bg-stone-50/50 rounded-t-2xl">
                      <button onClick={() => applyFormatting("**")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Bold"><Bold className="w-4 h-4" /></button>
                      <button onClick={() => applyFormatting("*")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Italic"><Italic className="w-4 h-4" /></button>
                      <button onClick={() => applyFormatting("# ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Heading 1"><Heading1 className="w-4 h-4" /></button>
                      <button onClick={() => applyFormatting("## ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Heading 2"><Heading2 className="w-4 h-4" /></button>
                      <button onClick={() => applyFormatting("- ", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="Bullet List"><List className="w-4 h-4" /></button>
                      <div className="w-px h-4 bg-stone-200 mx-1" />
                      <button onClick={() => applyFormatting("\n\n", "")} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all" title="New Paragraph"><Type className="w-4 h-4" /></button>
                    </div>
                  )}
                  
                  <div className="p-10 flex-1">
                    {isEditing ? (
                      <textarea
                        id="editor-textarea"
                        value={analysis.similarQuestions}
                        onFocus={() => lastFocusedRef.current = "editor-textarea"}
                        onChange={handleContentChange}
                        className="w-full h-full min-h-[500px] bg-transparent border-none outline-none resize-none font-mono text-sm leading-relaxed text-stone-800"
                        placeholder="Start editing your exam content..."
                      />
                    ) : (
                      <div className="markdown-body">
                        <h3 className="text-stone-900 font-bold text-lg mb-6 border-b border-stone-100 pb-4">
                          {activeTab === 'questions' ? 'Similar Questions' : activeTab === 'answerKey' ? 'Answer Key' : 'Mark Scheme'}
                        </h3>
                        <ReactMarkdown 
                          remarkPlugins={[remarkMath, remarkGfm]} 
                          rehypePlugins={[rehypeKatex, rehypeRaw]}
                          components={{
                            // Handle raw SVG tags if they leak out of code blocks
                            svg: ({ node, ...props }: any) => (
                              <svg {...props} className={cn("max-w-full h-auto mx-auto my-6", props.className)} />
                            ),
                            // Map kebab-case to camelCase for common SVG properties to avoid React warnings
                            text: ({ node, "font-family": fontFamily, "font-size": fontSize, "text-anchor": textAnchor, "dominant-baseline": dominantBaseline, ...props }: any) => (
                              <text 
                                {...props} 
                                fontFamily={fontFamily} 
                                fontSize={fontSize} 
                                textAnchor={textAnchor} 
                                dominantBaseline={dominantBaseline} 
                              />
                            ),
                            line: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                              <line {...props} strokeWidth={strokeWidth} />
                            ),
                            path: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                              <path {...props} strokeWidth={strokeWidth} />
                            ),
                            ellipse: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                              <ellipse {...props} strokeWidth={strokeWidth} />
                            ),
                            circle: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                              <circle {...props} strokeWidth={strokeWidth} />
                            ),
                            rect: ({ node, "stroke-width": strokeWidth, ...props }: any) => (
                              <rect {...props} strokeWidth={strokeWidth} />
                            ),
                            code({ node, inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || "");
                              const isSvg = match && match[1] === "svg";
                              const content = String(children);
                              
                              if (!inline && (isSvg || content.includes("<svg"))) {
                                const svgMatch = content.match(/<svg[\s\S]*<\/svg>/);
                                const svgContent = svgMatch ? svgMatch[0] : content;
                                const cleanSvg = svgContent.replace(/\\"/g, '"').replace(/\n/g, " ");

                                return (
                                  <div
                                    className="my-6 flex justify-center bg-stone-50 p-6 rounded-xl border border-stone-100 overflow-x-auto"
                                    dangerouslySetInnerHTML={{ __html: cleanSvg }}
                                  />
                                );
                              }
                              return (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            }
                          }}
                        >
                          {normalizeMarkdown(activeTab === 'questions' ? analysis.similarQuestions : activeTab === 'answerKey' ? analysis.answerKey : analysis.markScheme)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </main>
      {/* Folder Selection Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <FolderIcon className="w-5 h-5 text-emerald-600" />
                Save to Folder
              </h3>
              <button onClick={() => setShowFolderModal(false)} className="text-stone-400 hover:text-stone-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-2">Select Folder (Optional)</label>
                <select 
                  value={saveToFolderId}
                  onChange={(e) => setSaveToFolderId(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="">No Folder (Root)</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setShowFolderModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-stone-200 text-stone-600 font-semibold hover:bg-stone-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmSaveToBank}
                  className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/10"
                >
                  Confirm Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={cn(
          "fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 z-50",
          notification.type === 'success' ? "bg-emerald-600 text-white" :
          notification.type === 'error' ? "bg-red-600 text-white" :
          "bg-stone-800 text-white"
        )}>
          {notification.type === 'success' && <Check className="w-4 h-4" />}
          {notification.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {notification.type === 'info' && <Info className="w-4 h-4" />}
          <span className="text-sm font-bold">{notification.message}</span>
        </div>
      )}
    </div>
  );
}
