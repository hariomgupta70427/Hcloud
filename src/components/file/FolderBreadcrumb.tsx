import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  id: string;
  name: string;
  path: string;
}

interface FolderBreadcrumbProps {
  items: BreadcrumbItem[];
}

export function FolderBreadcrumb({ items }: FolderBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link
        to="/dashboard/files"
        className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Home size={16} />
        <span>My Files</span>
      </Link>

      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1">
          <ChevronRight size={16} className="text-muted-foreground" />
          {index === items.length - 1 ? (
            <span className="p-1.5 text-foreground font-medium">
              {item.name}
            </span>
          ) : (
            <Link
              to={item.path}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {item.name}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
