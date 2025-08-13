# Create Firebase service files

service_files = {}

# 1. User Service
service_files['src/services/userService.ts'] = '''import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { UserProfile } from '@/contexts/AuthContext'

export const createUserDocument = async (userProfile: UserProfile): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userProfile.uid)
    await setDoc(userRef, {
      ...userProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true })
  } catch (error) {
    console.error('Error creating user document:', error)
    throw error
  }
}

export const getUserDocument = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userRef = doc(db, 'users', uid)
    const userSnap = await getDoc(userRef)
    
    if (userSnap.exists()) {
      const data = userSnap.data()
      return {
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
        photoURL: data.photoURL,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        storageUsed: data.storageUsed || 0,
        storageLimit: data.storageLimit || (5 * 1024 * 1024 * 1024),
        plan: data.plan || 'free'
      }
    }
    
    return null
  } catch (error) {
    console.error('Error getting user document:', error)
    throw error
  }
}

export const updateUserDocument = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      ...updates,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating user document:', error)
    throw error
  }
}

export const deleteUserDocument = async (uid: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await deleteDoc(userRef)
  } catch (error) {
    console.error('Error deleting user document:', error)
    throw error
  }
}

export const updateStorageUsage = async (uid: string, bytesUsed: number): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      storageUsed: bytesUsed,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating storage usage:', error)
    throw error
  }
}'''

