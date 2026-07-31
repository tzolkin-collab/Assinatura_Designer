# Architectural and Implementation Code Review

## 1. Self-Hosted Presentation & Dynamic Form Generation

**Presentation Hosting Architecture:**
The self-hosted presentation feature relies on a clean, scalable architecture. Presentations are assigned a public, url-safe slug with 72 bits of entropy (`crypto.randomBytes(9).toString('base64url')`), which provides sufficient unpredictability for public sharing without requiring complex access controls.
- The frontend (`frontend/src/app/apresentacao/[slug]/page.tsx`) uses a React `PresentationViewer` wrapper around an `HtmlSlideRenderer`.
- The backend (`backend/src/routes/publicPresentations.ts`) provides a public `GET /api/public/presentations/:slug` endpoint.
- **Smart Authorization:** A notable architectural highlight is the hybrid public/private route design. If the owner of the presentation accesses the public link and has a valid JWT, the backend transparently enriches the payload (setting `isOwner: true` and returning the `postId`), enabling the presenter view and chat controls on the same URL without requiring a separate dashboard.

**Dynamic Form Generation:**
A review of the slide renderer and generation pipeline indicates that dynamic forms are explicitly forbidden within the slide content itself. The slide generation (`backend/src/lib/htmlDesign.ts`) enforces strict DOM sanitization using `DOMPurify` that outright rejects the `<form>` tag (`FORBID_TAGS: ['form', ...]`). Any interactive forms related to the presentation are restricted to the React application shell (e.g., the Chat Q&A interface), ensuring the slide contents remain static and safe.

**Data Isolation & Security:**
- **DOMPurify on Backend:** The backend uses `DOMPurify` backed by `JSDOM` to strictly sanitize the HTML and CSS of generated slides before persistence. This is an excellent practice that prevents stored XSS.

## 2. Form Data Submission & Live Session Handling (Chat & Form Sync)

**Live Session (Chat):**
The live Q&A session functionality (`PresentationViewer.tsx` and `backend/src/lib/presentationChat.ts`) relies on HTTP short-polling rather than WebSockets or SSE.
- **Polling Implementation:** The frontend polls the `/api/public/presentations/:slug/chat` endpoint every 3 seconds (`CHAT_POLL_MS`).
- **Performance & Race Conditions:** While polling is simpler to implement and scale amorphously, it introduces network overhead (HTTP headers/TLS handshakes every 3s per viewer) and slight delays (up to 3 seconds) in real-time interactions. A race condition could occur if a presenter toggles the chat state exactly as a polling request is in flight, though the 3-second recovery interval mitigates persistent UI desyncs.
- **Error Handling:** The frontend silently catches polling errors. This is appropriate for read operations to avoid UI flicker during transient network drops, but less ideal for guaranteed real-time delivery.
- **State Persistence:** Chat messages are stored ephemerally in Redis with a 24-hour TTL and a hard cap of 200 messages (`MAX_MESSAGES`). This prevents memory leaks and bounded growth, which is a solid architectural decision for live events.
- **Rate Limiting:** The backend properly implements rate limiting for the chat: 60 req/min for reading and a strict 8 req/min for posting messages. This successfully mitigates spam.

## 3. Asset Management & SVG Optimization

**Asset Lifecycle:**
SVGs are actively processed during the brandbook ingestion phase (`brandbookIngestion.ts`). The application uses Gemini to reconstruct SVGs from raster images and stores the optimized output in Cloudflare R2, tracking metadata in the `Asset` Prisma model.

**SVG Implementation:**
- Inline vs Linked: During AI generation, the prompt explicitly instructs the LLM to embed SVG markup *inline* (`item.svgMarkup`). While this reduces external HTTP requests during rendering, large SVGs can bloat the HTML payload size.

**Security Vulnerability: SVG Sanitization via Regex**
- **Critical Finding:** The backend (`backend/src/lib/imageNormalizer.ts`) and frontend (`frontend/src/components/DesignDocument/HtmlSlideRenderer.tsx`) use simple regular expressions to sanitize SVGs and HTML strings respectively (e.g., `.replace(/<script[\s\S]*?<\/script>/gi, '')`).
- **Risk:** Regex is fundamentally incapable of securely parsing and sanitizing XML/HTML structures. Attackers can bypass these filters using malformed tags, encoded attributes (e.g., `<svg onload=...`), or nested structures. While the slides are executed in a sandboxed iframe (`sandbox=""`), relying on regex for XSS prevention is an architectural anti-pattern and a severe security risk.

---

## Executive Summary & Recommendations

**Security Vulnerabilities:**
1. **XSS Risk in Sanitization:** The use of Regex for sanitizing SVGs (`imageNormalizer.ts`) and HTML on the frontend (`HtmlSlideRenderer.tsx`) must be replaced.
   *Recommendation:* Utilize `DOMPurify` consistently across both the frontend and the remaining backend SVG processing functions, as is already correctly implemented in `htmlDesign.ts`.
2. **Chat Input Sanitization:** Chat messages are not strictly sanitized before storage in Redis. While React escapes the output (`{m.text}`), any future feature that renders these messages outside of React's safe rendering could expose the system to Stored XSS.

**State Management & Performance:**
1. **Chat Polling Overhead:** The 3-second HTTP polling mechanism for the live chat will scale poorly for large audiences (e.g., 1000 viewers = 333 requests per second just for chat status).
   *Recommendation:* Migrate the live presentation chat to Server-Sent Events (SSE) or WebSockets. This will drastically reduce HTTP overhead and eliminate the 3-second latency window, providing a true real-time experience.

**Code Refactoring:**
1. Standardize sanitization libraries across the entire stack.
2. Evaluate the trade-off between embedding SVGs inline vs linking them. For complex vector illustrations, hosting them as distinct R2 assets and linking via `<img>` or `<object>` may reduce slide generation token costs and payload size.