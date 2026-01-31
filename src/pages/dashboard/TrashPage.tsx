import { motion } from 'framer-motion';
import { Trash2, RotateCcw, Trash } from 'lucide-react';
import { useState } from 'react';

export default function TrashPage() {
  const [trashedFiles] = useState<any[]>([]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trash</h1>
          <p className="text-muted-foreground mt-1">
            Items in trash are automatically deleted after 30 days
          </p>
        </div>
        
        {trashedFiles.length > 0 && (
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-destructive hover:bg-destructive/10 transition-colors">
            <Trash size={18} />
            Empty Trash
          </button>
        )}
      </div>

      {trashedFiles.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20"
        >
          <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Trash2 className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Trash is empty</h3>
          <p className="text-muted-foreground">Deleted files will appear here</p>
        </motion.div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 text-left">
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Name</th>
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Deleted</th>
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trashedFiles.map((file) => (
                <tr key={file.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4 text-foreground">{file.name}</td>
                  <td className="py-3 px-4 text-muted-foreground">{file.deletedAt}</td>
                  <td className="py-3 px-4 text-right">
                    <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <RotateCcw size={16} />
                    </button>
                    <button className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors ml-1">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
