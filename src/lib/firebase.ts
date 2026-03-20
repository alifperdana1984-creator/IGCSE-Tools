import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  orderBy,
  updateDoc,
  deleteField,
  getDoc,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import type { Assessment, Question, Folder, Resource, ResourceType, SyllabusCache, PastPaperCache } from './types'

/** Remove undefined values from an object shallowly (Firestore rejects undefined). */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = stripUndefined(v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
}


function serializeQuestionDiagram(q: unknown): unknown {
  if (!q || typeof q !== 'object') return q
  return stripUndefined({ ...(q as Record<string, unknown>) })
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// --- Firestore Error Handling Spec ---
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
// --------------------------------------

export const signInWithGoogle = async () => {
  await signInWithPopup(auth, googleProvider);
};

export const logout = () => auth.signOut();

export const saveAssessment = async (
  data: Omit<Assessment, 'id' | 'createdAt' | 'userId'>
): Promise<string> => {
  if (!auth.currentUser) throw new Error("User must be authenticated to save")
  const assessmentsRef = collection(db, 'assessments')
  const payload: any = {
    ...data,
    userId: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    questions: data.questions?.map(serializeQuestionDiagram),
  }
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])
  try {
    const docRef = await addDoc(assessmentsRef, payload)
    return docRef.id
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'assessments')
    throw error
  }
}

/** Atomically saves assessment + questions in a single writeBatch commit.
 *  Prevents orphaned assessments when question saving fails. */
export const saveAssessmentWithQuestions = async (
  assessmentData: Omit<Assessment, 'id' | 'createdAt' | 'userId'>,
  questions: Array<Omit<Question, 'id' | 'createdAt' | 'userId'>>,
): Promise<string> => {
  if (!auth.currentUser) throw new Error('User must be authenticated to save')
  const uid = auth.currentUser.uid
  const batch = writeBatch(db)

  const assessmentRef = doc(collection(db, 'assessments'))
  const assessmentPayload: any = {
    ...assessmentData,
    userId: uid,
    createdAt: serverTimestamp(),
    questions: assessmentData.questions?.map(serializeQuestionDiagram),
  }
  Object.keys(assessmentPayload).forEach(k => assessmentPayload[k] === undefined && delete assessmentPayload[k])
  batch.set(assessmentRef, assessmentPayload)

  for (const q of questions) {
    const questionRef = doc(collection(db, 'questions'))
    const questionPayload: any = { ...(serializeQuestionDiagram(q) as object), userId: uid, assessmentId: assessmentRef.id, createdAt: serverTimestamp() }
    Object.keys(questionPayload).forEach(k => questionPayload[k] === undefined && delete questionPayload[k])
    batch.set(questionRef, questionPayload)
  }

  try {
    await batch.commit()
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'assessments+questions')
    throw error
  }
  return assessmentRef.id
}

export const getSavedAssessments = async (folderId?: string): Promise<Assessment[]> => {
  if (!auth.currentUser) return []
  const uid = auth.currentUser.uid
  const assessmentsRef = collection(db, 'assessments')

  const ownQuery = folderId
    ? query(assessmentsRef, where('userId', '==', uid), where('folderId', '==', folderId), orderBy('createdAt', 'desc'))
    : query(assessmentsRef, where('userId', '==', uid), orderBy('createdAt', 'desc'))
  const publicQuery = query(assessmentsRef, where('isPublic', '==', true))

  try {
    const ownSnap = await getDocs(ownQuery)
    const own = ownSnap.docs.map(d => ({ id: d.id, ...d.data() } as Assessment)).filter(a => Array.isArray(a.questions))

    let pub: Assessment[] = []
    try {
      const publicSnap = await getDocs(publicQuery)
      pub = publicSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Assessment))
        .filter(a => Array.isArray(a.questions) && a.userId !== uid)
    } catch {
      // Public query may fail if no public items exist or rules are still propagating
    }

    const ownIds = new Set(own.map(a => a.id))
    return [...own, ...pub.filter(a => !ownIds.has(a.id))]
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assessments')
    return []
  }
}

export const deleteAssessment = async (id: string) => {
  const docRef = doc(db, 'assessments', id);
  try {
    return await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `assessments/${id}`);
  }
};

export const createFolder = async (name: string) => {
  if (!auth.currentUser) throw new Error("User must be authenticated to create folder");
  const foldersRef = collection(db, 'folders');
  return addDoc(foldersRef, {
    name,
    userId: auth.currentUser.uid,
    createdAt: serverTimestamp()
  });
};

export const getFolders = async () => {
  if (!auth.currentUser) return [];
  const foldersRef = collection(db, 'folders');
  const q = query(
    foldersRef,
    where('userId', '==', auth.currentUser.uid),
    orderBy('createdAt', 'asc')
  );
  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Folder[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'folders');
    return [];
  }
};

export const deleteFolder = async (id: string) => {
  const docRef = doc(db, 'folders', id);
  try {
    return await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `folders/${id}`);
  }
};

