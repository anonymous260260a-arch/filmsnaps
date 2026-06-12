# AI Development Rules for FilmSnaps

## Tech Stack Overview
• **Framework**: Next.js 13 with App Router for React-based server-side rendering and static site generation
• **Language**: TypeScript for type safety across the codebase
• **Styling**: Tailwind CSS with custom dark cinematic theme and shadcn/ui components
• **Data Fetching**: TanStack Query (React Query) for server state management and caching
• **API Integration**: TMDB (The Movie Database) API for all movie and TV show data
• **UI Components**: Radix UI primitives and shadcn/ui for accessible, customizable components
• **State Management**: React Context API and useState for client-side state
• **Animations**: Framer Motion and Tailwind classes for smooth transitions and effects
• **Carousel/Slider**: Swiper for responsive media carousels
• **Deployment**: Vercel (standard for Next.js applications)

## Library Usage Rules

### Data Fetching & State Management
• **TanStack Query** must be used for all API calls and server state management
• **React Context** should be used for global client state that doesn't require server synchronization
• **Direct fetch** is only allowed within TanStack Query functions or API route handlers

### UI Components
• **shadcn/ui** components must be used as the primary component library
• **Radix UI** primitives can be used when shadcn/ui doesn't have the required component
• **Custom components** should extend shadcn/ui components rather than reimplementing them
• **Tailwind CSS** is the only allowed styling solution - no CSS-in-JS or traditional CSS files
• **Lucide React** is the exclusive icon library - no other icon libraries permitted

### Routing & Navigation
• **Next.js App Router** conventions must be followed for all routing
• **next/link** should be used for all client-side navigation
• **next/navigation** hooks must be used for programmatic navigation

### Animations & Interactions
• **Tailwind classes** should be used for simple animations and transitions
• **Framer Motion** is permitted for complex animations that cannot be achieved with Tailwind
• **Swiper** is the exclusive library for all carousel/slider implementations

### Data Handling
• **TMDB API** is the only allowed external data source for movie/TV information
• All API keys must be stored as environment variables and accessed through `process.env`
• Image optimization must use Next.js's built-in Image component with proper sizing

### Forms & User Input
• **React Hook Form** should be used for all form implementations
• **Zod** is required for all form validation and data schema validation
• Input components must use shadcn/ui form components when available

### Error Handling & Notifications
• **Error boundaries** should wrap appropriate components for graceful error handling
• **Toast notifications** must use the built-in toast system (react-hot-toast)
• All user-facing messages should be internationalizable (even if only English is implemented)

### Performance & Optimization
• **Image optimization** must use Next.js Image component with appropriate sizing props
• **Code splitting** should be implemented through dynamic imports for heavy components
• **Bundle optimization** techniques (tree-shaking, dynamic imports) must be applied
• **Caching strategies** should leverage TanStack Query's built-in caching mechanisms

### Testing & Quality
• **TypeScript** types must be used for all components and functions
• **ESLint** rules must be followed - no warnings or errors should be present
• **Responsive design** principles must be applied to all UI components
• **Accessibility standards** (WCAG) must be followed for all UI implementations

### Third-Party Libraries
• Any new third-party libraries require explicit approval
• Libraries should be evaluated for bundle size impact before implementation
• Preference should be given to libraries that support tree-shaking
• All dependencies must be kept up-to-date with security patches