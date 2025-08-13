# Create the main application pages and file management components

main_pages = {}

# 1. Dashboard Page
main_pages['src/pages/DashboardPage.tsx'] = '''import React, { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useFiles } from '@/contexts/FileContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/utils'
import {
  Cloud,
  FolderOpen,
  FileText,
  Image,
  Video,
  Music,
  Archive,
  TrendingUp,
  Upload,
  Star,
  Users
} from 'lucide-react'

const DashboardPage: React.FC = () => {
  const { userProfile } = useAuth()
  const { files, folders, refreshFiles } = useFiles()
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalFolders: 0,
    storageUsed: 0,
    fileTypes: {
      images: 0,
      videos: 0,
      documents: 0,
      audio: 0,
      archives: 0,
      others: 0
    }
  })

  useEffect(() => {
    refreshFiles()
  }, [refreshFiles])

  useEffect(() => {
    // Calculate stats from files
    const fileStats = files.reduce((acc, file) => {
      acc.totalFiles++
      acc.storageUsed += file.size
      
      switch (file.fileType) {
        case 'image':
          acc.fileTypes.images++
          break
        case 'video':
          acc.fileTypes.videos++
          break
        case 'document':
        case 'spreadsheet':
        case 'presentation':
          acc.fileTypes.documents++
          break
        case 'audio':
          acc.fileTypes.audio++
          break
        case 'archive':
          acc.fileTypes.archives++
          break
        default:
          acc.fileTypes.others++
      }
      
      return acc
    }, {
      totalFiles: 0,
      totalFolders: folders.length,
      storageUsed: 0,
      fileTypes: {
        images: 0,
        videos: 0,
        documents: 0,
        audio: 0,
        archives: 0,
        others: 0
      }
    })

    setStats(fileStats)
  }, [files, folders])

  const storagePercentage = userProfile 
    ? (userProfile.storageUsed / userProfile.storageLimit) * 100 
    : 0

  const recentFiles = files
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5)

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image':
        return <Image className="h-4 w-4 text-green-500" />
      case 'video':
        return <Video className="h-4 w-4 text-red-500" />
      case 'audio':
        return <Music className="h-4 w-4 text-purple-500" />
      case 'document':
      case 'spreadsheet':
      case 'presentation':
        return <FileText className="h-4 w-4 text-blue-500" />
      case 'archive':
        return <Archive className="h-4 w-4 text-orange-500" />
      default:
        return <FileText className="h-4 w-4 text-gray-500" />
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Welcome header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome back, {userProfile?.displayName || 'User'}!
          </h1>
          <p className="text-muted-foreground mt-2">
            Here's what's happening with your files today.
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <Upload className="mr-2 h-4 w-4" />
          Upload Files
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Files</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalFiles}</div>
            <p className="text-xs text-muted-foreground">
              Across all folders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Folders</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalFolders}</div>
            <p className="text-xs text-muted-foreground">
              Organized collections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
            <Cloud className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatBytes(userProfile?.storageUsed || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              of {formatBytes(userProfile?.storageLimit || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Plan</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {userProfile?.plan || 'Free'}
            </div>
            <p className="text-xs text-muted-foreground">
              Current subscription
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Storage overview */}
        <Card>
          <CardHeader>
            <CardTitle>Storage Overview</CardTitle>
            <CardDescription>
              Your current storage usage breakdown
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Used Storage</span>
                <span>{storagePercentage.toFixed(1)}%</span>
              </div>
              <Progress value={storagePercentage} className="h-2" />
              <div className="text-xs text-muted-foreground">
                {formatBytes(userProfile?.storageUsed || 0)} of {formatBytes(userProfile?.storageLimit || 0)}
              </div>
            </div>

            <div className="space-y-3">
              {Object.entries(stats.fileTypes).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {getFileIcon(type)}
                    <span className="text-sm capitalize">{type}</span>
                  </div>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent files */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Files</CardTitle>
            <CardDescription>
              Your recently uploaded or modified files
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentFiles.length > 0 ? (
              <div className="space-y-3">
                {recentFiles.map((file) => (
                  <div key={file.id} className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      {getFileIcon(file.fileType || '')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(file.size)} • {file.updatedAt.toLocaleDateString()}
                      </p>
                    </div>
                    {file.starred && (
                      <Star className="h-4 w-4 text-yellow-500 fill-current" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No files yet</p>
                <p className="text-xs">Upload your first file to get started</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Common tasks to help you manage your files
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button variant="outline" className="h-20 flex-col">
              <Upload className="h-6 w-6 mb-2" />
              Upload Files
            </Button>
            <Button variant="outline" className="h-20 flex-col">
              <FolderOpen className="h-6 w-6 mb-2" />
              Create Folder
            </Button>
            <Button variant="outline" className="h-20 flex-col">
              <Users className="h-6 w-6 mb-2" />
              Share Files
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default DashboardPage'''

