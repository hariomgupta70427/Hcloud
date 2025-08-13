import os
import sys

# Add the script directory to path to import the project_files
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the project_files dictionary from script.py
with open('script.py', 'r', encoding='utf-8') as f:
    exec(f.read())

def create_project_files():
    """Create all project files from the project_files dictionary"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    print(f"🚀 Creating HCloud project files in: {base_dir}")
    print(f"📁 Total files to create: {len(project_files)}")
    
    created_count = 0
    
    for file_path, content in project_files.items():
        full_path = os.path.join(base_dir, file_path)
        
        # Create directory if it doesn't exist
        dir_path = os.path.dirname(full_path)
        if dir_path and not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
            print(f"📂 Created directory: {dir_path}")
        
        # Write the file
        try:
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content.strip())
            print(f"✅ Created: {file_path}")
            created_count += 1
        except Exception as e:
            print(f"❌ Failed to create {file_path}: {str(e)}")
    
    print(f"\n🎉 Successfully created {created_count}/{len(project_files)} files!")
    print("\n📋 Project Structure:")
    print("├── package.json")
    print("├── next.config.js") 
    print("├── tsconfig.json")
    print("├── tailwind.config.js")
    print("├── .env.example")
    print("└── src/")
    print("    ├── app/")
    print("    │   ├── layout.tsx")
    print("    │   └── page.tsx")
    print("    ├── components/")
    print("    │   └── ui/")
    print("    ├── contexts/")
    print("    ├── lib/")
    print("    ├── styles/")
    print("    └── types/")
    
    print("\n🔧 Next steps:")
    print("1. Copy .env.example to .env.local and add your Firebase config")
    print("2. Run: npm install")
    print("3. Run: npm run dev")
    print("4. Open http://localhost:3000")

if __name__ == "__main__":
    create_project_files()