import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

interface FolderBreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate?: (id: string | null) => void;
}

export function FolderBreadcrumb({ items, onNavigate }: FolderBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      {items.map((item, index) => (
        <div key={item.id ?? 'root'} className="flex items-center gap-1">
          {index > 0 && (
            <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
          )}
          {index === items.length - 1 ? (
            <span className="p-1.5 text-foreground font-medium flex items-center gap-1">
              {index === 0 && <Home size={14} />}
              {item.name}
            </span>
          ) : (
            <button
              onClick={() => onNavigate?.(item.id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
            >
              {index === 0 && <Home size={14} />}
              {item.name}
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}