# 2. File Service
service_files['src/services/fileService.ts'] = '''import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  getMetadata
} from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { FileItem } from '@/contexts/FileContext'
import { generateId, getFileType } from '@/lib/utils'
import { updateStorageUsage, getUserDocument } from './userService'

export const uploadFile = async (
  file: File,
  userId: string,
  folderId: string | null = null,
  onProgress?: (progress: number) => void
): Promise<FileItem> => {
  try {
    const fileId = generateId()
    const fileName = `${fileId}_${file.name}`
    const storageRef = ref(storage, `files/${userId}/${fileName}`)
    
    // Start upload
    const uploadTask = uploadBytesResumable(storageRef, file)
    
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          onProgress?.(progress)
        },
        (error) => {
          console.error('Upload error:', error)
          reject(error)
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref)
            const metadata = await getMetadata(uploadTask.snapshot.ref)
            
            // Create file document
            const fileData: Omit<FileItem, 'id'> = {
              name: file.name,
              type: 'file',
              fileType: getFileType(file.name),
              size: file.size,
              url: downloadURL,
              parentId: folderId,
              userId,
              createdAt: new Date(),
              updatedAt: new Date(),
              shared: false,
              starred: false,
              tags: [],
              metadata: {
                contentType: metadata.contentType,
                customMetadata: metadata.customMetadata
              }
            }
            
            const docRef = await addDoc(collection(db, 'files'), {
              ...fileData,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            })
            
            // Update user storage usage
            const userProfile = await getUserDocument(userId)
            if (userProfile) {
              await updateStorageUsage(userId, userProfile.storageUsed + file.size)
            }
            
            const fileItem: FileItem = {
              id: docRef.id,
              ...fileData
            }
            
            resolve(fileItem)
          } catch (error) {
            reject(error)
          }
        }
      )
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    throw error
  }
}

export const getFiles = async (userId: string, folderId: string | null = null): Promise<FileItem[]> => {
  try {
    const filesRef = collection(db, 'files')
    const q = query(
      filesRef,
      where('userId', '==', userId),
      where('type', '==', 'file'),
      where('parentId', '==', folderId),
      orderBy('updatedAt', 'desc')
    )
    
    const querySnapshot = await getDocs(q)
    const files: FileItem[] = []
    
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      files.push({
        id: doc.id,
        name: data.name,
        type: data.type,
        fileType: data.fileType,
        size: data.size,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl,
        parentId: data.parentId,
        userId: data.userId,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        shared: data.shared || false,
        starred: data.starred || false,
        tags: data.tags || [],
        metadata: data.metadata || {}
      })
    })
    
    return files
  } catch (error) {
    console.error('Error getting files:', error)
    throw error
  }
}

export const getFolders = async (userId: string, parentId: string | null = null): Promise<FileItem[]> => {
  try {
    const foldersRef = collection(db, 'files')
    const q = query(
      foldersRef,
      where('userId', '==', userId),
      where('type', '==', 'folder'),
      where('parentId', '==', parentId),
      orderBy('name', 'asc')
    )
    
    const querySnapshot = await getDocs(q)
    const folders: FileItem[] = []
    
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      folders.push({
        id: doc.id,
        name: data.name,
        type: data.type,
        size: 0,
        parentId: data.parentId,
        userId: data.userId,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        shared: data.shared || false,
        starred: data.starred || false,
        tags: data.tags || []
      })
    })
    
    return folders
  } catch (error) {
    console.error('Error getting folders:', error)
    throw error
  }
}

export const createFolder = async (
  name: string,
  userId: string,
  parentId: string | null = null
): Promise<FileItem> => {
  try {
    const folderData: Omit<FileItem, 'id'> = {
      name,
      type: 'folder',
      size: 0,
      parentId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      shared: false,
      starred: false,
      tags: []
    }
    
    const docRef = await addDoc(collection(db, 'files'), {
      ...folderData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    
    return {
      id: docRef.id,
      ...folderData
    }
  } catch (error) {
    console.error('Error creating folder:', error)
    throw error
  }
}

export const deleteFile = async (fileId: string, userId: string): Promise<void> => {
  try {
    const fileRef = doc(db, 'files', fileId)
    const fileSnap = await getDoc(fileRef)
    
    if (!fileSnap.exists()) {
      throw new Error('File not found')
    }
    
    const fileData = fileSnap.data()
    
    // Verify ownership
    if (fileData.userId !== userId) {
      throw new Error('Unauthorized')
    }
    
    // Delete from storage if it's a file
    if (fileData.type === 'file' && fileData.url) {
      try {
        const storageRef = ref(storage, fileData.url)
        await deleteObject(storageRef)
        
        // Update user storage usage
        const userProfile = await getUserDocument(userId)
        if (userProfile) {
          await updateStorageUsage(userId, Math.max(0, userProfile.storageUsed - fileData.size))
        }
      } catch (storageError) {
        console.warn('Error deleting from storage:', storageError)
      }
    }
    
    // Delete document
    await deleteDoc(fileRef)
  } catch (error) {
    console.error('Error deleting file:', error)
    throw error
  }
}

export const deleteFolder = async (folderId: string, userId: string): Promise<void> => {
  try {
    const batch = writeBatch(db)
    
    // Get all files and subfolders in this folder
    const filesQuery = query(
      collection(db, 'files'),
      where('parentId', '==', folderId),
      where('userId', '==', userId)
    )
    
    const filesSnapshot = await getDocs(filesQuery)
    
    // Delete all files and subfolders recursively
    for (const docSnap of filesSnapshot.docs) {
      const data = docSnap.data()
      if (data.type === 'folder') {
        await deleteFolder(docSnap.id, userId)
      } else {
        await deleteFile(docSnap.id, userId)
      }
    }
    
    // Delete the folder itself
    const folderRef = doc(db, 'files', folderId)
    await deleteDoc(folderRef)
  } catch (error) {
    console.error('Error deleting folder:', error)
    throw error
  }
}

export const updateFile = async (
  fileId: string,
  userId: string,
  updates: Partial<FileItem>
): Promise<void> => {
  try {
    const fileRef = doc(db, 'files', fileId)
    const fileSnap = await getDoc(fileRef)
    
    if (!fileSnap.exists()) {
      throw new Error('File not found')
    }
    
    const fileData = fileSnap.data()
    if (fileData.userId !== userId) {
      throw new Error('Unauthorized')
    }
    
    await updateDoc(fileRef, {
      ...updates,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating file:', error)
    throw error
  }
}

export const moveFile = async (
  fileId: string,
  userId: string,
  targetFolderId: string | null
): Promise<void> => {
  try {
    await updateFile(fileId, userId, { parentId: targetFolderId })
  } catch (error) {
    console.error('Error moving file:', error)
    throw error
  }
}

export const searchFiles = async (userId: string, searchQuery: string): Promise<FileItem[]> => {
  try {
    const filesRef = collection(db, 'files')
    const q = query(
      filesRef,
      where('userId', '==', userId),
      orderBy('name')
    )
    
    const querySnapshot = await getDocs(q)
    const allFiles: FileItem[] = []
    
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      allFiles.push({
        id: doc.id,
        name: data.name,
        type: data.type,
        fileType: data.fileType,
        size: data.size,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl,
        parentId: data.parentId,
        userId: data.userId,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        shared: data.shared || false,
        starred: data.starred || false,
        tags: data.tags || [],
        metadata: data.metadata || {}
      })
    })
    
    // Filter files based on search query
    const searchTerm = searchQuery.toLowerCase()
    return allFiles.filter(file => 
      file.name.toLowerCase().includes(searchTerm) ||
      file.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    )
  } catch (error) {
    console.error('Error searching files:', error)
    throw error
  }
}

export const downloadFile = async (fileId: string, userId: string): Promise<void> => {
  try {
    const fileRef = doc(db, 'files', fileId)
    const fileSnap = await getDoc(fileRef)
    
    if (!fileSnap.exists()) {
      throw new Error('File not found')
    }
    
    const fileData = fileSnap.data()
    if (fileData.userId !== userId && !fileData.shared) {
      throw new Error('Unauthorized')
    }
    
    if (fileData.url) {
      // Create a temporary anchor element to trigger download
      const link = document.createElement('a')
      link.href = fileData.url
      link.download = fileData.name
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  } catch (error) {
    console.error('Error downloading file:', error)
    throw error
  }
}'''

