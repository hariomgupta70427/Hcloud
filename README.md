# HCloud - Modern Cloud Storage Web Application

A modern, feature-rich cloud storage web application built with React, TypeScript, Firebase, and Tailwind CSS.

## 🚀 Features

- **Authentication**: Email/password and Google OAuth login
- **File Management**: Upload, download, delete, and organize files
- **Folder Structure**: Create and manage folder hierarchies
- **Real-time Updates**: Live file and folder synchronization
- **Responsive Design**: Works on desktop and mobile devices
- **Dark/Light Theme**: System-aware theme switching
- **File Preview**: Support for images, videos, and documents
- **Search**: Find files and folders quickly
- **Progress Tracking**: Real-time upload progress
- **Storage Management**: Track storage usage and limits
- **Telegram Integration**: Optional notifications via Telegram bot

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, ShadCN UI Components
- **Backend**: Firebase (Auth, Firestore, Storage)
- **State Management**: React Context API
- **Routing**: React Router DOM
- **File Handling**: React Dropzone
- **Icons**: Lucide React
- **Animations**: Framer Motion

## 📦 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── ui/             # ShadCN UI components
│   ├── ProtectedRoute.tsx
│   └── PublicRoute.tsx
├── contexts/           # React Context providers
│   ├── AuthContext.tsx
│   ├── FileContext.tsx
│   └── ThemeContext.tsx
├── hooks/              # Custom React hooks
│   └── use-toast.ts
├── layouts/            # Page layouts
│   └── DashboardLayout.tsx
├── lib/                # Utility libraries
│   ├── firebase.ts
│   └── utils.ts
├── pages/              # Application pages
│   ├── DashboardPage.tsx
│   ├── FilesPage.tsx
│   └── LoginPage.tsx
├── services/           # API services
│   ├── fileService.ts
│   ├── telegramService.ts
│   └── userService.ts
├── App.tsx             # Main application component
├── main.tsx            # Application entry point
├── index.css           # Global styles
└── vite-env.d.ts       # TypeScript environment types
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Firebase project with Authentication, Firestore, and Storage enabled

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hcloud-rebuild
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Firebase**
   - Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
   - Enable Authentication (Email/Password and Google)
   - Enable Firestore Database
   - Enable Storage
   - Copy your Firebase configuration

4. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   > **Anything prefixed `VITE_` is inlined into the client bundle by Vite and is
   > readable by every visitor. Never give a secret a `VITE_` prefix.**
   > `npm run build` runs `scripts/check-bundle-secrets.mjs`, which fails the build
   > if a secret reaches `dist/`.

   Edit `.env` and add your Firebase configuration. These are **not** prefixed —
   `vite.config.ts` injects them via `define`. Firebase web config is public by
   design (it is a set of identifiers, not credentials); security comes from
   Firestore rules, not from hiding these values:
   ```env
   FIREBASE_API_KEY=your_api_key
   FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
   FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   FIREBASE_APP_ID=your_app_id
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## 🔧 Configuration

### Firebase Setup

1. **Authentication**
   - Enable Email/Password authentication
   - Enable Google authentication (optional)
   - Configure authorized domains

2. **Firestore Database**
   - Create a database in production mode
   - Set up security rules (see `firestore.rules`)

3. **Storage**
   - Cloud Storage is **not** used. All file bytes live in Telegram; Firestore holds
     only metadata. There is no `storage.rules`.

### Telegram Integration

Telegram is the storage backend, not an optional notification channel.

1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Get your bot token and the chat/channel ID
3. Add them to `.env` **without** a `VITE_` prefix — these are server-only secrets,
   read by the Vercel functions in `api/` and never sent to the browser:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```

   > A previous version of this file told you to use `VITE_TELEGRAM_BOT_TOKEN`, and
   > `src/services/telegramService.ts` also carried the token as a hardcoded
   > fallback. Both shipped the operator's bot token to every visitor. If you ever
   > see a Telegram credential referenced from anything under `src/`, treat it as a
   > live incident: revoke the token in @BotFather first, then fix the code.

## 🎨 Customization

### Themes

The application supports light, dark, and system themes. You can customize the color scheme by editing the CSS variables in `src/index.css`.

### UI Components

All UI components are built with ShadCN UI and can be customized by editing the files in `src/components/ui/`.

### File Types

Supported file types and their icons can be customized in `src/lib/utils.ts` in the `getFileType` function.

## 📱 Features Overview

### Authentication
- Email/password registration and login
- Google OAuth integration
- Password reset functionality
- User profile management

### File Management
- Drag & drop file uploads
- Multiple file selection
- File and folder operations (create, delete, rename)
- File search and filtering
- Storage usage tracking

### User Interface
- Responsive design for all screen sizes
- Dark/light/system theme support
- Toast notifications
- Loading states and progress indicators
- Modern, clean design

## 🔒 Security

- Firebase Authentication for secure user management
- Firestore security rules for data protection
- Storage security rules for file access control
- Client-side input validation
- Secure file upload handling

## 🚀 Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push

### Netlify

1. Connect your repository to Netlify
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Add environment variables

### Firebase Hosting

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init hosting`
4. Deploy: `firebase deploy`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](../../issues) page
2. Create a new issue with detailed information
3. Include error messages and steps to reproduce

## 🙏 Acknowledgments

- [React](https://reactjs.org/) - UI library
- [Firebase](https://firebase.google.com/) - Backend services
- [Tailwind CSS](https://tailwindcss.com/) - Styling framework
- [ShadCN UI](https://ui.shadcn.com/) - UI components
- [Lucide](https://lucide.dev/) - Icons
- [Vite](https://vitejs.dev/) - Build tool

---

**HCloud** - Modern cloud storage made simple 🚀