# IGCSE Tools — Kapsamlı İyileştirme Tasarımı

**Tarih:** 2026-03-16
**Kapsam:** Güvenlik, altyapı, veri modeli, kod organizasyonu, UX düzeltmeleri
**Yaklaşım:** Risk sırasına göre kademeli — her faz bağımsız commit, her adımdan sonra uygulama çalışır durumda

---

## Bağlam

IGCSE Tools, React 19 + Firebase + Gemini API kullanan bir Cambridge IGCSE sınav tasarım aracı. Temel sorunlar:
- `App.tsx` 1956 satır — tek dosyada tüm uygulama mantığı
- PDF'ler base64 olarak Firestore'a yazılıyor (1MB limit sorunu)
- API key git geçmişinde sızıntı riski
- Veri modeli düz markdown string — arama/analitik imkânsız
- Gemini hata yönetimi eksik

---

## Faz 1 — Güvenlik & Temizlik

### 1.1 `motion` paketi kaldırma

**Önce:** Tüm kaynak dosyalarında `motion` import'u olup olmadığını tara:
```bash
grep -r "from 'motion'" src/
grep -r "from \"motion\"" src/
```
Eğer hiçbir kullanım yoksa kaldır:
```bash
npm uninstall motion
```
Eğer kullanım bulunursa bu maddeyi atla ve `ISSUES.md`'ye not düş.

### 1.2 `.env` git geçmişi temizliği

```bash
git log --all --oneline -- .env
```
- Eğer commit çıkmıyorsa: yalnızca `.gitignore`'ın doğru olduğunu teyit et ve devam et.
- Eğer commit çıkıyorsa:
  1. `git-filter-repo --path .env --invert-paths` ile geçmişten temizle
  2. Gemini API key'i Google AI Studio Console'dan rotate et
  3. Yeni key'i `.env` dosyasına yaz (`.gitignore` zaten içeriyor)
  4. `.env.example` dosyasını güncel tut

### 1.3 Firebase API key kısıtlama (dokümantasyon)

`docs/firebase-api-key-restriction.md` dosyası oluştur. İçeriği:
- Firebase Console → igcse-tools → Project settings → API & Services → Credentials
- `browser key`'i düzenle → "Application restrictions" → HTTP referrers
- İzin verilen: `igcse-tools.firebaseapp.com/*`, `localhost/*`
- Bu değişiklik kodda değil, Console UI'da yapılır

---

## Faz 2 — Altyapı

### 2.1 Firebase Storage entegrasyonu (resources)

**Ön koşul:** `igcse-tools` Firebase projesinde Storage'ın aktif olduğunu Firebase Console'dan doğrula. Aktif değilse etkinleştir.

**`firebase.ts` değişiklikleri:**

1. Storage SDK import'u ekle:
```typescript
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
export const storage = getStorage(app)
// Not: firebase-applet-config.json'da "storageBucket": "igcse-tools.firebasestorage.app" zaten var — doğrula.
```

2. Yeni `Resource` arayüzü (`data` kaldırılır):
```typescript
interface Resource {
  id: string
  name: string
  subject: string
  storagePath: string   // "resources/{userId}/{resourceId}/{filename}"
  downloadURL: string   // Firebase Storage URL
  mimeType: string
  userId: string
  createdAt: Timestamp
}
```

3. `saveResource()` implementasyonu:
```typescript
// 1. Unique resourceId oluştur (doc ref'ten)
// 2. uploadBytes(ref(storage, `resources/${uid}/${resourceId}/${name}`), fileBytes)
// 3. getDownloadURL(storageRef) → downloadURL
// 4. Firestore'a metadata yaz (storagePath, downloadURL, data yok)
```

4. `deleteResource()` implementasyonu:
```typescript
// 1. deleteObject(ref(storage, resource.storagePath))
// 2. deleteDoc(Firestore ref)
// İkisi de çağrılmalı; Storage başarısız olsa bile Firestore'u temizle
```