# 3. Telegram Service (for integration)
service_files['src/services/telegramService.ts'] = '''interface TelegramConfig {
  botToken: string
  chatId: string
}

class TelegramService {
  private config: TelegramConfig | null = null

  constructor() {
    this.initConfig()
  }

  private initConfig() {
    const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN
    const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      this.config = { botToken, chatId }
    }
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  async sendMessage(message: string): Promise<boolean> {
    if (!this.config) {
      console.warn('Telegram service not configured')
      return false
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: this.config.chatId,
            text: message,
            parse_mode: 'HTML'
          })
        }
      )

      return response.ok
    } catch (error) {
      console.error('Failed to send Telegram message:', error)
      return false
    }
  }

  async sendFileNotification(fileName: string, fileSize: number, userName: string): Promise<boolean> {
    const message = `
📁 <b>New File Uploaded</b>
📝 <b>File:</b> ${fileName}
📊 <b>Size:</b> ${this.formatBytes(fileSize)}
👤 <b>User:</b> ${userName}
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  async sendUserRegistrationNotification(userName: string, userEmail: string): Promise<boolean> {
    const message = `
🎉 <b>New User Registered</b>
👤 <b>Name:</b> ${userName}
📧 <b>Email:</b> ${userEmail}
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  async sendStorageAlert(userName: string, storageUsed: number, storageLimit: number): Promise<boolean> {
    const percentage = (storageUsed / storageLimit) * 100
    
    const message = `
⚠️ <b>Storage Alert</b>
👤 <b>User:</b> ${userName}
📊 <b>Usage:</b> ${this.formatBytes(storageUsed)} / ${this.formatBytes(storageLimit)} (${percentage.toFixed(1)}%)
🕒 <b>Time:</b> ${new Date().toLocaleString()}
    `.trim()

    return this.sendMessage(message)
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}

export const telegramService = new TelegramService()'''

print("✅ Created Firebase services:")
for filename in service_files.keys():
    print(f"  📄 {filename}")

# Save all service files
for filename, content in service_files.items():
    with open(f"hcloud_web_{filename.replace('/', '_').replace('.', '_')}", 'w', encoding='utf-8') as f:
        f.write(content)

print(f"\n📦 Total service files: {len(service_files)}")
print("\n🔧 These services provide:")
print("• Complete CRUD operations for users and files")
print("• Firebase Storage integration for file uploads")
print("• Firestore database operations")
print("• Real-time progress tracking for uploads")
print("• Telegram integration for notifications")
print("• File search and filtering capabilities")