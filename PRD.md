**HCloud–** **ProductRequirementsDocument** **Overview&** **Goals**

HCloud is an enterprise-grade **web** **and** **mobile** **cloud**
**storage** **platform** that provides effectively *unlimited* storage
by leveraging Telegram’s free media storage. It will use a modern tech
stack (Node.js backend, Next.js/React frontend, Firebase Auth, Flutter
mobile app) and offer an app-like experience in the browser (PWA
support, “add to home screen”). Crucially, **end** **users** **should**
**never** **see** **“Telegram”** **branding** **in** **the** **UI**,
even though files are stored on Telegram’s servers behind the scenes.
The product must feel **premium** (custom color palettes, smooth
animations, refined UI/UX) and handle everything **transparently** so
the user need not do any Telegram-specific setup (no manual bot invites
or credential handling). Users get two storagemodesonsignup:

> •**“Use Your Own Server ”mode**(data saved to*user’sown* Telegram account):the user logs in with their
> phone number(TelegramAPIloginviaSMS) and HCloud forwards files to their **SavedMessages**.
> HCloud stores only metadata/IDs.
>
> •**“Use HCloud Server”mode**(data saved to HCloud’sTelegram account):HCloud stores files via its own Telegrambot/account.All files are still on Telegram servers,butHCloud  controlsthestorage.

Users pick one mode at registration (no mixing or switching later, to avoid migration complexity). Both
modes deliver the promised unlimited storage since Telegram imposes no overall quota. HCloudwill provide all file actions (upload, list, preview, share,
download, delete, etc.) in a polished web/mobile interface,with **only the current user’s files visible**.

Key architectural components:

\- **Frontend:** Next.js (React) web app (with TypeScript and Tailwind/ShadCN UI for styling), use Firebase Auth (email/password + Google SSO). The web app is built as a Progressive WebApp(PWA)so it can be added to home screens


\- **Backend:** Node.js with Express (or similar). Uses Firebase Admin SDK to verify client ID tokens. Stores metadata (e.g. file list, Telegram file IDs/URLs) in a database like Firestore or a cloud database. Handles Telegram Bot API calls to send/get files. All secrets (Telegram bot token, API ID/hash if needed,
Firebase servicekey)areinenvironmentvariables.

\- **Authentication:** Firebase Auth for HCloud accounts. For “Use Your Server” mode, we’ll additionally perform Telegram’s phone-number authentication (sending code via SMS through Telegram) to link the user’s Telegram identity. This is required because only Telegram’s own API allows accessing the user’s Saved Messages. The UI will label this step generically (e.g. “Verify with your mobile number”) without mentioningTelegram.

**High-Level Data Flow**