5. Gemini'ye dosya gönderme: `getResources()` artık `downloadURL` döndürüyor. Kullanım noktasında:
```typescript
const response = await fetch(resource.downloadURL)
const arrayBuffer = await response.arrayBuffer()
const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
// base64'ü Gemini inlineData olarak ilet
```

**`storage.rules` dosyası oluştur** (proje kökünde):
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /resources/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**`firebase.json` güncelle** — Storage rules deploy için:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

Deploy komutu: `firebase deploy --only storage --project igcse-tools`

**`firestore.rules` güncelle** — `data` alanını kural validasyonundan kaldır, `storagePath`/`downloadURL` ekle.

### 2.2 Gemini hata yönetimi

`gemini.ts`'e eklenecek tip ve yardımcı fonksiyon:

```typescript
interface GeminiError {
  type: 'rate_limit' | 'model_overloaded' | 'invalid_response' | 'network' | 'unknown'
  retryable: boolean
  message: string
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number) => void
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.status ?? err?.code
      if (status === 429 && i < maxRetries - 1) {
        onRetry?.(i + 1)
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000)) // 1s, 2s, 4s
        continue
      }
      if (status === 503) {
        throw { type: 'model_overloaded', retryable: false, message: 'Model şu an meşgul, Flash modele geçin.' } as GeminiError
      }
      throw err
    }
  }
  throw { type: 'rate_limit', retryable: false, message: 'Rate limit aşıldı, birkaç dakika bekleyin.' } as GeminiError
}
```

`generateTest()`, `auditTest()`, `getStudentFeedback()` fonksiyonları `withRetry()` sarmalayıcısına alınır.

**`auditTest()` ve `getStudentFeedback()` güncelleme notu** (Faz 3 veri modeli değişikliğiyle birlikte):
- Bu fonksiyonlar şu an `test: { questions: string, answerKey: string, markScheme: string }` alıyor
- Faz 3 sonrası yeni imzalar:
  - `auditTest(subject: string, assessment: Assessment, model: string)` → `QuestionItem[]`
    - Gemini yalnızca güncellenmiş soruları döndürür. Caller, orijinal `assessment`'ın meta alanlarını (`subject`, `topic`, `difficulty`, `userId`, `folderId`, `id`, `createdAt`) korur ve sadece `questions` alanını Gemini çıktısıyla değiştirir:
      ```typescript
      const auditedQuestions = await auditTest(subject, assessment, model)
      const auditedAssessment: Assessment = { ...assessment, questions: auditedQuestions }
      ```
  - `getStudentFeedback(subject: string, assessment: Assessment, studentAnswers: string[], model: string)` → `string`
- Prompt serialization:
  - Sorular: `assessment.questions.map((q, i) => \`**Q${i+1}** [${q.marks} marks]\n${q.text}\`).join('\n\n')`
  - Cevaplar: `studentAnswers.map((a, i) => \`Q${i+1}: ${a || '(no answer)'}\`).join('\n')`
- `auditTest` response schema, `generateTest` ile aynı (`questions: QuestionItem[]`)

### 2.3 Clipboard API fallback

`src/lib/clipboard.ts` dosyası oluştur:

```typescript
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* fallback */ }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const success = document.execCommand('copy')
  document.body.removeChild(textarea)
  return success
}
```

`App.tsx`'deki tüm `navigator.clipboard.writeText()` çağrılarını bu fonksiyonla değiştir.

---

## Faz 3 — Veri Modeli (Temiz Başlangıç)

**Karar:** Eski `questions: string`, `answerKey: string`, `markScheme: string` formatındaki Firestore kayıtları görmezden gelinir. Uygulama yeni yapısal formatla çalışır; yeni formatla uyuşmayan eski kayıtlar UI'da görünmez (filtre: `typeof assessment.questions === 'object'`).

Bu "temiz başlangıç" kararı hem `assessments` hem de `questions` Firestore koleksiyonları için geçerlidir.

### Yeni tipler (`src/lib/types.ts` olarak ayrı dosyaya çıkar)

