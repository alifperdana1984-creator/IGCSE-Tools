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
  setDoc
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import type { Assessment, Question, Folder, Resource } from './types'

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

export const getSavedAssessments = async (folderId?: string): Promise<Assessment[]> => {
  if (!auth.currentUser) return []
  const uid = auth.currentUser.uid
  const assessmentsRef = collection(db, 'assessments')

  const ownQuery = folderId
    ? query(assessmentsRef, where('userId', '==', uid), where('folderId', '==', folderId), orderBy('createdAt', 'desc'))
    : query(assessmentsRef, where('userId', '==', uid), orderBy('createdAt', 'desc'))
  const publicQuery = query(assessmentsRef, where('isPublic', '==', true))

  try {
    const [ownSnap, publicSnap] = await Promise.all([getDocs(ownQuery), getDocs(publicQuery)])
    const own = ownSnap.docs.map(d => ({ id: d.id, ...d.data() } as Assessment)).filter(a => Array.isArray(a.questions))
    const pub = publicSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Assessment))
      .filter(a => Array.isArray(a.questions) && a.userId !== uid)
    const ownIds = new Set(own.map(a => a.id))
    const merged = [...own, ...pub.filter(a => !ownIds.has(a.id))]
    return merged.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
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
  subject: string
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
  const metadata = {
    name: file.name,
    subject,
    storagePath: path,
    downloadURL,
    mimeType: file.mimeType,
    userId: uid,
    createdAt: serverTimestamp(),
  }
  await setDoc(docRef, metadata)
  return { id: resourceId, ...metadata, createdAt: Timestamp.now() }
}

export const getResources = async (subject?: string) => {
  if (!auth.currentUser) return [];

  const resourcesRef = collection(db, 'resources');
  let q = query(
    resourcesRef,
    where('userId', '==', auth.currentUser.uid),
    orderBy('createdAt', 'desc')
  );

  if (subject) {
    q = query(
      resourcesRef,
      where('userId', '==', auth.currentUser.uid),
      where('subject', '==', subject),
      orderBy('createdAt', 'desc')
    );
  }

  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as Resource)
      .filter(r => !!r.downloadURL);
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
    await updateDoc(docRef, updates as any)
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
    const [ownSnap, publicSnap] = await Promise.all([getDocs(ownQuery), getDocs(publicQuery)])
    const own = ownSnap.docs.map(d => ({ id: d.id, ...d.data() } as Question)).filter(q => typeof (q as any).text === 'string')
    const pub = publicSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Question))
      .filter(q => typeof (q as any).text === 'string' && q.userId !== uid)
    const ownIds = new Set(own.map(q => q.id))
    const merged = [...own, ...pub.filter(q => !ownIds.has(q.id))]
    return merged.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
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
    await updateDoc(docRef, updates as any)
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
