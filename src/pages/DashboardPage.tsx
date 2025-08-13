import React, { useEffect, useState } from 'react'
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

export default DashboardPage