```typescript
export interface QuestionItem {
  id: string
  text: string           // markdown — tek soru metni
  answer: string         // markdown — cevap
  markScheme: string     // markdown — puan şeması
  marks: number
  commandWord: string    // "Calculate", "Explain", vs.
  type: 'mcq' | 'short_answer' | 'structured'
  hasDiagram: boolean
}

export interface Assessment {
  id: string
  subject: string
  topic: string
  difficulty: string
  questions: QuestionItem[]
  userId: string
  folderId?: string
  createdAt: Timestamp
}

export interface Question extends QuestionItem {
  assessmentId?: string
  subject: string
  topic: string
  difficulty: string
  userId: string
  folderId?: string
  createdAt: Timestamp
}

export interface Folder {
  id: string
  name: string
  userId: string
  createdAt: Timestamp
}

export interface Resource {
  id: string
  name: string
  subject: string
  storagePath: string
  downloadURL: string
  mimeType: string
  userId: string
  createdAt: Timestamp
}
```

### Gemini çıktısı → yeni tip adapter

`generateTest()` artık şu JSON schema ile çalışır:

```typescript
// Gemini response schema:
{
  questions: Array<{
    text: string,
    answer: string,
    markScheme: string,
    marks: number,
    commandWord: string,
    type: 'mcq' | 'short_answer' | 'structured',
    hasDiagram: boolean
  }>
}
// Her soru id'si: crypto.randomUUID() ile client'ta atanır
```

Eski `TestResponse` tipi (`questions: string, answerKey: string, markScheme: string`) tamamen kaldırılır. `generateTest()` artık `QuestionItem[]` döner.

**`analyzeFile()` return tipi de güncellenir.** Mevcut `{ analysis, similarQuestions: string, answerKey: string, markScheme: string }` yerine:
```typescript
interface AnalyzeFileResult {
  analysis: string          // string kalır — dosyanın açıklaması
  questions: QuestionItem[] // similarQuestions → yapısal array
}
```
Gemini response schema `analyzeFile` içinde de `questions: Array<{text, answer, markScheme, marks, commandWord, type, hasDiagram}>` olarak güncellenir. Client'ta her soru için `crypto.randomUUID()` ile `id` atanır.

### Firebase CRUD güncellemeleri

`userId` her zaman fonksiyon içinde `auth.currentUser.uid`'den enjekte edilir — caller geçmez.

```typescript
// firebase.ts imzaları:
saveAssessment(data: Omit<Assessment, 'id' | 'createdAt' | 'userId'>): Promise<string>
getSavedAssessments(): Promise<Assessment[]>
  // Filtre: Array.isArray(doc.data().questions) === true olanları döndür (eski string format gizlenir)
updateAssessment(id: string, data: Partial<Omit<Assessment, 'id' | 'userId' | 'createdAt'>>): Promise<void>
deleteAssessment(id: string): Promise<void>
moveAssessment(id: string, folderId: string | null): Promise<void>

saveQuestion(data: Omit<Question, 'id' | 'createdAt' | 'userId'>): Promise<string>
getQuestions(folderId?: string): Promise<Question[]>
  // Filtre: typeof doc.data().text === 'string' olanları döndür (eski 'content' field'lı kayıtlar gizlenir)
deleteQuestion(id: string): Promise<void>
moveQuestion(id: string, folderId: string | null): Promise<void>
```

---

## Faz 4 — App.tsx Refactoring

**Hedef:** 1956 satır → ~120 satır `App.tsx` + modüler dosyalar.

### Veri akışı mimarisi (cross-hook)

```
useGeneration.ts
  └─ generatedAssessment: Assessment | null   ← generate() sonucu burada
  └─ onSave callback (App.tsx'ten props olarak gelir)

useAssessments.ts
  └─ assessments: Assessment[]                ← Firestore kayıtları
  └─ saveAssessment(a: Assessment)            ← useGeneration'dan çağrılır

App.tsx
  └─ const gen = useGeneration()
  └─ const lib = useAssessments()
  └─ <Sidebar onGenerate={() => gen.generate(config)} />
  └─ <AssessmentView assessment={gen.generatedAssessment}
                      onSave={() => lib.saveAssessment(gen.generatedAssessment)} />
```

