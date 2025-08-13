#!/usr/bin/env python3
"""
Script to organize all HCloud project files into proper directory structure
with correct file extensions.
"""

import os
import shutil
from pathlib import Path

def organize_project_files():
    """Organize all project files into proper structure"""
    base_dir = Path("d:/Work/Github Repo/Hcloud/HCloud/Hcloud Rebuild")
    
    # File mapping: old_name -> new_path
    file_mappings = {
        # Root files
        'hcloud_web_index_html': 'index.html',
        'hcloud_web_package_json': 'package.json',  # Already exists, skip
        'hcloud_web_postcss_config_js': 'postcss.config.js',  # Already exists, skip
        'hcloud_web_tailwind_config_js': 'tailwind.config.js',  # Already exists, skip
        'hcloud_web_tsconfig_json': 'tsconfig.json',  # Already exists, skip
        'hcloud_web_vite_config_ts': 'vite.config.ts',  # Already exists, skip
        'hcloud_web__env_example': '.env.example',  # Already exists, skip
        
        # Source files
        'hcloud_web_src_main_tsx': 'src/main.tsx',
        'hcloud_web_src_App_tsx': 'src/App.tsx',
        'hcloud_web_src_index_css': 'src/index.css',
        
        # Library files
        'hcloud_web_src_lib_firebase_ts': 'src/lib/firebase.ts',
        'hcloud_web_src_lib_utils_ts': 'src/lib/utils.ts',
        
        # Context files
        'hcloud_web_src_contexts_AuthContext_tsx': 'src/contexts/AuthContext.tsx',
        'hcloud_web_src_contexts_FileContext_tsx': 'src/contexts/FileContext.tsx',
        'hcloud_web_src_contexts_ThemeContext_tsx': 'src/contexts/ThemeContext.tsx',
        
        # Service files
        'hcloud_web_src_services_userService_ts': 'src/services/userService.ts',
        'hcloud_web_src_services_fileService_ts': 'src/services/fileService.ts',
        'hcloud_web_src_services_telegramService_ts': 'src/services/telegramService.ts',
        
        # UI Components
        'hcloud_web_src_components_ui_button_tsx': 'src/components/ui/button.tsx',
        'hcloud_web_src_components_ui_input_tsx': 'src/components/ui/input.tsx',
        'hcloud_web_src_components_ui_card_tsx': 'src/components/ui/card.tsx',
        'hcloud_web_src_components_ui_dialog_tsx': 'src/components/ui/dialog.tsx',
        'hcloud_web_src_components_ui_avatar_tsx': 'src/components/ui/avatar.tsx',
        'hcloud_web_src_components_ui_progress_tsx': 'src/components/ui/progress.tsx',
        'hcloud_web_src_components_ui_toaster_tsx': 'src/components/ui/toaster.tsx',
        'hcloud_web_src_components_ui_toast_tsx': 'src/components/ui/toast.tsx',
        
        # Components
        'hcloud_web_src_components_ProtectedRoute_tsx': 'src/components/ProtectedRoute.tsx',
        'hcloud_web_src_components_PublicRoute_tsx': 'src/components/PublicRoute.tsx',
        
        # Hooks
        'hcloud_web_src_hooks_use-toast_ts': 'src/hooks/use-toast.ts',
        
        # Pages
        'hcloud_web_src_pages_LoginPage_tsx': 'src/pages/LoginPage.tsx',
        'hcloud_web_src_pages_DashboardPage_tsx': 'src/pages/DashboardPage.tsx',
        'hcloud_web_src_pages_FilesPage_tsx': 'src/pages/FilesPage.tsx',
        
        # Layouts
        'hcloud_web_src_layouts_DashboardLayout_tsx': 'src/layouts/DashboardLayout.tsx',
    }
    
    print("🚀 Organizing HCloud project files...")
    print(f"📁 Base directory: {base_dir}")
    
    created_dirs = set()
    moved_files = 0
    
    for old_name, new_path in file_mappings.items():
        old_file = base_dir / old_name
        new_file = base_dir / new_path
        
        if not old_file.exists():
            print(f"⚠️  Source file not found: {old_name}")
            continue
            
        # Create directory if it doesn't exist
        new_dir = new_file.parent
        if new_dir not in created_dirs and not new_dir.exists():
            new_dir.mkdir(parents=True, exist_ok=True)
            created_dirs.add(new_dir)
            print(f"📂 Created directory: {new_dir.relative_to(base_dir)}")
        
        # Skip if target already exists (from previous runs)
        if new_file.exists():
            print(f"⏭️  Skipping (already exists): {new_path}")
            # Remove the old file since we have the new one
            old_file.unlink()
            continue
            
        # Move and rename the file
        try:
            shutil.move(str(old_file), str(new_file))
            print(f"✅ Moved: {old_name} → {new_path}")
            moved_files += 1
        except Exception as e:
            print(f"❌ Failed to move {old_name}: {str(e)}")
    
    print(f"\n🎉 Successfully organized {moved_files} files!")
    print(f"📂 Created {len(created_dirs)} directories")
    
    # Show final project structure
    print("\n📋 Final Project Structure:")
    show_tree(base_dir, max_depth=3)

def show_tree(directory, prefix="", max_depth=3, current_depth=0):
    """Display directory tree structure"""
    if current_depth >= max_depth:
        return
        
    directory = Path(directory)
    items = []
    
    # Get all items and sort them
    try:
        all_items = list(directory.iterdir())
        # Separate directories and files
        dirs = [item for item in all_items if item.is_dir() and not item.name.startswith('.') and item.name != '__pycache__']
        files = [item for item in all_items if item.is_file() and not item.name.startswith('.') and not item.name.endswith('.py')]
        
        # Sort both lists
        dirs.sort(key=lambda x: x.name.lower())
        files.sort(key=lambda x: x.name.lower())
        
        items = dirs + files
    except PermissionError:
        return
    
    for i, item in enumerate(items):
        is_last = i == len(items) - 1
        current_prefix = "└── " if is_last else "├── "
        print(f"{prefix}{current_prefix}{item.name}")
        
        if item.is_dir() and current_depth < max_depth - 1:
            extension = "    " if is_last else "│   "
            show_tree(item, prefix + extension, max_depth, current_depth + 1)

if __name__ == "__main__":
    organize_project_files()