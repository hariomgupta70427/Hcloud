ROLE:
You are a senior frontend architect + performance engineer + UX specialist.

PROJECT CONTEXT:
Hcloud is a web + PWA platform for uploading and consuming media content (mp3, mp4 etc.). you can read the codebase to understand the overall idea.

1️⃣ UI & UX Overhaul

Current issues:

UI looks outdated and visually poor.
No animations, no hover effects, no depth.
Login/Auth page looks basic and unpolished.
Mobile & PWA UI is broken:
Buttons overlapping
Elements misaligned
Features hidden or clipped
Animations are not smooth

Required:

Modern SaaS-grade UI
Micro-interactions (hover, focus, active states)
Smooth entrance animations
Proper spacing system
3D depth via shadows or glassmorphism where appropriate
Fully responsive layout (mobile-first)
PWA optimized UI
60fps animation standard
No layout shifts

Deliver:

Component-level redesign suggestions
Exact CSS/Tailwind improvements
Animation implementation code
Layout restructuring plan

2️⃣ Auth Persistence Fix

Problem:

User logs out automatically after reload
Happens on both Web and PWA

Required:

Proper session persistence
Token refresh handling
Secure storage best practice
Works offline in PWA
No auth flicker on reload

Deliver:

Root cause analysis
Correct auth flow architecture
Code implementation example

3️⃣ Media Playback Optimization

Problem:

Uploaded content takes too long to play especially in byod
Sometimes doesn’t play at all

Required:

Instant playback start (<1–2s)
Proper streaming support
Lazy loading strategy
Preload optimization
Format detection (mp3/mp4)
Error handling UI
Buffer strategy

Deliver:

Performance bottleneck diagnosis
Architecture correction
Code for optimized player
CDN / streaming suggestions
Best browser compatibility approach

OUTPUT FORMAT:

Step-by-step improvement roadmap
Code snippets
Architectural corrections
Performance benchmarks target