export const updateFolder = async (id: string, name: string) => {
  const docRef = doc(db, 'folders', id);
  try {
    return await updateDoc(docRef, { name });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `folders/${id}`);
  }
};

export const saveResource = async (
  file: { name: string; data: ArrayBuffer; mimeType: string },
  subject: string,
  resourceType?: ResourceType
): Promise<Resource> => {
  if (!auth.currentUser) throw new Error("User must be authenticated to save resource")
  const uid = auth.currentUser.uid
  const resourcesRef = collection(db, 'resources')
  const docRef = doc(resourcesRef)
  const resourceId = docRef.id
  const path = `resources/${uid}/${resourceId}/${file.name}`
  const sRef = storageRef(storage, path)
  await uploadBytes(sRef, file.data, { contentType: file.mimeType })
  const downloadURL = await getDownloadURL(sRef)
  const metadata: any = {
    name: file.name,
    subject,
    storagePath: path,
    downloadURL,
    mimeType: file.mimeType,
    userId: uid,
    createdAt: serverTimestamp(),
  }
  if (resourceType) metadata.resourceType = resourceType
  await setDoc(docRef, metadata)
  return { id: resourceId, ...metadata, createdAt: Timestamp.now() }
}

export const updateResourceType = async (id: string, resourceType: ResourceType): Promise<void> => {
  await updateDoc(doc(db, 'resources', id), { resourceType })
}

export const updateResourceGeminiUri = async (id: string, uri: string): Promise<void> => {
  await updateDoc(doc(db, 'resources', id), {
    geminiFileUri: uri,
    geminiFileUploadedAt: serverTimestamp(),
  })
}

export const toggleResourceShared = async (id: string, isShared: boolean): Promise<void> => {
  await updateDoc(doc(db, 'resources', id), { isShared })
}

export const saveSyllabusCache = async (
  resourceId: string,
  subject: string,
  topics: Record<string, string>
): Promise<void> => {
  await setDoc(doc(db, 'syllabusCache', resourceId), {
    resourceId,
    subject,
    topics,
    processedAt: serverTimestamp(),
    userId: auth.currentUser?.uid ?? null,
  })
}

export const getSyllabusCache = async (resourceId: string): Promise<SyllabusCache | null> => {
  const snap = await getDoc(doc(db, 'syllabusCache', resourceId))
  return snap.exists() ? (snap.data() as SyllabusCache) : null
}

export const savePastPaperCache = async (
  resourceId: string,
  subject: string,
  data: {
    examples?: string
    items?: PastPaperCache['items']
    summary?: string
    version?: number
  }
): Promise<void> => {
  await setDoc(doc(db, 'pastPaperCache', resourceId), {
    resourceId,
    subject,
    ...data,
    processedAt: serverTimestamp(),
    userId: auth.currentUser?.uid ?? null,
  })
}

export const getPastPaperCache = async (resourceId: string): Promise<PastPaperCache | null> => {
  const snap = await getDoc(doc(db, 'pastPaperCache', resourceId))
  return snap.exists() ? (snap.data() as PastPaperCache) : null
}

export const getResources = async (subject?: string) => {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid;
  const resourcesRef = collection(db, 'resources');

  const ownQ = subject
    ? query(resourcesRef, where('userId', '==', uid), where('subject', '==', subject), orderBy('createdAt', 'desc'))
    : query(resourcesRef, where('userId', '==', uid), orderBy('createdAt', 'desc'));

  const sharedQ = subject
    ? query(resourcesRef, where('isShared', '==', true), where('subject', '==', subject), orderBy('createdAt', 'desc'))
    : query(resourcesRef, where('isShared', '==', true), orderBy('createdAt', 'desc'));

  try {
    const [ownSnap, sharedSnap] = await Promise.all([getDocs(ownQ), getDocs(sharedQ)]);
    const own = ownSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Resource).filter(r => !!r.downloadURL);
    const ownIds = new Set(own.map(r => r.id));
    const shared = sharedSnap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Resource)
      .filter(r => !!r.downloadURL && !ownIds.has(r.id));
    return [...own, ...shared].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'resources');
    return [];
  }
};

export const deleteResource = async (resource: Resource): Promise<void> => {
  // Delete from Storage first (if it fails, still clean up Firestore)
  try {
    const sRef = storageRef(storage, resource.storagePath)
    await deleteObject(sRef)
  } catch (e) {
    console.warn('Storage delete failed, continuing with Firestore cleanup:', e)
  }
  const docRef = doc(db, 'resources', resource.id)
  try {
    await deleteDoc(docRef)
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `resources/${resource.id}`)
  }
}