> •**Sign-up/Login:**User creates an account(email/password or Google).If choosing “UseTelegram” mode,they immediately enter their phone number to link their Telegram account(Telegram sends SMS,user confirms code The backend obtains a Telegram **userauthorization**(login) session for that user.**FileUpload:** The web/mobile app uploads files to the Node backend. Backend receives the file,verifies the Firebase ID token to get uid then calls Telegram’s Bot API:
•	In “Use Your own server” mode, the backend calls sendDocument (or sendPhoto/sendVideo) to send the file to the user’s Telegram Saved Messages (the user’s own private chat) via the bot. Alternatively, if Telegram API requires it, the user could have a private channel or the bot forwards the file to the user’s chat. (From the user’s perspective the file ends up in their Telegram “saved messages” storage.)
•	In “HCloud Server” mode, the backend calls sendDocument to a dedicated HCloud Telegram channel or account. Each user’s files can be organized by HCloud’s account (e.g. by tagging )
On success, Telegram returns a File object (including a file_id and path)[5]. The backend stores the file_id, original filename, size, type, timestamp, etc. in the database under the user’s UID. It also optionally creates a thumbnail URL (Telegram can generate thumbnails for images/videos).
•	File Listing: When a user views their dashboard, the frontend calls an endpoint like GET /files. The backend looks up that user’s metadata from the database and returns an array of files. Each entry includes the Telegram file_id, name, type, size, and a flag if it’s shared or starred.
•	File Download: To download or stream a file, the frontend calls an endpoint like GET /files/:fileId. The backend looks up the Telegram file_id and calls Telegram’s getFile method to obtain a download URL[5]. Telegram returns a link (e.g. https://api.telegram.org/file/bot<token>/<file_path>) that is valid for at least 1 hour[5]. HCloud can either redirect the user to that link or proxy the file through its server to the client. In either case, the user’s browser downloads the file from Telegram’s server. (For videos/audio, the same link can be fed to the HTML5 player as a source.)
•	File Sharing: When a user creates a public or private share link, the backend generates a secure token (e.g. UUID) and maps it to that file. It then provides a URL like https://hcloud.app/share/<token>. When someone opens it, the backend verifies the token and streams the file (same flow: calls Telegram getFile then serves the content). This allows sharing without exposing Telegram details. A thumbnail or preview can be shown (e.g. images/videos/PDFs inline) before download.
•	Folder/Metadata Management: File metadata (names, parent folder ID, tags, star/favorite, shared flag, etc.) are stored in Firestore or a similar DB under collections like /files/{fileId} with fields (userId, name, type, size, fileType, file_id, thumbnailUrl, parentId, shared, starred, tags, createdAt, etc.)[6]. Security rules ensure only the owner can read/write these (e.g. allow read, write: if request.auth.uid == resource.data.userId[6]).
•	Notifications: We will send user notifications (via email or in-app) for events like new file uploads, quota usage, or daily summary. If feasible, we can also integrate Telegram bot messages to notify users in their Telegram (since we may have a bot linked) – e.g. “Your file has been uploaded successfully.”
Architecture & Components
•	Node.js Backend: Built with Express or similar. Key modules:
•	Firebase Admin SDK to verify ID tokens on each request (ensuring request.auth.uid matches)[4].
•	Telegram Bot API Client: e.g. using [node-telegram-bot-api] or custom calls. Handles sendDocument, getFile, etc. Environment variables hold TELEGRAM_BOT_TOKEN (and, if we use the Telegram Core API for phone login, an API_ID/API_HASH). The server never hardcodes user credentials.
•	Database: Likely Firestore Stores user profiles and file metadata. Firestore rules will mirror patterns like match /files/{fileId} { allow read, write: if request.auth.uid == resource.data.userId; }[6]. We store for each file: owner UID, Telegram file_id, file name/type/size, parent folder, thumbnail URL, etc.
•	Endpoints: e.g. POST /upload (multipart form-data, protected), GET /files (list), GET /files/:id (download), DELETE /files/:id, POST /share/:id (create link), GET /share/:token (download via link), POST /rename, POST /move, etc. Each verifies the user via Firebase token.
•	Web Frontend (Next.js):
•	Uses Next.js App Router with React and TypeScript. All pages/components assume a signed-in user (protected routes via Firebase SDK). On login, the user is routed to a dashboard page.
•	Authentication: Use Firebase Web SDK for email/password and Google OAuth login. Also implement phone login for Telegram mode: after normal login, if user chose Telegram mode, show a step to input phone number and verify code. This uses the Telegram API (likely via the backend or a specialized library) but the UI only sees “Verify your phone.” The app should persist a flag storageMode = “telegram” or “hcloud”.
•	UI Framework: Use Tailwind CSS (v3) with a design system like [ShadCN/ui] for ready components[7]. This ensures a consistent, modern style: we’ll choose a premium palette (e.g. blue #3B82F6 as primary, with complementary semantic colors). Fonts like Inter or similar will be used, with at least 8px grid spacing and a comfortable line-height. Elements will have smooth rounded corners (e.g. 8px on controls, 12px on cards) and subtle shadows.
•	Layout: On desktop, layout has a sidebar (folder navigation, shortcuts) plus a header (user profile, logout) and the main content grid of files. On mobile, the sidebar collapses into a hamburger menu/drawer. The file grid becomes a single column or small grid. Touch targets ≥44px. Implement light/dark theme toggle (persist in localStorage).
•	File List & Grid: After login, the dashboard shows the user’s files/folders (icons/thumbnails, names, dates). We’ll use Next.js’ built-in <Image> component for optimized thumbnails[8], which auto-serves responsive sizes and lazy-loads images. Each file item has actions (download, share, rename, delete). Searching/filtering can be done client-side via the DB index or Firestore query (with debounce).
•	Upload Component: A drag-and-drop zone (using e.g. [React Dropzone]) allows multi-file upload with progress bars. The upload sends files to POST /upload. We handle large files up to Telegram’s limits 2gb (current Bot API limit ~50MB[9]; we can chunk larger files but make sure user is able to upload files upto 2gb).
•	File Previews:
o	Images: Clicking an image opens a lightbox view with zoom/navigation (many React libraries exist for this).
o	Audio (MP3): Use an HTML5 <audio controls> element[10]. Optionally, a waveform visualization (e.g. using Wavesurfer.js) for a polished UI.
o	Video (MP4): Use an HTML5 <video controls> element[11], with custom controls if desired. The video source will be the Telegram download URL. For extra polish, we can overlay a play button on thumbnail, etc.
o	PDF: Use a PDF viewer library (e.g. [react-pdf] or [react-pdf-viewer]) to render PDF pages in-browser[12]. The PDF file will stream from the backend via Telegram’s link.
o	Text/Code: Render plain text and code with syntax highlighting (e.g. using [Prism.js]).
o	Docs (DOC/XLS/PPT): Optionally show first page or use a Google Docs embed if possible. If true preview isn’t feasible, provide at least an icon and download link.
•	Toolbar & Actions: Above the file grid, include buttons for “New Folder”, “Upload”, and sorting. Provide bulk operations (select multiple files to delete or download as zip). Provide an “Add to Favorites” (star) feature. All operations call the backend via Fetch/Axios (authenticated with Firebase token).
•	Profile & Settings: The header includes the user’s name/photo (from Firebase). A settings page allows editing display name, email, and switching storage mode is not allowed after signup (locked to chosen mode).
•	Animations: Use Framer Motion for smooth transitions (page loads, modal dialogs, button hovers)[13]. For example, the login page can have a subtle 3D spline animation or particle effect in the background (many modern login UIs use such dynamic backdrops). The user’s login experience should be elegant (e.g. a light animation after sign-in). Avoid generic Bootstrap/Uikit looks – the design should feel unique and premium (custom color palette, vector backgrounds, fine typography).
•	Progressive Web App (PWA): Include a Web App Manifest and service worker so the site meets PWA criteria. This allows “Add to Home Screen” prompts on mobile[3]. For example, the manifest specifies icons and theme color; serving over HTTPS ensures browsers will prompt users to install the app[3]. We will also use a service worker for offline caching of static assets and file thumbnails.
•	Mobile Frontend (Flutter): A companion Flutter app can use the same APIs. It will mirror the web UI in a Flutter style, using Material/Cupertino design. It supports the same features (auth, upload, preview) and uses responsive layouts (lists on phone, grid on tablet). Alternatively, we can rely on the PWA for mobile, but a native Flutter app can offer better performance/UX. Either way, focus on core flows: upload files from device (with progress), view list, tap for preview. Use Flutter’s widgets and animations for a polished feel.
Authentication & Security
•	Firebase Auth: Users sign up/sign in via email/password or Google OAuth. All endpoints in the Node backend require a valid Firebase ID token (passed in Authorization: Bearer). The backend uses the Firebase Admin SDK to verify each token and get uid[4]. This ensures only authenticated users can upload or view files. We’ll implement token refresh/expiration handling on the client side.
•	Telegram Phone Login (for own-storage mode): If a user chooses “Use Your Own Server”, after Firebase login we initiate Telegram login: the user enters their phone, Telegram sends an SMS code, and the user enters it in the app. We then call Telegram’s auth.signIn APIs (via backend or a secure script) to obtain a user session. The frontend only shows a generic “Phone number verification” step – it will not mention Telegram explicitly. We must clearly inform the user that this step is needed for secure storage.
•	Secure Access Controls:
•	Backend: Each API checks request.auth.uid from the validated token, and uses that as the owner ID. Users cannot access others’ data. If a user tries to access a file that isn’t theirs, the server returns 403.
•	Database Rules: For Firestore, we will set security rules so each document’s userId must match request.auth.uid[6]. For example:

 	match /files/{fileId} {
  allow read, write: if request.auth != null 
                    && request.auth.uid == resource.data.userId;
}
match /users/{userId} {
  allow read, update, delete: if request.auth.uid == userId;
  allow create: if request.auth != null;
}
•	Telegram Data: In the “own Server” mode, HCloud’s servers never view the actual file contents – it is only sent through to Telegram. As TGCloud emphasizes, the platform “never accesses or stores your actual files” in that mode[14]. We will treat all files as opaque blobs; HCloud only keeps metadata. In “HCloud server” mode, files reside on Telegram servers accessible by HCloud’s bot, but still encrypted by Telegram.
•	Environment Variables: All secrets (Firebase service account key, Telegram bot token, API ID/Hash) live in env vars, not in code.
•	Data Privacy: User files are kept private. Shared files generate expiring links; we do not expose raw Telegram file IDs or tokens. We will provide an optional preview on share links (e.g. an image thumbnail or video player), but access is still controlled by the secret share token.
File Storage and Retrieval via Telegram
HCloud leverages Telegram’s unlimited media storage by using the Bot API:
- Uploading Files: The backend uses the sendDocument (or type-specific) method to upload files to Telegram. Bots can send any file type up to 50 MB[9]. (Note: Telegram’s 50 MB per-file limit via Bot API means we should warn users if they try to upload a file larger than 50 MB; for larger files we could implement chunked uploads or advise splitting.)
- Telegram “Saved Messages” vs Channels: For “your Own Server” mode, we target the user’s private chat (Saved Messages). For “server” mode, I created a private channel for users on my Telegram account and have the bot upload there, or simply message files to our bot’s own chat (though organizing per user in one chat is messy). TGCloud’s approach is to have a private Telegram channel  and add the bot as admin[14][15]. make sure to seprate files or tagg them according to user so that user can access their files only. This isn’t visible in our UI, it’s just internal organization.
- File IDs and URLs: On upload, Telegram returns a file_id (and file_unique_id). We save that ID. When retrieving or sharing, we call getFile to obtain a direct download URL[5]. That URL looks like https://api.telegram.org/file/bot<token>/<path>. It is valid for ~1 hour, after which we call getFile again if needed[5].
- Thumbnails/Previews: For images/videos, Telegram can auto-generate thumbnails or previews. We can request those in the upload or via getFile. We’ll store any returned thumbnail link for faster display (e.g. a smaller JPG for galleries).
Key Features
•	Authentication:
•	Email/password and Google OAuth login (via Firebase)[4].
•	Phone/SMS verification for “Use Own Server” mode.
•	Persistent sessions with secure token refresh.
•	Email verification and password reset flows (leveraging Firebase).
•	User profile management (display name, photo).
•	File Management:
•	Upload: Drag-drop/multi-file, with progress and resume (if using Firebase Storage, but here we stream to Node).Don't Enforce 50 MB limit per file[9], implement slicing.
•	Download: Single-click to download via backend proxy to Telegram URL. Bulk download by zipping via backend (if needed).
•	Delete: Remove file (this will call Telegram’s deleteMessage or similar in the channel/Saved Messages). Update metadata and deduct storage usage.
•	Rename/Move: Edit filename or move files into folders (change metadata in DB). Validations (no empty names, disallow special chars if needed).
•	Folders: Nested folders structure. Users can create, rename, delete folders (recursive delete). Folders are virtual in metadata; actual Telegram storage doesn’t have folders, so we only track parentId in our DB.
•	Favorites & Tags: Star important files. Tags as free text or pre-defined categories.
•	Search & Filter: Real-time search on filename (debounced), filters by type (image, video, doc), size, date range, tags. Implemented client-side or via indexed queries.
•	Share Links: Generate public/private links. A public link allows anyone with the URL to view/download the file (optionally with password protection). HCloud will fetch the file from Telegram and stream it. Previews for shared links: show image/video/MP3 embed if possible.
•	File Previews:
•	Images: Click to open full-size lightbox with pan/zoom.
•	Video: Inline HTML5 <video> player[11] with play/pause, fullscreen.
•	Audio: HTML5 <audio> player[10] with play/pause and optionally a waveform UI (for visual flair).
•	PDF: Embedded viewer using [react-pdf] or similar[12] so pages scroll.
•	Text/Code: Display with syntax highlight (monospaced font, color theme).
•	Office Docs: If possible, show first page thumbnail or use Google Docs Viewer (if allowed). At minimum, prompt download.
•	UI & UX:
•	Design System: Use a consistent palette (blue primary #3B82F6 as suggested, with neutral grays and accent colors). Inter font (or similar) for readability. Adequate contrast for accessibility (WCAG AA). All images have alt text.
•	Animations: Login page and splash screens can have a subtle animated background (e.g. 3D spline shapes or particles). Use CSS animations and Framer Motion for transitions (e.g. fade in file cards)[13]. Avoid abrupt content shifts – Next.js Image ensures no layout shift[8].
•	Responsive Layout: Mobile-first design. Breakpoints: small (≤640px), medium (641–1024px), large (≥1024px)[16]. On mobile, use a single-column list or grid (1–2 columns); on tablet a 2–3 column grid; on desktop 4+ columns. Navigation transforms into a hamburger drawer on small screens.
•	Dark Mode: Provide light/dark themes; auto-detect or user-toggle. Persist user preference in localStorage.
•	Loading/Empty States: Use skeleton loaders for file grid and profile info while data loads. Show friendly illustrations or text when folders are empty (e.g. “No files yet, upload now.”).
•	Accessibility: All functionality must be keyboard-navigable. Use ARIA roles for modal dialogs (e.g. upload modal). Ensure >44px tap targets on mobile.
•	Performance & Scalability:
•	Image Optimization: Next.js <Image> auto-serves sized images and lazy-loads[8]. Thumbnails for gallery views should be small.
•	Lazy Loading & Virtualization: For long lists, virtual-scroll or pagination to avoid rendering thousands of elements at once.
•	Progressive Enhancement: Use Service Worker to cache static assets and possibly serve previously fetched file lists offline (read-only mode).
•	Efficient Back-and-Forth: Debounce search input (e.g. 300ms) to limit queries. Use CDNs (Next.js hosting) for static files.
•	Monitoring: Log errors and performance metrics.
•	Offline Mode (Optional): The PWA could allow queuing uploads while offline (store in IndexedDB and sync when online) and caching recently accessed files.
•	Push Notifications (Optional): If implemented, use Web Push (with VAPID keys) to notify the user of long-running operations or shared file notifications. This requires user permission.
Technical Notes & References
•	Telegram Storage Concept: Like Unlim and TG Cloud, we exploit Telegram’s free media storage[17][1]. Unlim explicitly states it “uses Telegram API” and the user’s “Saved Messages” for storage[17]. TG Cloud markets “Unlimited, Private Storage powered by Your Telegram channel” and assures users it “never accesses your files”[1][14]. We will adopt similar principles (users’ data remains on Telegram).
•	Telegram Bot API Limits: Bots can send up to 50 MB per file[9]. This influences allowed file size. There’s no aggregate storage limit.
•	Firebase Auth Integration: We follow Firebase’s guidance to verify ID tokens on the server for each request[4]. The user’s uid from Firebase is our user identifier.
•	Firestore Security: Use rules so only the authenticated user’s data is accessible. Example:

 	match /databases/{db}/documents {
  match /users/{userId} { 
    allow read, write: if request.auth.uid == userId; 
  }
  match /files/{fileId} {
    allow read, write: if request.auth.uid == resource.data.userId;
  }
}
 	(Similar to patterns shown in Firebase docs[6].)
•	Next.js Image Optimization: We will import and use next/image for all <img> tags. This provides automatic resizing, modern formats (e.g. WebP), and lazy loading[8] to improve load times.
•	Breakpoints: Following Tailwind’s default breakpoints (e.g. sm=640px, md=768px, lg=1024px)[16], we ensure the grid/responsive classes adapt to mobile/tablet/desktop.
•	PWA/Web App Manifest: We will include manifest.json (app name, icons, theme color) and serve the site over HTTPS[3]. Modern browsers then allow “Install to Home Screen” prompts (especially on Android/Chrome), giving the feel of a native app[3].
Conclusion
HCloud will integrate multiple modern technologies to deliver a smooth, secure, truly unlimited cloud storage experience. By hiding all Telegram-specific details from the user (no “Telegram” text in the UI) and providing a polished UI (custom branding, animations, responsive design), we ensure the app feels premium and cohesive. Every feature – from login to sharing – is designed to work out-of-the-box without user-side technical setup. For example, a user on “own Server” mode simply verifies their phone once; thereafter HCloud handles all Telegram interactions behind the scenes. This meets the requirement of a seamless “unlimited cloud storage” solution.
Sources: Project inspiration from Unlim and TG Cloud (both use Telegram “Saved Messages” for free storage)[17][1]. Telegram API documentation (Bot API file upload limits, download URL format)[9][5]. Firebase documentation on token verification[4] and Firestore security rules[6]. Next.js and Tailwind guides for image optimization and responsive design[8][16]. MDN references for HTML5 media elements[11][10]. React-PDF library overview[12]. TG Cloud design principles[14].
________________________________________
[1] [14] [15] Unlimited Cloud Storage | TGCloud
https://yourtgcloud.vercel.app/
[2] Unlim : An Alternative to Google Photos' Unlimited Storage (Opinions?) : r/androidapps
https://www.reddit.com/r/androidapps/comments/kocghe/unlim_an_alternative_to_google_photos_unlimited/
[3] Guides: PWAs | Next.js
https://nextjs.org/docs/app/guides/progressive-web-apps
[4] Verify ID Tokens  |  Firebase Authentication
https://firebase.google.com/docs/auth/admin/verify-id-tokens
[5] [9] Telegram Bot API
https://core.telegram.org/bots/api
[6] Writing conditions for Cloud Firestore Security Rules  |  Firebase
https://firebase.google.com/docs/firestore/security/rules-conditions
[7] The Foundation for your Design System - shadcn/ui
https://ui.shadcn.com/
[8] Getting Started: Image Optimization | Next.js
https://nextjs.org/docs/app/getting-started/images
[10]
: The Embed Audio element - HTML | MDN
https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio
[11]
: The Video Embed element - HTML | MDN
https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video
[12] GitHub - wojtekmaj/react-pdf: Display PDFs in your React app as easily as if they were images.
https://github.com/wojtekmaj/react-pdf
[13] React component | Motion
https://motion.dev/docs/react-motion-component
[16] Responsive design - Core concepts - Tailwind CSS
https://tailwindcss.com/docs/responsive-design
[17] UnLim: Unlimited cloud storage Free Download
https://unlim-unlimited-cloud-storage.soft112.com/