# 2. Files Page
main_pages['src/pages/FilesPage.tsx'] = '''import React, { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useFiles } from '@/contexts/FileContext'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { formatBytes, formatDate } from '@/lib/utils'
import {
  Upload,
  FolderPlus,
  Search,
  Grid3X3,
  List,
  Star,
  Share,
  Download,
  Trash2,
  MoreHorizontal,
  File,
  Folder,
  Image,
  Video,
  Music,
  FileText,
  Archive
} from 'lucide-react'

const FilesPage: React.FC = () => {
  const { folderId } = useParams<{ folderId: string }>()
  const {
    files,
    folders,
    currentFolderId,
    uploadProgress,
    loading,
    uploadFiles,
    createNewFolder,
    deleteFiles,
    toggleStarFile,
    toggleShareFile,
    setCurrentFolderId,
    selectedFileIds,
    selectFiles,
    clearSelection
  } = useFiles()

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  // Update current folder when URL changes
  React.useEffect(() => {
    if (folderId !== currentFolderId) {
      setCurrentFolderId(folderId || null)
    }
  }, [folderId, currentFolderId, setCurrentFolderId])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    try {
      await uploadFiles(acceptedFiles, currentFolderId)
      toast({
        title: "Upload started",
        description: `Uploading ${acceptedFiles.length} file(s)`
      })
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Please try again",
        variant: "destructive"
      })
    }
  }, [uploadFiles, currentFolderId, toast])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    multiple: true
  })

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return

    try {
      await createNewFolder(folderName.trim(), currentFolderId)
      setShowCreateFolder(false)
      setFolderName('')
      toast({
        title: "Folder created",
        description: `"${folderName}" has been created`
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create folder",
        variant: "destructive"
      })
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) return

    try {
      await deleteFiles(Array.from(selectedFiles))
      setSelectedFiles(new Set())
      toast({
        title: "Files deleted",
        description: `${selectedFiles.size} file(s) deleted`
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete files",
        variant: "destructive"
      })
    }
  }

  const toggleFileSelection = (fileId: string) => {
    const newSelection = new Set(selectedFiles)
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId)
    } else {
      newSelection.add(fileId)
    }
    setSelectedFiles(newSelection)
  }

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image':
        return <Image className="h-8 w-8 text-green-500" />
      case 'video':
        return <Video className="h-8 w-8 text-red-500" />
      case 'audio':
        return <Music className="h-8 w-8 text-purple-500" />
      case 'document':
      case 'spreadsheet':
      case 'presentation':
        return <FileText className="h-8 w-8 text-blue-500" />
      case 'archive':
        return <Archive className="h-8 w-8 text-orange-500" />
      default:
        return <File className="h-8 w-8 text-gray-500" />
    }
  }

  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredFolders = folders.filter(folder =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div {...getRootProps()} className={`h-full ${isDragActive ? 'drag-active' : ''}`}>
      <input {...getInputProps()} />
      
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Files</h1>
            <p className="text-muted-foreground">
              Manage your files and folders
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCreateFolder(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files and folders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {selectedFiles.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedFiles.size})
              </Button>
            )}
            
            <Button
              variant="outline"
              size="icon"
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            >
              {viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Upload Progress */}
        {uploadProgress.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="space-y-2">
                {uploadProgress.map((upload) => (
                  <div key={upload.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{upload.name}</span>
                      <span>{upload.progress}%</span>
                    </div>
                    <Progress value={upload.progress} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Files and Folders */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {filteredFolders.map((folder) => (
              <Card
                key={folder.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${
                  selectedFiles.has(folder.id) ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => setCurrentFolderId(folder.id)}
              >
                <CardContent className="p-0 flex flex-col items-center text-center space-y-2">
                  <Folder className="h-12 w-12 text-blue-500" />
                  <p className="text-sm font-medium truncate w-full">{folder.name}</p>
                  <div className="flex items-center space-x-1">
                    {folder.starred && <Star className="h-3 w-3 text-yellow-500 fill-current" />}
                    {folder.shared && <Share className="h-3 w-3 text-green-500" />}
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredFiles.map((file) => (
              <Card
                key={file.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${
                  selectedFiles.has(file.id) ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => toggleFileSelection(file.id)}
              >
                <CardContent className="p-0 flex flex-col items-center text-center space-y-2">
                  {getFileIcon(file.fileType || '')}
                  <p className="text-sm font-medium truncate w-full">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  <div className="flex items-center space-x-1">
                    {file.starred && <Star className="h-3 w-3 text-yellow-500 fill-current" />}
                    {file.shared && <Share className="h-3 w-3 text-green-500" />}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredFolders.map((folder) => (
              <Card
                key={folder.id}
                className={`p-3 cursor-pointer hover:bg-accent transition-colors ${
                  selectedFiles.has(folder.id) ? 'bg-accent' : ''
                }`}
                onClick={() => setCurrentFolderId(folder.id)}
              >
                <div className="flex items-center space-x-3">
                  <Folder className="h-5 w-5 text-blue-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{folder.name}</p>
                  </div>
                  <div className="flex items-center space-x-2 text-muted-foreground">
                    <span className="text-sm">{formatDate(folder.updatedAt)}</span>
                    {folder.starred && <Star className="h-4 w-4 text-yellow-500 fill-current" />}
                    {folder.shared && <Share className="h-4 w-4 text-green-500" />}
                  </div>
                </div>
              </Card>
            ))}

            {filteredFiles.map((file) => (
              <Card
                key={file.id}
                className={`p-3 cursor-pointer hover:bg-accent transition-colors ${
                  selectedFiles.has(file.id) ? 'bg-accent' : ''
                }`}
                onClick={() => toggleFileSelection(file.id)}
              >
                <div className="flex items-center space-x-3">
                  {getFileIcon(file.fileType || '')}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 text-muted-foreground">
                    <span className="text-sm">{formatDate(file.updatedAt)}</span>
                    {file.starred && <Star className="h-4 w-4 text-yellow-500 fill-current" />}
                    {file.shared && <Share className="h-4 w-4 text-green-500" />}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {filteredFiles.length === 0 && filteredFolders.length === 0 && !loading && (
          <div className="text-center py-12">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No files yet</h3>
            <p className="text-muted-foreground mb-4">
              Drag and drop files here or click upload to get started
            </p>
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          </div>
        )}

        {/* Drag overlay */}
        {isDragActive && (
          <div className="fixed inset-0 bg-primary/10 border-2 border-dashed border-primary z-50 flex items-center justify-center">
            <div className="text-center">
              <Upload className="h-16 w-16 mx-auto text-primary mb-4" />
              <h3 className="text-xl font-semibold text-primary">Drop files here</h3>
              <p className="text-muted-foreground">Release to upload your files</p>
            </div>
          </div>
        )}
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Enter a name for your new folder
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default FilesPage'''

print("✅ Created main application pages:")
for filename in main_pages.keys():
    print(f"  📄 {filename}")

# Save all main page files
for filename, content in main_pages.items():
    with open(f"hcloud_web_{filename.replace('/', '_').replace('.', '_')}", 'w') as f:
        f.write(content)

print(f"\n📦 Total main page files: {len(main_pages)}")
print("\n🔧 These pages provide:")
print("• Dashboard with analytics and file overview")
print("• File browser with drag & drop upload")
print("• Grid and list view modes")
print("• File search and filtering")
print("• Folder creation and management")
print("• File selection and bulk operations")