`currentAssessment` state'i **`useGeneration`** içindedir (`generatedAssessment`). `useAssessments` içinde değil. Kaydetme işlemi App.tsx koordinasyonuyla gerçekleşir.

### `knowledgeBase` state geçişi

Mevcut `knowledgeBase: Record<string, {name, data, type}[]>` — konuya göre gruplanmış, base64 in-memory store.

**Faz 3 sonrasında** (Storage'a geçişle birlikte):
- `useResources` hook'u `resources: Resource[]` ve `knowledgeBase: Resource[]` state'lerini yönetir
- `knowledgeBase` artık `Resource[]` (sadece referanslar, base64 değil)
- Gemini çağrısı sırasında `useResources.getBase64(resource)` → `fetch(downloadURL)` → geçici base64
- `addToKnowledgeBase(resource: Resource)` → `knowledgeBase`'e ekler (session'da kalır, persist olmaz)
- `removeFromKnowledgeBase(id: string)` → çıkarır

### Hook detayları

#### `src/hooks/useAssessments.ts`
- State: `assessments: Assessment[]`, `questions: Question[]`, `folders: Folder[]`, `loading: boolean`
- Fonksiyonlar: `loadAll()`, `saveAssessment()`, `deleteAssessment()`, `updateAssessment()`, `moveAssessment()`, `createFolder()`, `deleteFolder()`
- Firestore tek seferlik fetch (onSnapshot değil — real-time sync gerekmez)

#### `src/hooks/useGeneration.ts`
- State:
  - `generatedAssessment: Assessment | null`
  - `analysisText: string | null` — `analyzeFile` çıktısındaki dosya analiz açıklaması; `AssessmentView`'da gösterilir
  - `isGenerating: boolean`, `isAuditing: boolean`, `retryCount: number`, `error: GeminiError | null`
- Fonksiyonlar:
  - `generate(config: GenerationConfig, knowledgeBaseResources: Resource[])` → void; çıktı `generatedAssessment`'a set edilir
  - `analyzeFile(file: {base64: string, mimeType: string}, subject: string, model: string, knowledgeBaseResources: Resource[])` → void; `questions` → `generatedAssessment`'a, `analysis` → `analysisText`'e set edilir
  - `getStudentFeedback(studentAnswers: string[], model: string)` → void; `subject` ve `assessment` hook içindeki `generatedAssessment`'tan okunur; `model` parametre olarak geçirilir
  - `setGeneratedAssessment(a: Assessment | null)` → Library'den assessment yüklenirken kullanılır
- `getStudentFeedback` çağrısında `model` değeri `Sidebar`'da seçilen model bilgisini taşıyan `config.model`'dan gelir; `AssessmentView` bunu prop olarak alır:
  ```tsx
  <AssessmentView
    onStudentFeedback={(answers) => generation.getStudentFeedback(answers, config.model)}
    ...
  />
  ```
- Retry sayacı `retryCount` ile UI'a iletilir

#### `src/hooks/useNotifications.ts`
- State: `notifications: Array<{id: string, message: string, type: 'success'|'error'|'info', dismissAt: number}>`
- Fonksiyonlar: `notify(message, type)` → UUID ile ekler, `dismiss(id)`
- `useEffect` ile `dismissAt` geçmiş olanları siler (1s interval):
  ```typescript
  useEffect(() => {
    const interval = setInterval(() => {
      setNotifications(n => n.filter(x => x.dismissAt > Date.now()))
    }, 1000)
    return () => clearInterval(interval) // cleanup — unmount ve re-render'da interval birikmez
  }, [])
  ```