export const moveAssessment = async (assessmentId: string, folderId: string | null) => {
  const docRef = doc(db, 'assessments', assessmentId);
  try {
    return await updateDoc(docRef, {
      folderId: folderId ? folderId : deleteField()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assessments/${assessmentId}`);
  }
};

export const updateAssessment = async (
  id: string,
  updates: Partial<Omit<Assessment, 'id' | 'userId' | 'createdAt'>>
): Promise<void> => {
  const docRef = doc(db, 'assessments', id)
  try {
    const payload = stripUndefined(updates as Record<string, unknown>)
    if (Array.isArray(payload.questions)) {
      payload.questions = (payload.questions as unknown[]).map(q => serializeQuestionDiagram(q))
    }
    await updateDoc(docRef, payload as any)
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assessments/${id}`)
  }
}

export const saveQuestion = async (
  data: Omit<Question, 'id' | 'createdAt' | 'userId'>
): Promise<string> => {
  if (!auth.currentUser) throw new Error("User must be authenticated to save question")
  const questionsRef = collection(db, 'questions')
  try {
    const payload: any = {
      ...data,
      userId: auth.currentUser.uid,
      createdAt: serverTimestamp()
    }
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])
    const docRef = await addDoc(questionsRef, payload)
    return docRef.id
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'questions')
    throw error
  }
}

export const getQuestions = async (folderId?: string): Promise<Question[]> => {
  if (!auth.currentUser) return []
  const uid = auth.currentUser.uid
  const questionsRef = collection(db, 'questions')

  const ownQuery = folderId
    ? query(questionsRef, where('userId', '==', uid), where('folderId', '==', folderId), orderBy('createdAt', 'desc'))
    : query(questionsRef, where('userId', '==', uid), orderBy('createdAt', 'desc'))
  const publicQuery = query(questionsRef, where('isPublic', '==', true))

  try {
    const ownSnap = await getDocs(ownQuery)
    const own = ownSnap.docs.map(d => ({ id: d.id, ...d.data() } as Question)).filter(q => typeof (q as any).text === 'string')

    let pub: Question[] = []
    try {
      const publicSnap = await getDocs(publicQuery)
      pub = publicSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Question))
        .filter(q => typeof (q as any).text === 'string' && q.userId !== uid)
    } catch {
      // Public query may fail if no public items exist or rules are still propagating
    }

    const ownIds = new Set(own.map(q => q.id))
    return [...own, ...pub.filter(q => !ownIds.has(q.id))]
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'questions')
    return []
  }
}

export const deleteQuestion = async (id: string) => {
  const docRef = doc(db, 'questions', id);
  try {
    return await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `questions/${id}`);
  }
};

export const moveQuestion = async (questionId: string, folderId: string | null) => {
  const docRef = doc(db, 'questions', questionId);
  try {
    return await updateDoc(docRef, {
      folderId: folderId ? folderId : deleteField()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `questions/${questionId}`);
  }
};

export const updateQuestion = async (
  id: string,
  updates: Partial<Omit<Question, 'id' | 'userId' | 'createdAt'>>
): Promise<void> => {
  const docRef = doc(db, 'questions', id)
  try {
    await updateDoc(docRef, stripUndefined(serializeQuestionDiagram(updates) as Record<string, unknown>) as any)
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `questions/${id}`)
  }
}

export const togglePublicAssessment = async (id: string, isPublic: boolean, preparedBy: string) => {
  const docRef = doc(db, 'assessments', id)
  try {
    await updateDoc(docRef, { isPublic, preparedBy: isPublic ? preparedBy : deleteField() })
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assessments/${id}`)
  }
}

export const togglePublicQuestion = async (id: string, isPublic: boolean, preparedBy: string) => {
  const docRef = doc(db, 'questions', id)
  try {
    await updateDoc(docRef, { isPublic, preparedBy: isPublic ? preparedBy : deleteField() })
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `questions/${id}`)
  }
}

/** GDPR: delete all Firestore data owned by a user, then delete their Auth account.
 *  Iterates in batches of 400 to stay under the 500-op batch limit. */
export const deleteUserData = async (): Promise<void> => {
  const user = auth.currentUser
  if (!user) throw new Error('No authenticated user')
  const uid = user.uid

  const collectionsToClean: string[] = ['assessments', 'questions', 'folders', 'resources']
  for (const col of collectionsToClean) {
    const q = query(collection(db, col), where('userId', '==', uid))
    let snap = await getDocs(q)
    while (!snap.empty) {
      const batch = writeBatch(db)
      snap.docs.slice(0, 400).forEach(d => batch.delete(d.ref))
      await batch.commit()
      if (snap.docs.length <= 400) break
      snap = await getDocs(q)
    }
  }

  // Delete cache docs owned by the user
  for (const col of ['syllabusCache', 'pastPaperCache']) {
    const q = query(collection(db, col), where('userId', '==', uid))
    const snap = await getDocs(q)
    if (!snap.empty) {
      const batch = writeBatch(db)
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
  }

  // Delete all Storage files under resources/{uid}/
  try {
    const userStorageRef = storageRef(storage, `resources/${uid}`)
    const listResult = await listAll(userStorageRef)
    // listAll only lists top-level; recurse one level (resourceId folders)
    await Promise.all(
      listResult.prefixes.map(async (folderRef) => {
        const files = await listAll(folderRef)
        await Promise.all(files.items.map(item => deleteObject(item).catch(() => {})))
      })
    )
  } catch (e) {
    console.warn('Storage cleanup failed, continuing with Auth deletion:', e)
  }

  // Finally delete the Auth account
  await user.delete()
}