#### `src/hooks/useResources.ts`
- State: `resources: Resource[]`, `knowledgeBase: Resource[]`, `uploading: boolean`
- Fonksiyonlar: `uploadResource(file, subject)`, `deleteResource(resource)`, `loadResources()`, `addToKnowledgeBase(resource)`, `removeFromKnowledgeBase(id)`, `getBase64(resource): Promise<string>`
- `getBase64` → `fetch(downloadURL)` → base64 string (Gemini'ye iletmek için)

### Component'ler

#### `src/components/Sidebar/index.tsx`
Props: `config`, `onConfigChange`, `onGenerate`, `isGenerating`, `retryCount`, `resources`, `knowledgeBase`, `onUploadResource`, `onAddToKB`, `onRemoveFromKB`
- Subject/topic/difficulty/count/type/model/calculator seçimi
- Cost calculator (`MODEL_PRICING` tablosundan)
- Knowledge base yönetimi
- Generate butonu (loading state + retry sayacı)

#### `src/components/AssessmentView/index.tsx`
Props: `assessment: Assessment | null`, `isEditing`, `onEdit`, `onSave`, `onDownloadPDF`, `studentMode`, `onStudentFeedback`
- Tab'lar: Questions / Answer Key / Mark Scheme
- Her `QuestionItem` için markdown render
- Edit modu (metin editörü)
- Student mode: cevaplar gizli, feedback paneli görünür

#### `src/components/Library/index.tsx`
Props: `assessments`, `questions`, `folders`, `onSelect`, `onDelete`, `onMove`, `onRename`, `onCreateFolder`, `onDeleteFolder`
- Sol: folder tree
- Sağ: grid (assessment kartları)
- Sıralama: `createdAt` desc

#### `src/components/Notifications/index.tsx`
Props: `notifications`, `onDismiss`
- Sabit konumlu (bottom-right), yığılı toast'lar

### App.tsx son hali (~120 satır)
```tsx
function App() {
  const [user] = useAuthState(auth)
  const [view, setView] = useState<'main' | 'library'>('main')
  const [config, setConfig] = useState<GenerationConfig>(DEFAULT_CONFIG)
  const [studentMode, setStudentMode] = useState(false)

  const notifications = useNotifications()
  const resources = useResources(user, notifications.notify)
  const generation = useGeneration(notifications.notify)
  const library = useAssessments(user, notifications.notify)

  if (!user) return <LoginScreen />

  return (
    <div className="flex h-screen">
      <Sidebar config={config} onConfigChange={setConfig}
               onGenerate={() => generation.generate(config, resources.knowledgeBase)}
               isGenerating={generation.isGenerating} retryCount={generation.retryCount}
               resources={resources.resources} knowledgeBase={resources.knowledgeBase}
               onUploadResource={resources.uploadResource}
               onAddToKB={resources.addToKnowledgeBase}
               onRemoveFromKB={resources.removeFromKnowledgeBase} />
      <main>
        {view === 'library'
          ? <Library {...library} onSelect={a => { generation.setGeneratedAssessment(a); setView('main') }} />
          : <AssessmentView assessment={generation.generatedAssessment}
                             onSave={() => library.saveAssessment(generation.generatedAssessment!)}
                             studentMode={studentMode} ... />
        }
      </main>
      <Notifications notifications={notifications.notifications} onDismiss={notifications.dismiss} />
    </div>
  )
}
```

---

## Faz 5 — UX & Küçük Düzeltmeler

### 5.1 SVG render güvenliği

**Mevcut:** Regex ile SVG çıkarılıp `dangerouslySetInnerHTML`.

**Yeni:** `DOMParser` ile parse et; geçersiz SVG'leri düşür.

```typescript
function parseSVGSafe(svgString: string): string | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  return doc.documentElement.outerHTML
}
```

Kullanım: `parseSVGSafe(svgStr)` null dönerse SVG bloğu render edilmez, onun yerine `[Diagram unavailable]` göster.

### 5.2 PDF export — style inject yaklaşımı

**Not:** `@media print` CSS `html2canvas` tarafından yoksayılır — `html2canvas` DOM klonlar, print media query'leri tetiklemez.

**Doğru yaklaşım:** `html2canvas` çağrısından önce geçici `<style>` tag'ı enjekte et:

```typescript
function injectPrintStyles(): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = 'pdf-export-override'
  style.textContent = `
    :root {
      --color-emerald-500: #10b981 !important;
      --color-emerald-600: #059669 !important;
      --color-emerald-100: #d1fae5 !important;
      --color-stone-50: #fafaf9 !important;
      --color-stone-100: #f5f5f4 !important;
      --color-stone-800: #292524 !important;
    }
  `
  document.head.appendChild(style)
  return style
}

// Kullanım:
const styleTag = injectPrintStyles()
const canvas = await html2canvas(element, { useCORS: true })
styleTag.remove()
```

Bu, mevcut oklch manuel dönüşüm kodunun yerine geçer. Daha az hardcode, CSS değişken override'ı yeterli.

### 5.3 Cost calculator — model adından bağımsız

`src/lib/pricing.ts` dosyası oluştur:

```typescript
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview': { input: 0.10, output: 0.40 },
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.00 },
}
const FALLBACK = MODEL_PRICING['gemini-3-flash-preview']
const IDR_RATE = 15800

export function estimateCostIDR(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = MODEL_PRICING[modelId] ?? FALLBACK
  const usd = (inputTokens / 1_000_000 * p.input) + (outputTokens / 1_000_000 * p.output)
  return Math.round(usd * IDR_RATE)
}
```

`App.tsx` ve `Sidebar` içindeki inline cost hesaplarını bu fonksiyona yönlendir.

---

## Firestore Kuralları Güncelleme Özeti

```
assessments:
  - questions: list (QuestionItem[]) — string değil
  - answerKey: KALDIRILDI
  - markScheme: KALDIRILDI

questions (bireysel soru koleksiyonu):
  - content: KALDIRILDI → text: string
  - answer: string (hâlâ var)
  - markScheme: string (hâlâ var)
  - marks: number (yeni)
  - commandWord: string (yeni)
  - type: string (yeni)
  - hasDiagram: boolean (yeni)

resources:
  - data: KALDIRILDI
  - storagePath: string (yeni)
  - downloadURL: string (yeni)
```

---

## Başarı Kriterleri

- [ ] `.env` git geçmişinde yok veya hiç commit edilmemiş — doğrulandı
- [ ] `motion` paketi kaldırılmış (kullanılmıyorsa)
- [ ] PDF dosyalar Firebase Storage'a yükleniyor, Firestore'a sadece metadata yazılıyor
- [ ] `storage.rules` deploy edilmiş, Storage erişimi owner-only
- [ ] Gemini 429 hatası retry ile handle ediliyor, kullanıcıya anlamlı mesaj gösteriliyor
- [ ] `App.tsx` < 150 satır
- [ ] Her hook bağımsız, tek sorumluluk prensibine uygun
- [ ] Yeni `Assessment` formatıyla oluşturma ve kaydetme çalışıyor
- [ ] Eski format Firestore kayıtları görünmüyor (filtre çalışıyor)
- [ ] SVG'ler DOMParser ile güvenli parse ediliyor
- [ ] Clipboard HTTP ortamında da çalışıyor
- [ ] PDF export oklch renk sorunu style inject ile çözülmüş

---

## Risk & Kısıtlamalar

- **Firebase Storage aktivasyonu:** `igcse-tools` projesinde Storage henüz aktif olmayabilir — Faz 2.1 öncesi Console'dan etkinleştir
- **Eski Firestore kayıtları:** Yeni `Assessment` tipini karşılamayan kayıtlar filtreyle gizlenir, silinmez
- **Gemini model adları:** `MODEL_PRICING` tablosu periyodik güncelleme gerektirebilir
- **`auditTest` + `getStudentFeedback` güncellemesi:** Bu iki fonksiyon Faz 2.2 ve Faz 3 arasında koordineli güncellenmeli; birini yapmadan diğerini yapmak tip hatası verir
